import { timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const PRODUCT_COLUMNS = `
  id,
  name,
  bigbang_id AS bigbangId,
  barcode,
  source_url AS sourceUrl,
  status,
  note,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

interface ProductRow {
  id: string;
  name: string;
  bigbangId: string;
  barcode: string;
  sourceUrl: string;
  status: "received" | "processed" | "archived";
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductInput {
  name: string;
  bigbangId: string;
  barcode: string;
  sourceUrl: string;
  status: ProductRow["status"];
  note: string | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function securityHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) return origin;

  const allowed = env.ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return allowed.includes(origin.replace(/\/$/, "")) ? origin : null;
}

function responseHeaders(request: Request, env: Env, extra: HeadersInit = {}): Headers {
  const headers = new Headers(securityHeaders());
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  for (const [key, value] of new Headers(extra)) headers.set(key, value);
  return headers;
}

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = responseHeaders(request, env, init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function errorResponse(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown
): Response {
  return jsonResponse(request, env, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId
    }
  }, { status });
}

async function tokensMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
}

async function requireAuthentication(request: Request, env: Env): Promise<void> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "unauthorized", "Nedostaje pristupni token.");
  }

  const provided = authorization.slice("Bearer ".length).trim();
  if (!provided || !(await tokensMatch(provided, env.API_TOKEN))) {
    throw new HttpError(401, "unauthorized", "Pristupni token nije ispravan.");
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type mora biti application/json.");
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Zahtjev je prevelik.");
  }

  if (!request.body) throw new HttpError(400, "invalid_json", "Tijelo zahtjeva je prazno.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "Zahtjev je prevelik.");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid_json", "Tijelo zahtjeva nije ispravan JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateProductInput(value: unknown): ProductInput {
  if (!isRecord(value)) {
    throw new HttpError(422, "validation_error", "Podaci artikla nisu ispravni.");
  }

  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  const bigbangId = typeof value.bigbangId === "string" ? value.bigbangId.trim() : "";
  const barcode = typeof value.barcode === "string" ? value.barcode.replace(/\D/g, "") : "";
  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl.trim() : "";
  const status = value.status ?? "received";
  const note = value.note == null ? null : typeof value.note === "string" ? value.note.trim() : "";
  const errors: Record<string, string> = {};

  if (!name || name.length > 300) errors.name = "Naziv mora sadržavati 1–300 znakova.";
  if (!/^\d{6,14}$/.test(bigbangId)) errors.bigbangId = "Big Bang ID mora sadržavati 6–14 znamenki.";
  if (!/^\d{8,14}$/.test(barcode)) errors.barcode = "Barkod mora sadržavati 8–14 znamenki.";
  const supportedStatuses: readonly unknown[] = ["received", "processed", "archived"];
  if (!supportedStatuses.includes(status)) {
    errors.status = "Status nije podržan.";
  }
  if (note !== null && (typeof note !== "string" || note.length > 500)) {
    errors.note = "Napomena smije sadržavati najviše 500 znakova.";
  }

  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== "https:" || !["bigbang.hr", "www.bigbang.hr"].includes(parsedUrl.hostname)) {
      errors.sourceUrl = "Izvor mora biti HTTPS Big Bang URL.";
    }
  } catch {
    errors.sourceUrl = "URL artikla nije ispravan.";
  }

  if (Object.keys(errors).length) {
    throw new HttpError(422, "validation_error", "Provjeri podatke artikla.", errors);
  }

  return {
    name,
    bigbangId,
    barcode,
    sourceUrl,
    status: status as ProductInput["status"],
    note
  };
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function listProducts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const limit = parseInteger(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = parseInteger(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const requestedSort = url.searchParams.get("sort") || "createdAt";
  const sortColumn = {
    createdAt: "created_at",
    name: "name",
    bigbangId: "bigbang_id",
    barcode: "barcode"
  }[requestedSort] || "created_at";
  const order = url.searchParams.get("order")?.toLowerCase() === "asc" ? "ASC" : "DESC";
  const search = `%${escapeLike(query)}%`;
  const where = query
    ? "WHERE name LIKE ? ESCAPE '\\' OR bigbang_id LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\'"
    : "";

  const countStatement = query
    ? env.DB.prepare(`SELECT COUNT(*) AS total FROM products ${where}`).bind(search, search, search)
    : env.DB.prepare("SELECT COUNT(*) AS total FROM products");
  const itemsStatement = query
    ? env.DB.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products ${where} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`)
      .bind(search, search, search, limit, offset)
    : env.DB.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`)
      .bind(limit, offset);

  const [countResult, itemsResult] = await env.DB.batch([countStatement, itemsStatement]);
  if (!countResult || !itemsResult) {
    throw new HttpError(500, "database_error", "Baza nije vratila očekivani rezultat.");
  }
  const countRow = countResult.results[0];
  const totalValue = isRecord(countRow) ? countRow.total : 0;
  const total = typeof totalValue === "number" ? totalValue : Number(totalValue || 0);
  const items = itemsResult.results.map((row): ProductRow => {
    if (!isRecord(row)) {
      throw new HttpError(500, "database_error", "Baza je vratila neispravan zapis.");
    }
    return {
      id: String(row.id),
      name: String(row.name),
      bigbangId: String(row.bigbangId),
      barcode: String(row.barcode),
      sourceUrl: String(row.sourceUrl),
      status: String(row.status) as ProductRow["status"],
      note: row.note == null ? null : String(row.note),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  });

  return jsonResponse(request, env, {
    data: items,
    meta: { total, limit, offset, hasMore: offset + items.length < total }
  });
}

async function getProduct(request: Request, env: Env, id: string): Promise<Response> {
  const product = await env.DB
    .prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`)
    .bind(id)
    .first<ProductRow>();
  if (!product) throw new HttpError(404, "not_found", "Artikl nije pronađen.");
  return jsonResponse(request, env, { data: product });
}

async function createProduct(request: Request, env: Env): Promise<Response> {
  const input = validateProductInput(await readJsonBody(request));
  const existing = await env.DB
    .prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE bigbang_id = ?`)
    .bind(input.bigbangId)
    .first<ProductRow>();

  if (existing) {
    return jsonResponse(request, env, { data: existing, created: false, duplicate: true });
  }

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO products (
        id, name, bigbang_id, barcode, source_url, status, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      input.name,
      input.bigbangId,
      input.barcode,
      input.sourceUrl,
      input.status,
      input.note,
      timestamp,
      timestamp
    ).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      const duplicate = await env.DB
        .prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE bigbang_id = ?`)
        .bind(input.bigbangId)
        .first<ProductRow>();
      if (duplicate) return jsonResponse(request, env, { data: duplicate, created: false, duplicate: true });
    }
    throw error;
  }

  const product = await env.DB
    .prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`)
    .bind(id)
    .first<ProductRow>();
  return jsonResponse(request, env, { data: product, created: true, duplicate: false }, { status: 201 });
}

async function deleteProduct(request: Request, env: Env, id: string): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, "not_found", "Artikl nije pronađen.");
  return jsonResponse(request, env, { deleted: true, id });
}

async function routeRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const origin = request.headers.get("Origin");

  if (origin && !allowedOrigin(request, env)) {
    throw new HttpError(403, "origin_forbidden", "Ova domena nema dopušten pristup API-ju.");
  }

  if (request.method === "OPTIONS") {
    const headers = responseHeaders(request, env, {
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400"
    });
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" && path === "/api/health") {
    return jsonResponse(request, env, {
      ok: true,
      service: "wareway-api",
      requestId
    });
  }

  const productMatch = path.match(/^\/api\/products\/([0-9a-f-]{36})$/i);
  const isRead = request.method === "GET";
  if (!isRead || env.REQUIRE_READ_AUTH.toLowerCase() === "true") {
    await requireAuthentication(request, env);
  }

  if (request.method === "GET" && path === "/api/products") return listProducts(request, env);
  if (request.method === "POST" && path === "/api/products") return createProduct(request, env);
  if (request.method === "GET" && productMatch?.[1]) return getProduct(request, env, productMatch[1]);
  if (request.method === "DELETE" && productMatch?.[1]) return deleteProduct(request, env, productMatch[1]);

  throw new HttpError(404, "route_not_found", "API ruta nije pronađena.");
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    try {
      const response = await routeRequest(request, env, requestId);
      console.log(JSON.stringify({
        message: "request_completed",
        requestId,
        method: request.method,
        path: url.pathname,
        status: response.status
      }));
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        console.warn(JSON.stringify({
          message: "request_rejected",
          requestId,
          method: request.method,
          path: url.pathname,
          status: error.status,
          code: error.code
        }));
        return errorResponse(
          request,
          env,
          error.status,
          error.code,
          error.message,
          requestId,
          error.details
        );
      }

      console.error(JSON.stringify({
        message: "request_failed",
        requestId,
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : "Unknown error"
      }));
      return errorResponse(
        request,
        env,
        500,
        "internal_error",
        "Došlo je do neočekivane pogreške.",
        requestId
      );
    }
  }
} satisfies ExportedHandler<Env>;

