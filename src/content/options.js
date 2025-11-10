var ABDMOptions = {
  load: function () {
    try {
      const prefs = Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);
      // UI related prefs
      try {
        document.getElementById("opt-autoCaptureLinks").checked =
          prefs.getBoolPref("abdm_legacy.autoCaptureLinks");
      } catch (e) {}

      // registered file types: stored as space-separated string in pref
      try {
        const types = prefs.getCharPref("abdm_legacy.registeredFileTypes");
        if (types !== undefined)
          document.getElementById("opt-registered-filetypes").value = types;
      } catch (e) {}

      // ignored patterns
      try {
        document.getElementById("opt-ignored-patterns").value =
          prefs.getCharPref("abdm_legacy.ignoredUrlPatterns");
      } catch (e) {}
    } catch (e) {
      Components.utils.reportError("ABDMOptions load error: " + e);
    }
  },
  save: function () {
    try {
      const prefs = Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);
      // UI prefs
      try {
        prefs.setBoolPref(
          "abdm_legacy.autoCaptureLinks",
          !!document.getElementById("opt-autoCaptureLinks").checked
        );
      } catch (e) {}
      try {
        prefs.setCharPref(
          "abdm_legacy.registeredFileTypes",
          document.getElementById("opt-registered-filetypes").value
        );
      } catch (e) {}
      try {
        prefs.setCharPref(
          "abdm_legacy.ignoredUrlPatterns",
          document.getElementById("opt-ignored-patterns").value
        );
      } catch (e) {}
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
          false
        );
    } catch (e) {}
  },
  false
);
