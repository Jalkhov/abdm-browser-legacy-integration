var ABDMOptions = {
  load: function () {
    try {
      const prefs = Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);

      const autoCaptureEl = document.getElementById("opt-autoCaptureLinks");
      if (autoCaptureEl) {
        autoCaptureEl.checked = prefs.getBoolPref(
          "abdm_legacy.autoCaptureLinks",
        );
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
      const prefs = Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);

      const autoCaptureEl = document.getElementById("opt-autoCaptureLinks");
      if (autoCaptureEl) {
        prefs.setBoolPref(
          "abdm_legacy.autoCaptureLinks",
          !!autoCaptureEl.checked,
        );
      }

      const fileTypesEl = document.getElementById("opt-registered-filetypes");
      if (fileTypesEl) {
        prefs.setCharPref("abdm_legacy.registeredFileTypes", fileTypesEl.value);
      }

      const patternsEl = document.getElementById("opt-ignored-patterns");
      if (patternsEl) {
        prefs.setCharPref("abdm_legacy.ignoredUrlPatterns", patternsEl.value);
      }

      window.close();
    } catch (e) {
      Components.utils.reportError("ABDMOptions save error: " + e);
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
  },
  false,
);
