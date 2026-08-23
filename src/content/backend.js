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
            controller.abort();
          }, timeoutMs || 2000);

          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: controller.signal,
          })
            .then(function (resp) {
              clearTimeout(id);
              // Estandarizar la respuesta para evitar lidiar con promesas de texto en tryEndpoints
              resp
                .text()
                .then(function (text) {
                  resolve({
                    ok: resp.ok,
                    status: resp.status,
                    responseText: text,
                  });
                })
                .catch(function () {
                  resolve({
                    ok: resp.ok,
                    status: resp.status,
                    responseText: "",
                  });
                });
            })
            .catch(function (err) {
              clearTimeout(id);
              reject(err);
            });
        } else {
          // fallback to XHR when fetch/AbortController not available
          const xhr = new XMLHttpRequest();
          xhr.open("POST", endpoint, true);
          xhr.setRequestHeader(
            "Content-Type",
            "application/json;charset=UTF-8",
          );
          xhr.timeout = timeoutMs || 2000;

          xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
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
          xhr.ontimeout = function () {
            reject(new Error("Timeout"));
          };
          xhr.send(payload);
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
            const status = resp.status || 0;
            ABDMLogger.info("HTTP response " + status + " for " + endpoint);

            if (resp.responseText) {
              ABDMLogger.info(
                "HTTP response body (snippet): " +
                  resp.responseText.substring(0, 1024).replace(/\n/g, " "),
              );
            }

            if (resp.ok || (status >= 200 && status < 300)) {
              resolve(true);
            } else {
              next();
            }
          })
          .catch(function (err) {
            ABDMLogger.warn("HTTP request error to " + endpoint + " : " + err);
            next();
          });
      }
      next();
    });
  }
  // Build the payload array matching DownloadRequestItem minimal shape.
  function buildPayload(url, pageUrl, suggestedName, headers) {
    const item = {
      link: url,
      downloadPage: pageUrl || null,
      // Si se envían headers, los asignamos; de lo contrario null
      headers: headers && Object.keys(headers).length > 0 ? headers : null,
      description: null,
      suggestedName: suggestedName || null,
      type: "http",
    };
    return JSON.stringify([item]);
  }

  return {
    // send returns a Promise<boolean> indicating success (true) or failure (false)
    send: function (url, pageUrl, suggestedName, headers) {
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
            (configuredEndpoint ? " endpoint=" + configuredEndpoint : ""),
        );

        // Pasamos los headers al payload
        const payload = buildPayload(url, pageUrl, suggestedName, headers);

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
          ABDMLogger.warn(
            "method=process not implemented in ABDMBackend; overlay should handle it.",
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
