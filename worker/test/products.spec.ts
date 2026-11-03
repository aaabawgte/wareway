import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const API_TOKEN = "test-token-at-least-16-characters";

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${API_TOKEN}`);
  return new Request(`https://api.example.com${path}`, { ...init, headers });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM products").run();
});

describe("Wareway products API", () => {
  it("sprema artikl i vraća ga u povijesti", async () => {
    const createResponse = await worker.fetch(request("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Laptop HP 250R G10",
        bigbangId: "5000311742",
        barcode: "2010033161096",
        sourceUrl: "https://www.bigbang.hr/laptop-hp-p-5000311742/"
      })
    }), env, createExecutionContext());

    expect(createResponse.status).toBe(201);
    expect((await createResponse.json<{ created: boolean }>()).created).toBe(true);

    const listResponse = await worker.fetch(request("/api/products"), env, createExecutionContext());
    const payload = await listResponse.json<{ data: ProductRowForTest[]; meta: { total: number } }>();
    expect(listResponse.status).toBe(200);
    expect(payload.meta.total).toBe(1);
    expect(payload.data[0]?.bigbangId).toBe("5000311742");
  });

  it("isti Big Bang ID označava kao duplikat", async () => {
    const body = JSON.stringify({
      name: "Test artikl",
      bigbangId: "5000311742",
      barcode: "3851234567890",
      sourceUrl: "https://www.bigbang.hr/test-p-5000311742/"
    });

    await worker.fetch(request("/api/products", { method: "POST", body }), env, createExecutionContext());
    const duplicate = await worker.fetch(request("/api/products", { method: "POST", body }), env, createExecutionContext());
    const payload = await duplicate.json<{ duplicate: boolean }>();

    expect(duplicate.status).toBe(200);
    expect(payload.duplicate).toBe(true);
  });

  it("odbija neispravan payload", async () => {
    const response = await worker.fetch(request("/api/products", {
      method: "POST",
      body: JSON.stringify({ name: "", bigbangId: "x", barcode: "abc", sourceUrl: "nope" })
    }), env, createExecutionContext());

    expect(response.status).toBe(422);
  });

  it("ne dopušta pisanje bez tokena", async () => {
    const response = await worker.fetch(new Request("https://api.example.com/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }), env, createExecutionContext());

    expect(response.status).toBe(401);
  });

  it("ne dopušta privatno čitanje bez tokena", async () => {
    const response = await worker.fetch(
      new Request("https://api.example.com/api/products"),
      env,
      createExecutionContext()
    );

    expect(response.status).toBe(401);
  });
});

interface ProductRowForTest {
  bigbangId: string;
}
