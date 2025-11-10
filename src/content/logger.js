// Simple logger module for AB Download Manager Legacy (XUL)
// Provides consistent console/reportError logging across the chrome code.
var ABDMLogger = (function () {
  function safeConsole(fn, msg) {
    try {
      if (typeof console !== "undefined" && console && console[fn])
        console[fn]("ABDM: " + msg);
    } catch (e) {}
  }

  function safeReport(msg) {
    try {
      Components.utils.reportError("ABDM: " + msg);
    } catch (e) {}
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
