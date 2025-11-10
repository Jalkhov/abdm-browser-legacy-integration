function openABDMOptions() {
  try {
    window.openDialog(
      "chrome://abdm_legacy/content/options.xul",
      "abdm-options",
      "chrome,centerscreen"
    );
  } catch (e) {
    Components.utils.reportError("openABDMOptions error: " + e);
  }
}

window.addEventListener(
  "load",
  function () {
    // No automatic refresh; placeholder only.
  },
  false
);
