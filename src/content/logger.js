// Simple logger module for AB Download Manager Legacy (XUL)
// Provides consistent console/reportError logging across the chrome code.
var ABDMLogger = (function () {
  function safeConsole(fn, msg) {
    if (
      typeof console !== "undefined" &&
      console &&
      typeof console[fn] === "function"
    ) {
      console[fn]("ABDM: " + msg);
    }
  }

  function safeReport(msg) {
    if (
      typeof Components !== "undefined" &&
      Components.utils &&
      typeof Components.utils.reportError === "function"
    ) {
      Components.utils.reportError("ABDM: " + msg);
    }
  }

  return {
    info: function (msg) {
      safeConsole("info", msg);
    },
    warn: function (msg) {
      safeConsole("warn", msg);
      // also report warning-level to Browser Console for visibility
      safeReport("WARN: " + msg);
    },
    error: function (msg) {
      safeConsole("error", msg);
      safeReport("ERROR: " + msg);
    },
  };
})();
