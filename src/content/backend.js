// Backend helper module for AB Download Manager Legacy (XUL overlay)
// Exposes a send(...) function that attempts to deliver a download request
// to the local AB Download Manager using the configured method (http/protocol/process/auto).
var ABDMBackend = (function () {
  // Default endpoints to try when none configured explicitly
  const DEFAULT_ENDPOINTS = ["http://127.0.0.1:15151/add"];

  function getPrefs() {
    try {
      return Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);
    } catch (e) {
      ABDMLogger.error("Cannot access preferences service: " + e);
      return null;
    }
  }

  // open protocol handler
  function openProtocol(url) {
    try {
      const abUrl = "abdm://add?url=" + encodeURIComponent(url);
      ABDMLogger.info("opening protocol URL " + abUrl);
      try {
        window.open(abUrl);
      } catch (e) {
        try {
          window.location = abUrl;
        } catch (e2) {}
      }
      return true;
    } catch (e) {
      ABDMLogger.error("protocol open error: " + e);
      return false;
    }
  }

  // fetch with timeout (uses AbortController)
  function fetchWithTimeout(endpoint, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      try {
        if (
          typeof fetch === "function" &&
          typeof AbortController === "function"
        ) {
          const controller = new AbortController();
          const id = setTimeout(function () {
            try {
              controller.abort();
            } catch (e) {}
          }, timeoutMs || 2000);
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: controller.signal,
          })
            .then(function (resp) {
              clearTimeout(id);
              resolve(resp);
            })
            .catch(function (err) {
              clearTimeout(id);
              reject(err);
            });
        } else {
          // fallback to XHR when fetch/AbortController not available
          try {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", endpoint, true);
            xhr.setRequestHeader(
              "Content-Type",
              "application/json;charset=UTF-8"
            );
            xhr.onreadystatechange = function () {
              if (xhr.readyState === 4) {
                // build a small response-like object
                resolve({
                  ok: xhr.status >= 200 && xhr.status < 300,
                  status: xhr.status,
                  responseText: xhr.responseText,
                });
              }
            };
            xhr.onerror = function (e) {
              reject(e);
            };
            xhr.send(payload);
          } catch (e) {
            reject(e);
          }
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  // Try a list of endpoints sequentially until one succeeds.
  function tryEndpoints(endpoints, payload) {
    return new Promise(function (resolve) {
      let i = 0;
      function next() {
        if (i >= endpoints.length) return resolve(false);
        const endpoint = endpoints[i++];
        ABDMLogger.info("HTTP POST to " + endpoint + " payload=" + payload);
        fetchWithTimeout(endpoint, payload, 2000)
          .then(function (resp) {
            try {
              const status = resp.status || (resp && resp.ok ? 200 : 0);
              ABDMLogger.info("HTTP response " + status + " for " + endpoint);
              try {
                const text =
                  resp.responseText ||
                  (typeof resp.text === "function" && resp.text
                    ? resp.text()
                    : null);
                if (text) {
                  // resp.text() may be a Promise when using fetch; attempt to print a snippet
                  if (typeof text === "string") {
                    ABDMLogger.info(
                      "HTTP response body (snippet): " +
                        text.substring(0, 1024).replace(/\n/g, " ")
                    );
                  } else if (typeof resp.text === "function") {
                    resp.text().then(function (t) {
                      ABDMLogger.info(
                        "HTTP response body (snippet): " +
                          (t || "").substring(0, 1024).replace(/\n/g, " ")
                      );
                    });
                  }
                }
              } catch (e) {}

              if (
                (resp.ok && resp.ok === true) ||
                (status >= 200 && status < 300)
              ) {
                resolve(true);
              } else {
                next();
              }
            } catch (e) {
              next();
            }
          })
          .catch(function (err) {
            ABDMLogger.warn(
              "HTTP XHR/fetch error to " + endpoint + " : " + err
            );
            next();
          });
      }
      next();
    });
  }

  // Build the payload array matching DownloadRequestItem minimal shape.
  function buildPayload(url, pageUrl, suggestedName) {
    const item = {
      link: url,
      downloadPage: pageUrl || null,
      headers: null,
      description: null,
      suggestedName: suggestedName || null,
      type: "http",
    };
    return JSON.stringify([item]);
  }

  return {
    // send returns a Promise<boolean> indicating success (true) or failure (false)
    send: function (url, pageUrl, suggestedName) {
      return new Promise(function (resolve) {
        const prefs = getPrefs();
        let method = "auto";
        let configuredEndpoint = null;
        try {
          if (prefs) method = prefs.getCharPref("abdm_legacy.method");
          try {
            configuredEndpoint = prefs.getCharPref("abdm_legacy.http_endpoint");
          } catch (e) {
            configuredEndpoint = null;
          }
        } catch (e) {
          method = "auto";
        }

        ABDMLogger.info(
          "configured method=" +
            method +
            (configuredEndpoint ? " endpoint=" + configuredEndpoint : "")
        );

        const payload = buildPayload(url, pageUrl, suggestedName);

        const endpoints = [];
        if (configuredEndpoint) endpoints.push(configuredEndpoint);
        DEFAULT_ENDPOINTS.forEach(function (d) {
          if (endpoints.indexOf(d) === -1) endpoints.push(d);
        });

        if (method === "protocol") {
          const ok = openProtocol(url);
          return resolve(!!ok);
        }

        if (method === "process") {
          // process launching is best done in the overlay code where nsIProcess is available.
          // Expose a small signal here to let overlay do it. For now, resolve false.
          ABDMLogger.warn(
            "method=process not implemented in ABDMBackend; overlay should handle it."
          );
          return resolve(false);
        }

        // HTTP-only or auto: try HTTP endpoints
        tryEndpoints(endpoints, payload).then(function (success) {
          if (success) return resolve(true);
          if (method === "http") return resolve(false);
          // auto -> fallback to protocol
          const ok = openProtocol(url);
          return resolve(!!ok);
        });
      });
    },
  };
})();
