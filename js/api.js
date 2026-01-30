(() => {
  const API = {};

  const STORE_KEY = "SAEZ_GAS_URL";

  // Carga URL guardada (si existe)
API.GAS_URL = 'https://script.google.com/macros/s/AKfycbxQczhFebt8z0ZVAVeJsfLkUGkVBins2iIMhifSgPFf5vwfYpwGlrmSkKXxIo9nhPY4/exec';

  API.getGasUrl = () => API.GAS_URL;

  API.setGasUrl = (url) => {
    const u = (url || "").trim();

    if (!u) {
      API.GAS_URL = "";
      localStorage.removeItem(STORE_KEY);
      return;
    }

    // Validación básica: tiene que ser Apps Script Web App
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(\?.*)?$/i.test(u)) {
      throw new Error("URL inválida. Debe ser una URL de Apps Script tipo .../macros/s/XXXX/exec");
    }

    API.GAS_URL = u;
    localStorage.setItem(STORE_KEY, API.GAS_URL);
  };

  API.clearGasUrl = () => {
    API.GAS_URL = "";
    localStorage.removeItem(STORE_KEY);
  };

  function jsonp(url, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cbName = "cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");

      // Evitar cache
      const qs = new URLSearchParams({
        ...params,
        callback: cbName,
        ts: Date.now().toString(),
      });

      let done = false;

      const cleanup = () => {
        try {
          delete window[cbName];
        } catch (e) {}
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Timeout: el Apps Script tardó demasiado en responder."));
      }, timeoutMs);

      window[cbName] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.src = url + (url.includes("?") ? "&" : "?") + qs.toString();

      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error("No se pudo cargar el script (error de red o URL incorrecta)."));
      };

      document.head.appendChild(script);
    });
  }

  API.getData = async (dateISO = "") => {
    if (!API.GAS_URL) {
      throw new Error("Falta configurar GAS_URL. Pegá la URL del Web App de Apps Script.");
    }

    const data = await jsonp(API.GAS_URL, { action: "getData", date: dateISO || "" });

    // Si el backend devuelve ok:false, lo levantamos como error
    if (data && data.ok === false) {
      throw new Error(data.error || "El Apps Script devolvió ok=false.");
    }

    // Normalizar shape
    return {
      ok: true,
      arrivals: Array.isArray(data.arrivals) ? data.arrivals : [],
      departures: Array.isArray(data.departures) ? data.departures : [],
      fetchedAt: data.fetchedAt || null,
    };
  };

  // Helper: pedir URL al usuario (opcional)
  API.promptForGasUrl = () => {
    const current = API.GAS_URL || "";
    const url = prompt("Pegá la URL de tu Apps Script (Web App) para leer Google Sheets:", current);
    if (url === null) return false; // canceló
    API.setGasUrl(url);
    return true;
  };

  window.SAEZ_API = API;
})();
