(() => {
  "use strict";

  const storageKeys = {
    apiBaseUrl: "wareway.apiBaseUrl",
    apiToken: "wareway.apiToken"
  };

  const state = {
    products: [],
    total: 0,
    apiBaseUrl: localStorage.getItem(storageKeys.apiBaseUrl)
      || window.WAREWAY_CONFIG?.apiBaseUrl
      || "",
    apiToken: localStorage.getItem(storageKeys.apiToken) || "",
    searchTimer: null
  };

  const elements = {
    connectionBadge: document.querySelector("#connectionBadge"),
    settingsButton: document.querySelector("#settingsButton"),
    refreshButton: document.querySelector("#refreshButton"),
    searchInput: document.querySelector("#searchInput"),
    sortSelect: document.querySelector("#sortSelect"),
    statusMessage: document.querySelector("#statusMessage"),
    tableWrap: document.querySelector("#tableWrap"),
    productRows: document.querySelector("#productRows"),
    emptyState: document.querySelector("#emptyState"),
    totalMetric: document.querySelector("#totalMetric"),
    todayMetric: document.querySelector("#todayMetric"),
    latestMetric: document.querySelector("#latestMetric"),
    settingsDialog: document.querySelector("#settingsDialog"),
    settingsForm: document.querySelector("#settingsForm"),
    apiBaseUrl: document.querySelector("#apiBaseUrl"),
    apiToken: document.querySelector("#apiToken"),
    productRowTemplate: document.querySelector("#productRowTemplate")
  };

  function headers() {
    const value = { "Accept": "application/json" };
    if (state.apiToken) value.Authorization = `Bearer ${state.apiToken}`;
    return value;
  }

  function apiConfigured() {
    return state.apiBaseUrl
      && !state.apiBaseUrl.includes("YOUR_SUBDOMAIN")
      && /^https?:\/\//.test(state.apiBaseUrl);
  }

  function showLoading(message = "Učitavam artikle…") {
    elements.statusMessage.className = "status-message";
    elements.statusMessage.innerHTML = "";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    elements.statusMessage.append(spinner, document.createTextNode(` ${message}`));
    elements.statusMessage.hidden = false;
    elements.tableWrap.hidden = true;
    elements.emptyState.hidden = true;
  }

  function showError(message) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = "status-message error";
    elements.statusMessage.hidden = false;
    elements.tableWrap.hidden = true;
    elements.emptyState.hidden = true;
    elements.connectionBadge.className = "connection-badge offline";
    elements.connectionBadge.innerHTML = "<i></i> Nije povezano";
  }

  function formatDate(value, compact = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("hr-HR", compact
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "long", timeStyle: "short" }
    ).format(date);
  }

  function isToday(value) {
    const date = new Date(value);
    const today = new Date();
    return date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  }

  function updateMetrics() {
    const latest = state.products.reduce((current, item) => {
      if (!current) return item.createdAt;
      return new Date(item.createdAt) > new Date(current) ? item.createdAt : current;
    }, "");
    elements.totalMetric.textContent = new Intl.NumberFormat("hr-HR").format(state.total);
    elements.todayMetric.textContent = String(state.products.filter((item) => isToday(item.createdAt)).length);
    elements.latestMetric.textContent = latest ? formatDate(latest, true) : "Nema slanja";
  }

  function renderRows() {
    elements.productRows.replaceChildren();
    elements.statusMessage.hidden = true;
    updateMetrics();

    if (!state.products.length) {
      elements.tableWrap.hidden = true;
      elements.emptyState.hidden = false;
      return;
    }

    elements.emptyState.hidden = true;
    elements.tableWrap.hidden = false;

    for (const product of state.products) {
      const fragment = elements.productRowTemplate.content.cloneNode(true);
      const row = fragment.querySelector("tr");
      row.dataset.id = product.id;
      fragment.querySelector(".product-name").textContent = product.name;
      fragment.querySelector(".product-id").textContent = product.bigbangId;
      fragment.querySelector(".product-barcode").textContent = product.barcode;
      const date = fragment.querySelector(".product-date");
      date.dateTime = product.createdAt;
      date.textContent = formatDate(product.createdAt, true);
      const link = fragment.querySelector(".source-link");
      link.href = product.sourceUrl;
      fragment.querySelector(".delete-button").addEventListener("click", () => deleteProduct(product));
      elements.productRows.append(fragment);
    }
  }

  async function loadProducts() {
    if (!apiConfigured()) {
      showError("Upiši adresu Cloudflare Workera u postavkama API-ja.");
      return;
    }

    showLoading();
    const [sort, order] = elements.sortSelect.value.split(":");
    const params = new URLSearchParams({
      limit: "200",
      sort,
      order
    });
    if (elements.searchInput.value.trim()) params.set("q", elements.searchInput.value.trim());

    try {
      const response = await fetch(`${state.apiBaseUrl}/api/products?${params}`, { headers: headers() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || `API je vratio status ${response.status}.`);
      state.products = Array.isArray(payload?.data) ? payload.data : [];
      state.total = Number(payload?.meta?.total || 0);
      elements.connectionBadge.className = "connection-badge online";
      elements.connectionBadge.innerHTML = "<i></i> Povezano";
      renderRows();
    } catch (error) {
      showError(error instanceof Error ? error.message : "Podatke nije moguće učitati.");
    }
  }

  async function deleteProduct(product) {
    if (!state.apiToken) {
      openSettings();
      return;
    }
    if (!window.confirm(`Obrisati zapis za „${product.name}”?`)) return;

    try {
      const response = await fetch(`${state.apiBaseUrl}/api/products/${product.id}`, {
        method: "DELETE",
        headers: headers()
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || "Brisanje nije uspjelo.");
      await loadProducts();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Brisanje nije uspjelo.");
    }
  }

  function openSettings() {
    elements.apiBaseUrl.value = state.apiBaseUrl;
    elements.apiToken.value = state.apiToken;
    elements.settingsDialog.showModal();
  }

  elements.settingsButton.addEventListener("click", openSettings);
  elements.refreshButton.addEventListener("click", loadProducts);
  elements.sortSelect.addEventListener("change", loadProducts);
  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(loadProducts, 280);
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const url = new URL(elements.apiBaseUrl.value.trim());
      const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
        throw new Error("Produkcijski API mora koristiti HTTPS.");
      }
      state.apiBaseUrl = url.origin;
      state.apiToken = elements.apiToken.value.trim();
      localStorage.setItem(storageKeys.apiBaseUrl, state.apiBaseUrl);
      if (state.apiToken) localStorage.setItem(storageKeys.apiToken, state.apiToken);
      else localStorage.removeItem(storageKeys.apiToken);
      elements.settingsDialog.close();
      loadProducts();
    } catch (error) {
      elements.apiBaseUrl.setCustomValidity(error instanceof Error ? error.message : "URL nije ispravan.");
      elements.apiBaseUrl.reportValidity();
      window.setTimeout(() => elements.apiBaseUrl.setCustomValidity(""), 0);
    }
  });

  loadProducts();
})();

