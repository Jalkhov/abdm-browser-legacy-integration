// Backend helper module for AB Download Manager Legacy (XUL overlay)
// Exposes a send(...) function that attempts to deliver a download request
// to the local AB Download Manager using the configured method (http/protocol/process/auto).
var ABDMBackend = (function () {
  // Default endpoints to try when none configured explicitly
  const DEFAULT_ENDPOINTS = ["http://127.0.0.1:15151/add"];

  // Headers that must NOT be forwarded to the download manager. They are
  // hop-by-hop, encoding, conditional or bookkeeping headers that can change
  // the meaning of the request and make ABDM fetch a wrong / partial body
  // (for example "Range" -> only a chunk, "Accept-Encoding" -> compressed).
  const HEADER_BLACKLIST = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "accept-encoding",
    "content-length",
    "content-range",
    "range",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
    "if-range",
    "expect",
    "via",
  ];

  function sanitizeHeaders(headers) {
    if (!headers) return null;
    const out = {};
    for (const name in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, name)) continue;
      const lower = String(name).toLowerCase();
      if (HEADER_BLACKLIST.indexOf(lower) !== -1) continue;
      if (lower.indexOf("proxy-") === 0) continue;
      if (lower.indexOf("sec-") === 0) continue;
      const value = headers[name];
      if (value === undefined || value === null || value === "") continue;
      out[name] = String(value);
    }
    return Object.keys(out).length > 0 ? out : null;
  }

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

  function readApiKey(prefs) {
    try {
      return (prefs && prefs.getCharPref("abdm_legacy.api_key")) || "";
    } catch (e) {
      return "";
    }
  }

  function readOptions(prefs) {
    const options = { silentAdd: false, silentStart: false };
    try {
      options.silentAdd = prefs.getBoolPref("abdm_legacy.silentAddDownload");
    } catch (e) {}
    try {
      options.silentStart = prefs.getBoolPref("abdm_legacy.silentStartDownload");
    } catch (e) {}
    return options;
  }

  function authHeadersFromKey(apiKey) {
    return apiKey ? { "X-API-Key": apiKey } : {};
  }

  // Check whether the browser knows a handler for the abdm:// scheme. This
  // avoids opening a broken tab (and reporting success) when the app has not
  // registered the protocol.
  function protocolHandlerExists() {
    try {
      const eps = Components.classes[
        "@mozilla.org/uriloader/external-protocol-service;1"
      ].getService(Components.interfaces.nsIExternalProtocolService);
      return eps.externalProtocolHandlerExists("abdm");
    } catch (e) {
      return false;
    }
  }

  // open protocol handler
  function openProtocol(url) {
    const abUrl = "abdm://add?url=" + encodeURIComponent(url);
    if (!protocolHandlerExists()) {
      ABDMLogger.warn(
        "abdm:// protocol handler is not registered; cannot use the protocol method",
      );
      return false;
    }
    ABDMLogger.info("opening protocol URL " + abUrl);
    try {
      // NOTE: never fall back to assigning window.location here; this code runs
      // in a chrome (browser) window and navigating it would be destructive.
      window.open(abUrl);
      return true;
    } catch (e) {
      ABDMLogger.error("protocol open error: " + e);
      return false;
    }
  }

  // fetch with timeout (uses AbortController when available, XHR otherwise)
  function fetchWithTimeout(endpoint, payload, timeoutMs, extraHeaders) {
    return new Promise(function (resolve, reject) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (extraHeaders) {
          for (const k in extraHeaders) {
            if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) {
              headers[k] = extraHeaders[k];
            }
          }
        }

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
            headers: headers,
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
          for (const k in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, k)) {
              try {
                xhr.setRequestHeader(k, headers[k]);
              } catch (e) {}
            }
          }
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
  function tryEndpoints(endpoints, payload, extraHeaders) {
    return new Promise(function (resolve) {
      let i = 0;
      function next() {
        if (i >= endpoints.length) return resolve(false);
        const endpoint = endpoints[i++];
        ABDMLogger.info("HTTP POST to " + endpoint);

        fetchWithTimeout(endpoint, payload, 2000, extraHeaders)
          .then(function (resp) {
            const status = resp.status || 0;
            ABDMLogger.info("HTTP response " + status + " for " + endpoint);

            if (resp.responseText) {
              ABDMLogger.info(
                "HTTP response body (snippet): " +
                  resp.responseText.substring(0, 256).replace(/\n/g, " "),
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

  // Build the payload matching the current ABDM contract:
  //   { items: [ { link, downloadPage, headers, suggestedName, type } ],
  //     options: { silentAdd, silentStart } }
  // The legacy bare-array format is deprecated on the server and cannot carry
  // options, so `silentAdd` / `silentStart` would be ignored.
  function buildPayload(url, pageUrl, suggestedName, headers, options) {
    const item = {
      link: url,
      downloadPage: pageUrl || null,
      headers: headers && Object.keys(headers).length > 0 ? headers : null,
      suggestedName: suggestedName || null,
      type: "http",
    };
    return JSON.stringify({
      items: [item],
      options: options || { silentAdd: false, silentStart: false },
    });
  }

  // Derive a /ping endpoint from the configured (or default) /add endpoint.
  function derivePingEndpoint(endpoint) {
    if (!endpoint) return "http://127.0.0.1:15151/ping";
    if (/\/add\/?(\?.*)?$/.test(endpoint)) {
      return endpoint.replace(/\/add\/?(\?.*)?$/, "/ping");
    }
    return endpoint.replace(/\/+$/, "") + "/ping";
  }

  function configuredEndpoint(prefs) {
    try {
      return prefs ? prefs.getCharPref("abdm_legacy.http_endpoint") : null;
    } catch (e) {
      return null;
    }
  }

  // Lightweight reachability check used to avoid cancelling a browser download
  // when ABDM is not running. Resolves:
  //   true  -> the server responded (reachable)
  //   false -> network error/timeout or authentication failure (401/403)
  function ping(timeoutMs) {
    return new Promise(function (resolve) {
      const prefs = getPrefs();
      const apiKey = readApiKey(prefs);
      const endpoint = derivePingEndpoint(
        configuredEndpoint(prefs) || DEFAULT_ENDPOINTS[0],
      );
      fetchWithTimeout(endpoint, "null", timeoutMs || 1200, authHeadersFromKey(apiKey))
        .then(function (resp) {
          const status = resp.status || 0;
          if (status === 401 || status === 403) return resolve(false);
          resolve(true);
        })
        .catch(function () {
          resolve(false);
        });
    });
  }

  return {
    // send returns a Promise<boolean> indicating success (true) or failure (false)
    send: function (url, pageUrl, suggestedName, headers) {
      return new Promise(function (resolve) {
        const prefs = getPrefs();
        let method = "auto";
        try {
          if (prefs) method = prefs.getCharPref("abdm_legacy.method");
        } catch (e) {
          method = "auto";
        }
        const endpoint = configuredEndpoint(prefs);
        const apiKey = readApiKey(prefs);
        const options = readOptions(prefs);
        const authHeaders = authHeadersFromKey(apiKey);

        ABDMLogger.info(
          "configured method=" +
            method +
            (endpoint ? " endpoint=" + endpoint : "") +
            " apiKey=" +
            (apiKey ? "set" : "none") +
            " silentAdd=" +
            options.silentAdd +
            " silentStart=" +
            options.silentStart,
        );

        // Sanitize and build the payload. NOTE: never log the payload itself:
        // it contains cookies / authorization headers.
        const safeHeaders = sanitizeHeaders(headers);
        const payload = buildPayload(url, pageUrl, suggestedName, safeHeaders, options);

        const endpoints = [];
        if (endpoint) endpoints.push(endpoint);
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
        tryEndpoints(endpoints, payload, authHeaders).then(function (success) {
          if (success) return resolve(true);
          if (method === "http") return resolve(false);
          // auto -> fallback to protocol
          const ok = openProtocol(url);
          return resolve(!!ok);
        });
      });
    },

    // Reachability check (used by the overlay before cancelling downloads).
    ping: ping,

    // Exposed for reuse/testing.
    sanitizeHeaders: sanitizeHeaders,
  };
})();
