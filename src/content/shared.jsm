// Application-wide state shared by every browser window's overlay.
//
// A JavaScript module (JSM) is instantiated once per application, so keeping
// the capture dedupe state here prevents each open browser window from sending
// the same download to the app again.
var EXPORTED_SYMBOLS = ["ABDMSharedState"];

var ABDMSharedState = {
  // Array of { url, when } recently handled download URLs.
  recent: [],
  // Map of url -> true for requests currently being delivered.
  inflight: {},
};
