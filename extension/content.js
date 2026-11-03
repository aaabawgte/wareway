(() => {
  "use strict";

  const extractor = globalThis.WarewayExtractor;
  const fetchedPageCache = new Map();

  function isSupportedHost() {
    return location.hostname === "bigbang.hr" || location.hostname === "www.bigbang.hr";
  }

  async function fetchFreshProductPage(url) {
    if (fetchedPageCache.has(url)) return fetchedPageCache.get(url);

    const request = fetch(url, { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.text() : "")
      .then((html) => html ? new DOMParser().parseFromString(html, "text/html") : null)
      .catch(() => null);

    fetchedPageCache.set(url, request);
    return request;
  }

  async function readActiveProduct() {
    if (!isSupportedHost() || !extractor) {
      return { ok: false, error: "Ova stranica nije podržana." };
    }

    let product = extractor.extractProduct(document, location.href);
    if (!product) {
      return { ok: false, error: "Otvori pojedini Big Bang artikl pa pokušaj ponovno." };
    }

    // Nakon SPA navigacije __NUXT_DATA__ može ostati od prethodne stranice.
    // Svježi GET istog URL-a vraća serverski payload s ean_code poljem.
    if (!product.barcode) {
      const freshDocument = await fetchFreshProductPage(location.href);
      const freshProduct = freshDocument && extractor.extractProduct(freshDocument, location.href);
      if (freshProduct?.bigbangId === product.bigbangId) product = freshProduct;
    }

    if (!product.barcode) {
      return {
        ok: false,
        product,
        error: "Barkod nije pronađen u podacima ovog artikla."
      };
    }

    return { ok: true, product };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "WAREWAY_GET_PRODUCT") return false;
    readActiveProduct()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Podatke artikla nije moguće pročitati." }));
    return true;
  });
})();

