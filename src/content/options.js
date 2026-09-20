var ABDMOptions = {
  _getPrefs: function () {
    return Components.classes[
      "@mozilla.org/preferences-service;1"
    ].getService(Components.interfaces.nsIPrefBranch);
  },

  load: function () {
    try {
      const prefs = ABDMOptions._getPrefs();

      const autoCaptureEl = document.getElementById("opt-autoCaptureLinks");
      if (autoCaptureEl) {
        autoCaptureEl.checked = prefs.getBoolPref(
          "abdm_legacy.autoCaptureLinks",
        );
      }

      const apiKeyEl = document.getElementById("opt-api-key");
      if (apiKeyEl) {
        apiKeyEl.value = prefs.getCharPref("abdm_legacy.api_key");
      }

      const fileTypesEl = document.getElementById("opt-registered-filetypes");
      if (fileTypesEl) {
        fileTypesEl.value = prefs.getCharPref(
          "abdm_legacy.registeredFileTypes",
        );
      }

      const patternsEl = document.getElementById("opt-ignored-patterns");
      if (patternsEl) {
        patternsEl.value = prefs.getCharPref("abdm_legacy.ignoredUrlPatterns");
      }
    } catch (e) {
      Components.utils.reportError("ABDMOptions load error: " + e);
    }
  },

  save: function () {
    try {
      const prefs = ABDMOptions._getPrefs();

      const autoCaptureEl = document.getElementById("opt-autoCaptureLinks");
      if (autoCaptureEl) {
        prefs.setBoolPref(
          "abdm_legacy.autoCaptureLinks",
          !!autoCaptureEl.checked,
        );
      }

      const apiKeyEl = document.getElementById("opt-api-key");
      if (apiKeyEl) {
        prefs.setCharPref("abdm_legacy.api_key", apiKeyEl.value.trim());
      }

      const fileTypesEl = document.getElementById("opt-registered-filetypes");
      if (fileTypesEl) {
        prefs.setCharPref("abdm_legacy.registeredFileTypes", fileTypesEl.value);
      }

      const patternsEl = document.getElementById("opt-ignored-patterns");
      if (patternsEl) {
        prefs.setCharPref("abdm_legacy.ignoredUrlPatterns", patternsEl.value);
      }

      // Let the browser windows re-check the connection (API key / endpoint).
      try {
        const observerService = Components.classes[
          "@mozilla.org/observer-service;1"
        ].getService(Components.interfaces.nsIObserverService);
        observerService.notifyObservers(null, "abdm-prefs-changed", null);
      } catch (e) {}

      window.close();
    } catch (e) {
      Components.utils.reportError("ABDMOptions save error: " + e);
    }
  },

  _derivePingEndpoint: function (endpoint) {
    if (!endpoint) return "http://127.0.0.1:15151/ping";
    if (/\/add\/?(\?.*)?$/.test(endpoint)) {
      return endpoint.replace(/\/add\/?(\?.*)?$/, "/ping");
    }
    return endpoint.replace(/\/+$/, "") + "/ping";
  },

  testConnection: function () {
    const statusEl = document.getElementById("opt-api-status");
    const setStatus = function (text) {
      if (statusEl) statusEl.value = text;
    };
    try {
      const prefs = ABDMOptions._getPrefs();
      let endpoint = "http://127.0.0.1:15151/add";
      try {
        endpoint = prefs.getCharPref("abdm_legacy.http_endpoint") || endpoint;
      } catch (e) {}

      let apiKey = "";
      const apiKeyEl = document.getElementById("opt-api-key");
      if (apiKeyEl) apiKey = apiKeyEl.value.trim();

      setStatus("Checking...");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", ABDMOptions._derivePingEndpoint(endpoint), true);
      xhr.setRequestHeader("Content-Type", "application/json");
      if (apiKey) xhr.setRequestHeader("X-API-Key", apiKey);
      xhr.timeout = 2000;

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 401 || xhr.status === 403) {
          setStatus("Authentication failed (check the API Key)");
        } else if (xhr.status >= 200 && xhr.status < 500) {
          setStatus("Connected");
        } else {
          setStatus("No response (is ABDM running?)");
        }
      };
      xhr.onerror = function () {
        setStatus("No response (is ABDM running?)");
      };
      xhr.ontimeout = function () {
        setStatus("No response (is ABDM running?)");
      };
      xhr.send("null");
    } catch (e) {
      setStatus("Test failed");
      Components.utils.reportError("ABDMOptions testConnection error: " + e);
    }
  },
};

window.addEventListener(
  "load",
  function () {
    ABDMOptions.load();
    // Auto-adjust window size to fit content (basic heuristic)
    try {
      setTimeout(function () {
        try {
          const docEl = document.documentElement;
          const bodyBox = docEl.getBoundingClientRect();
          let desiredW = Math.max(520, Math.ceil(bodyBox.width) + 40);
          let desiredH = Math.max(420, Math.ceil(bodyBox.height) + 40);
          // Clamp to a reasonable max to avoid huge windows
          desiredW = Math.min(desiredW, 900);
          desiredH = Math.min(desiredH, 800);
          window.resizeTo(desiredW, desiredH);
        } catch (e) {}
      }, 60);
    } catch (e) {}
    // attach reset handler
    try {
      const btn = document.getElementById("opt-reset-patterns");
      if (btn)
        btn.addEventListener(
          "command",
          function () {
            try {
              document.getElementById("opt-ignored-patterns").value = "";
            } catch (e) {}
          },
          false,
        );
    } catch (e) {}
    // attach test connection handler
    try {
      const testBtn = document.getElementById("opt-test-connection");
      if (testBtn)
        testBtn.addEventListener(
          "command",
          function () {
            ABDMOptions.testConnection();
          },
          false,
        );
    } catch (e) {}
  },
  false,
);
