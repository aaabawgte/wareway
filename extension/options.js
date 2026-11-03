(() => {
  "use strict";

  const form = document.querySelector("#settingsForm");
  const urlInput = document.querySelector("#apiBaseUrl");
  const tokenInput = document.querySelector("#apiToken");
  const status = document.querySelector("#status");

  function showStatus(message, error = false) {
    status.textContent = message;
    status.className = error ? "status error" : "status";
    status.hidden = false;
  }

  function permissionPattern(url) {
    return `${url.origin}/*`;
  }

  async function initialize() {
    const settings = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
    urlInput.value = settings.apiBaseUrl || "";
    tokenInput.value = settings.apiToken || "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;

    let parsedUrl;
    try {
      parsedUrl = new URL(urlInput.value.trim());
      const isLocal = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
      if (parsedUrl.protocol !== "https:" && !(isLocal && parsedUrl.protocol === "http:")) {
        throw new Error("Produkcijski API mora koristiti HTTPS.");
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "API adresa nije ispravna.", true);
      return;
    }

    const token = tokenInput.value.trim();
    if (token.length < 16) {
      showStatus("Token mora sadržavati najmanje 16 znakova.", true);
      return;
    }

    const origin = permissionPattern(parsedUrl);
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        showStatus("Bez dopuštenja za API domenu ekstenzija ne može slati artikle.", true);
        return;
      }
    }

    await chrome.storage.local.set({
      apiBaseUrl: parsedUrl.origin,
      apiToken: token
    });
    showStatus("Postavke su spremljene.");
  });

  initialize();
})();

