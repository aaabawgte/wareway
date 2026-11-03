(function exposeExtractor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WarewayExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createExtractor() {
  "use strict";

  const BARCODE_PATTERN = /^\d{8,14}$/;
  const BIGBANG_ID_PATTERN = /^\d{6,14}$/;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function digits(value) {
    return String(value ?? "").replace(/\D/g, "");
  }

  function validBarcode(value) {
    const normalized = digits(value);
    return BARCODE_PATTERN.test(normalized) ? normalized : null;
  }

  function validProductId(value) {
    const normalized = digits(value);
    return BIGBANG_ID_PATTERN.test(normalized) ? normalized : null;
  }

  function jsonLdProducts(doc) {
    const products = [];
    const scripts = doc.querySelectorAll?.('script[type="application/ld+json"]') ?? [];

    for (const script of scripts) {
      try {
        const value = JSON.parse(script.textContent || "null");
        const queue = Array.isArray(value) ? [...value] : [value];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if (Array.isArray(item)) {
            queue.push(...item);
            continue;
          }
          if (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))) {
            products.push(item);
          }
          if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
        }
      } catch {
        // Jedan neispravan JSON-LD blok ne smije zaustaviti ostale izvore.
      }
    }

    return products;
  }

  function readNuxtProductData(doc, productId) {
    const nuxtScript = doc.querySelector?.("#__NUXT_DATA__");
    if (!nuxtScript?.textContent || !productId) return { barcode: null, name: null };

    try {
      const values = JSON.parse(nuxtScript.textContent);
      if (!Array.isArray(values)) return { barcode: null, name: null };

      const product = values.find((value) => {
        if (!value || Array.isArray(value) || typeof value !== "object") return false;
        const referencedCode = Number.isInteger(value.code) ? values[value.code] : value.code;
        return String(referencedCode ?? "") === String(productId);
      });

      if (!product) return { barcode: null, name: null };

      const dereference = (key) => {
        const reference = product[key];
        return Number.isInteger(reference) ? values[reference] : reference;
      };

      const barcode = validBarcode(dereference("ean_code") ?? dereference("ean") ?? dereference("gtin"));
      const name = text(dereference("title") ?? dereference("name")) || null;
      return { barcode, name };
    } catch {
      return { barcode: null, name: null };
    }
  }

  function productIdFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      return validProductId(pathname.match(/-p-(\d+)(?:\/|$)/i)?.[1]);
    } catch {
      return null;
    }
  }

  function extractProduct(doc, url) {
    const structured = jsonLdProducts(doc)[0] ?? null;
    const domIdText = doc.querySelector?.("#info .cd-info, .cd-info")?.textContent || "";
    const bigbangId = validProductId(structured?.sku)
      || validProductId(domIdText.match(/ID:\s*(\d+)/i)?.[1])
      || productIdFromUrl(url);

    const nuxt = readNuxtProductData(doc, bigbangId);
    const name = text(structured?.name)
      || text(doc.querySelector?.("#info h1, main h1, h1")?.textContent)
      || nuxt.name;

    const barcode = validBarcode(
      structured?.gtin14
      ?? structured?.gtin13
      ?? structured?.gtin12
      ?? structured?.gtin8
      ?? structured?.gtin
    ) || nuxt.barcode;

    if (!name || !bigbangId) return null;
    return {
      name,
      bigbangId,
      barcode,
      sourceUrl: url
    };
  }

  return {
    extractProduct,
    jsonLdProducts,
    productIdFromUrl,
    readNuxtProductData,
    validBarcode,
    validProductId
  };
});

