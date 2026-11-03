(() => {
  "use strict";

  const elements = {
    loading: document.querySelector("#loading"),
    productCard: document.querySelector("#productCard"),
    productName: document.querySelector("#productName"),
    productId: document.querySelector("#productId"),
    productBarcode: document.querySelector("#productBarcode"),
    message: document.querySelector("#message"),
    sendButton: document.querySelector("#sendButton"),
    settingsButton: document.querySelector("#settingsButton")
  };

  let product = null;
  let settings = null;

  function showMessage(value, tone = "info") {
    elements.message.textContent = value;
    elements.message.className = `message ${tone}`;
    elements.message.hidden = false;
  }

  function configured(value) {
    return Boolean(value?.apiBaseUrl && value?.apiToken && !value.apiBaseUrl.includes("YOUR_SUBDOMAIN"));
  }

  async function readSettings() {
    const value = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
    return {
      apiBaseUrl: (value.apiBaseUrl || "").replace(/\/+$/, ""),
      apiToken: value.apiToken || ""
    };
  }

  async function activeProduct() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?bigbang\.hr\//i.test(tab.url || "")) {
      return { ok: false, error: "Otvori Big Bang stranicu pojedinog artikla." };
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "WAREWAY_GET_PRODUCT" });
    } catch {
      return { ok: false, error: "Osvježi Big Bang stranicu pa ponovno otvori ekstenziju." };
    }
  }

  function renderProduct(value) {
    product = value;
    elements.loading.hidden = true;
    elements.productCard.hidden = false;
    elements.productName.textContent = value.name;
    elements.productId.textContent = value.bigbangId;
    elements.productBarcode.textContent = value.barcode || "Nije pronađen";
  }

  async function initialize() {
    const [settingsResult, productResult] = await Promise.all([readSettings(), activeProduct()]);
    settings = settingsResult;

    if (productResult?.product) renderProduct(productResult.product);
    else elements.loading.hidden = true;

    if (!productResult?.ok) {
      showMessage(productResult?.error || "Artikl nije moguće pročitati.", "error");
      return;
    }

    if (!configured(settings)) {
      showMessage("Prije prvog slanja upiši API adresu i pristupni token u postavkama.");
      return;
    }

    elements.sendButton.disabled = false;
  }

  async function sendProduct() {
    if (!product || !configured(settings)) return;
    elements.sendButton.disabled = true;
    elements.sendButton.firstElementChild.textContent = "Šaljem…";

    try {
      const response = await fetch(`${settings.apiBaseUrl}/api/products`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: product.name,
          bigbangId: product.bigbangId,
          barcode: product.barcode,
          sourceUrl: product.sourceUrl
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || `API je vratio status ${response.status}.`);
      }

      if (payload?.duplicate) {
        showMessage("Ovaj artikl već postoji u skladištu.", "success");
      } else {
        showMessage("Artikl je uspješno poslan u skladište.", "success");
      }
      elements.sendButton.firstElementChild.textContent = "Poslano";
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Slanje nije uspjelo.", "error");
      elements.sendButton.disabled = false;
      elements.sendButton.firstElementChild.textContent = "Pokušaj ponovno";
    }
  }

  elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.sendButton.addEventListener("click", sendProduct);
  initialize();
})();

