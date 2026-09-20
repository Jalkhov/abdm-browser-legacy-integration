var ABDMPort = {
  // recent captures for UI
  _recent: [],
  // lightweight logger: prefer console if available so messages appear
  // as info/warn in Browser Console instead of error-level reportError.
  _log: function (level, msg) {
    const prefix = "ABDMPort: ";

    // Prefer the central logger if available
    if (
      typeof ABDMLogger !== "undefined" &&
      ABDMLogger &&
      typeof ABDMLogger[level] === "function"
    ) {
      ABDMLogger[level](msg);
      return;
    }

    // Fallback to console
    if (
      typeof console !== "undefined" &&
      console &&
      typeof console[level] === "function"
    ) {
      console[level](prefix + msg);
      return;
    }

    // Fallback to Components console
    Components.utils.reportError(prefix + msg);
  },

  _getHeadersForUrl: function (url, pageUrl) {
    let headers = {};

    // Extraer User-Agent
    headers["User-Agent"] = window.navigator.userAgent;

    // Extraer Referer
    if (pageUrl) {
      headers["Referer"] = pageUrl;
    }

    // Extraer Cookies usando nsICookieService
    try {
      const ioService = Components.classes[
        "@mozilla.org/network/io-service;1"
      ].getService(Components.interfaces.nsIIOService);
      const uri = ioService.newURI(url, null, null);
      const cookieService = Components.classes[
        "@mozilla.org/cookieService;1"
      ].getService(Components.interfaces.nsICookieService);

      const cookieString = cookieService.getCookieString(uri, null);
      if (cookieString) {
        headers["Cookie"] = cookieString;
      }
    } catch (e) {
      ABDMPort._log("warn", "No se pudieron obtener las cookies para " + url);
    }

    return headers;
  },

  init: function () {
    // Insertar el menuitem en el menú contextual de contenido
    try {
      let cm = document.getElementById("contentAreaContextMenu");
      if (cm && !document.getElementById("abdm-send-link")) {
        // document.createXULElement may not be available in all chrome contexts;
        // use createElement which works in both XUL and HTML chrome documents.
        let menuItem = document.createElement("menuitem");
        menuItem.setAttribute("id", "abdm-send-link");
        menuItem.setAttribute("label", "Enviar a AB Download Manager");
        menuItem.addEventListener(
          "command",
          function () {
            ABDMPort.onSendLinkCommand();
          },
          false,
        );
        cm.appendChild(menuItem);
      }

      // Monitor popup show to toggle visibilidad según el nodo
      if (cm) {
        cm.addEventListener(
          "popupshowing",
          function () {
            ABDMPort.updateContextMenu(cm);
          },
          false,
        );
      }

      // Passive link grabber (only useful for the not-yet-implemented batch
      // download feature). Disabled by default to avoid overhead and the risk
      // of interfering with pages.
      try {
        if (ABDMPort._isLinkGrabberEnabled()) {
          ABDMPort._installLinkGrabber();
        }
      } catch (e) {
        Components.utils.reportError("ABDMPort init inject error: " + e);
      }
      // migrate prefs from old names, sync UI checkboxes and attempt to place toolbar button
      try {
        ABDMPort._migratePrefs();
      } catch (e) {}
      try {
        ABDMPort.syncMenuState();
      } catch (e) {}
      try {
        ABDMPort._placeToolbarButtonIfMissing();
      } catch (e) {}
      try {
        // Register network observer for automatic (non-click) downloads
        ABDMPort._maybeRegisterNetObserver();
      } catch (e) {
        ABDMPort._log("warn", "net observer registration error: " + e);
      }
      try {
        ABDMPort._registerPrefsObserver();
      } catch (e) {}
    } catch (e) {
      Components.utils.reportError("ABDMPort init error: " + e);
    }
  },

  _netObserverRegistered: false,
  _netObserver: null,
  // Reachability state: null = unknown, true = reachable, false = unreachable.
  _abdmOnline: null,
  _healthTimer: null,
  _healthInFlight: false,
  _prefsObserver: null,

  // How often (ms) we re-check that ABDM is reachable.
  HEALTH_INTERVAL_MS: 15000,

  _allowPassDownloadIfAppNotRespond: function () {
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return true;
      return prefs.getBoolPref("abdm_legacy.allowPassDownloadIfAppNotRespond");
    } catch (e) {
      return true;
    }
  },

  _checkAbdmHealth: function () {
    if (ABDMPort._healthInFlight) return;
    if (typeof ABDMBackend === "undefined" || !ABDMBackend.ping) return;
    ABDMPort._healthInFlight = true;
    try {
      ABDMBackend.ping(1200).then(
        function (online) {
          ABDMPort._healthInFlight = false;
          ABDMPort._abdmOnline = !!online;
        },
        function () {
          ABDMPort._healthInFlight = false;
          ABDMPort._abdmOnline = false;
        },
      );
    } catch (e) {
      ABDMPort._healthInFlight = false;
    }
  },

  _startHealthMonitor: function () {
    ABDMPort._checkAbdmHealth();
    if (ABDMPort._healthTimer) return;
    try {
      ABDMPort._healthTimer = setInterval(function () {
        ABDMPort._checkAbdmHealth();
      }, ABDMPort.HEALTH_INTERVAL_MS);
    } catch (e) {}
  },

  _stopHealthMonitor: function () {
    if (ABDMPort._healthTimer) {
      try {
        clearInterval(ABDMPort._healthTimer);
      } catch (e) {}
      ABDMPort._healthTimer = null;
    }
  },

  // Hand a download back to the browser when ABDM could not take it, so the
  // user does not lose the file after we cancelled the original channel.
  _fallbackNativeDownload: function (url, filename, pageUrl) {
    try {
      // Prevent the observer from re-capturing the retried request.
      ABDMPort._recent.unshift({ url: url, when: Date.now() });
      if (ABDMPort._recent.length > 200) ABDMPort._recent.length = 200;

      // Preferred: the browser's own save routine
      // (toolkit/content/contentAreaUtils.js). It is exposed as a global in the
      // browser window, re-issues the request with cookies and goes through the
      // normal download flow (download manager, prompts, etc.).
      // Signature: saveURL(url, fileName, pickerTitleKey, bypassCache,
      //                    skipPrompt, referrer, sourceDoc, isPrivate).
      if (typeof saveURL === "function") {
        try {
          saveURL(url, filename || null, null, true, false, null, null, false);
          ABDMPort._log(
            "info",
            "fallback: re-issued download via saveURL: " + url,
          );
          return true;
        } catch (e) {
          ABDMPort._log("warn", "fallback: saveURL failed: " + e);
        }
      }

      if (
        typeof gBrowser !== "undefined" &&
        gBrowser &&
        typeof gBrowser.saveURL === "function"
      ) {
        try {
          gBrowser.saveURL(
            url,
            filename || null,
            null,
            null,
            pageUrl || null,
            false,
            false,
            null,
          );
          ABDMPort._log(
            "info",
            "fallback: re-issued download via gBrowser.saveURL: " + url,
          );
          return true;
        } catch (e) {
          ABDMPort._log("warn", "fallback: gBrowser.saveURL failed: " + e);
        }
      }

      // Last resort: open a background tab so the browser downloads it.
      if (
        typeof gBrowser !== "undefined" &&
        gBrowser &&
        typeof gBrowser.addTab === "function"
      ) {
        try {
          gBrowser.addTab(url, { inBackground: true });
          ABDMPort._log(
            "info",
            "fallback: opened a background tab for " + url,
          );
          return true;
        } catch (e) {
          ABDMPort._log("warn", "fallback: gBrowser.addTab failed: " + e);
        }
      }

      ABDMPort._log(
        "error",
        "fallback: no way to re-issue the download for " + url,
      );
      return false;
    } catch (e) {
      ABDMPort._log(
        "error",
        "fallback: could not hand download back to the browser: " + e,
      );
      return false;
    }
  },

  _registerPrefsObserver: function () {
    if (ABDMPort._prefsObserver) return;
    try {
      const observerService = Components.classes[
        "@mozilla.org/observer-service;1"
      ].getService(Components.interfaces.nsIObserverService);
      ABDMPort._prefsObserver = {
        observe: function (subject, topic, data) {
          if (topic !== "abdm-prefs-changed") return;
          // autoCaptureLinks may have been toggled in the options window.
          try {
            ABDMPort._maybeRegisterNetObserver();
          } catch (e) {}
          try {
            ABDMPort._checkAbdmHealth();
          } catch (e) {}
        },
      };
      observerService.addObserver(
        ABDMPort._prefsObserver,
        "abdm-prefs-changed",
        false,
      );
    } catch (e) {
      ABDMPort._prefsObserver = null;
    }
  },

  _unregisterPrefsObserver: function () {
    if (!ABDMPort._prefsObserver) return;
    try {
      const observerService = Components.classes[
        "@mozilla.org/observer-service;1"
      ].getService(Components.interfaces.nsIObserverService);
      observerService.removeObserver(
        ABDMPort._prefsObserver,
        "abdm-prefs-changed",
      );
    } catch (e) {}
    ABDMPort._prefsObserver = null;
  },

  // Minimum capture size in bytes (0 = no minimum).
  _getMinCaptureBytes: function () {
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return 0;
      const kb = prefs.getIntPref("abdm_legacy.captureFileSizeMinimumKb");
      return kb > 0 ? kb * 1024 : 0;
    } catch (e) {
      return 0;
    }
  },

  // True when the URL belongs to the configured ABDM endpoint (so we never
  // capture the response of our own requests).
  _isAbdmEndpointUrl: function (url) {
    try {
      const prefs = ABDMPort._getPrefs();
      let endpoint = "http://127.0.0.1:15151/add";
      try {
        endpoint = prefs.getCharPref("abdm_legacy.http_endpoint") || endpoint;
      } catch (e) {}
      const m = /^https?:\/\/[^/]+/i.exec(endpoint);
      return m
        ? url.toLowerCase().indexOf(m[0].toLowerCase()) === 0
        : false;
    } catch (e) {
      return false;
    }
  },

  _maybeRegisterNetObserver: function () {
    const prefs = ABDMPort._getPrefs();
    if (!prefs) return;

    const enabled = prefs.getBoolPref("abdm_legacy.autoCaptureLinks");
    if (!enabled) {
      ABDMPort._maybeUnregisterNetObserver();
      return;
    }

    if (ABDMPort._netObserverRegistered) return;

    const Cc = Components.classes;
    const Ci = Components.interfaces;
    const observerService = Cc["@mozilla.org/observer-service;1"].getService(
      Ci.nsIObserverService,
    );

    ABDMPort._netObserver = {
      observe: function (subject, topic, data) {
        if (topic !== "http-on-examine-response") return;

        const channel = subject.QueryInterface(Ci.nsIHttpChannel);
        const url = channel.URI ? channel.URI.spec : null;
        if (!url) return;

        // Never capture the response of the requests we make to ABDM itself.
        if (ABDMPort._isAbdmEndpointUrl(url)) return;

        // Skip non-2xx status codes (e.g. 403 Forbidden, 404 Not Found, Captchas)
        try {
          if (channel.responseStatus < 200 || channel.responseStatus >= 300)
            return;
        } catch (e) {}

        // Skip HTML or plain text components (prevents capturing error pages as downloads)
        const contentType = channel.contentType || "";
        if (contentType.toLowerCase().startsWith("text/")) return;

        // Skip already processed via click (recent dedupe)
        for (let i = 0; i < ABDMPort._recent.length; i++) {
          const it = ABDMPort._recent[i];
          if (it && it.url === url && Date.now() - it.when < 5000) return;
        }

        // Read the filters on every event so changes made in Options apply
        // immediately without having to re-register the observer.
        const ignorePatterns = ABDMPort._getIgnoredPatterns();
        if (ignorePatterns.some((pattern) => url.includes(pattern))) return;
        const registeredExts = ABDMPort._getRegisteredExtensions();

        // Examine content-disposition and extension
        const disposition =
          channel.getResponseHeader("Content-Disposition") || "";
        const filename =
          ABDMPort._filenameFromDisposition(disposition) ||
          ABDMPort._filenameFromUrl(url) ||
          "";
        const lowerFilename = filename.toLowerCase();

        // Determine the content policy type of this load.
        let policyType = null;
        try {
          if (channel.loadInfo) {
            if (
              typeof channel.loadInfo.externalContentPolicyType !== "undefined"
            ) {
              policyType = channel.loadInfo.externalContentPolicyType;
            } else if (
              typeof channel.loadInfo.contentPolicyType !== "undefined"
            ) {
              policyType = channel.loadInfo.contentPolicyType;
            }
          }
        } catch (e) {}

        const CP = Ci.nsIContentPolicy;

        // Skip subresource loads (XHR/fetch, media, images, scripts, fonts,
        // ...). They are the main source of unwanted captures on modern web
        // apps and are never user-initiated downloads.
        const SUBRESOURCE_TYPES = CP
          ? [
              CP.TYPE_SCRIPT,
              CP.TYPE_IMAGE,
              CP.TYPE_STYLESHEET,
              CP.TYPE_OBJECT,
              CP.TYPE_XBL,
              CP.TYPE_PING,
              CP.TYPE_XMLHTTPREQUEST,
              CP.TYPE_OBJECT_SUBREQUEST,
              CP.TYPE_DTD,
              CP.TYPE_FONT,
              CP.TYPE_MEDIA,
              CP.TYPE_WEBSOCKET,
              CP.TYPE_CSP_REPORT,
              CP.TYPE_XSLT,
              CP.TYPE_BEACON,
              CP.TYPE_FETCH,
              CP.TYPE_IMAGESET,
              CP.TYPE_WEB_MANIFEST,
            ]
          : [];
        if (policyType !== null && SUBRESOURCE_TYPES.indexOf(policyType) !== -1) {
          return;
        }

        // Determine if this is a top-level document load.
        let isTopLevel = false;
        if (policyType !== null) {
          isTopLevel = policyType === (CP ? CP.TYPE_DOCUMENT : 6);
        } else if (channel.loadFlags) {
          const LOAD_DOCUMENT_URI = Ci.nsIChannel.LOAD_DOCUMENT_URI;
          isTopLevel =
            (channel.loadFlags & LOAD_DOCUMENT_URI) === LOAD_DOCUMENT_URI;
        }

        let matched = false;
        const isAttachment = /attachment/i.test(disposition);

        // Capture real frame/document attachments, or a top-level navigation
        // to a registered extension. When the content policy type is unknown
        // (older builds) keep the permissive attachment behaviour.
        if (isAttachment) {
          matched = true;
        } else if (isTopLevel) {
          matched = registeredExts.some(
            (ext) =>
              lowerFilename.endsWith("." + ext) ||
              (contentType && contentType.toLowerCase().includes(ext)),
          );
        }

        if (!matched) return;

        // Respect a minimum file size so empty/tiny responses are not captured.
        const minBytes = ABDMPort._getMinCaptureBytes();
        if (minBytes > 0) {
          let contentLength = -1;
          try {
            contentLength = parseInt(
              channel.getResponseHeader("Content-Length"),
              10,
            );
          } catch (e) {}
          if (
            !isNaN(contentLength) &&
            contentLength >= 0 &&
            contentLength < minBytes
          )
            return;
        }

        // Never cancel a download unless we know ABDM is reachable. Otherwise
        // the user would lose the file (browser cancelled + app not running).
        const allowPass = ABDMPort._allowPassDownloadIfAppNotRespond();
        if (allowPass && ABDMPort._abdmOnline === false) {
          ABDMPort._log(
            "info",
            "ABDM unreachable; letting the browser handle: " + url,
          );
          // Refresh the reachability state for the next download.
          ABDMPort._checkAbdmHealth();
          return;
        }

        // Extract EXACT request headers sent by the browser to bypass anti-bot protections
        let exactRequestHeaders = {};
        try {
          channel.visitRequestHeaders({
            visitHeader: function (name, value) {
              exactRequestHeaders[name] = value;
            },
          });
        } catch (e) {
          ABDMPort._log("warn", "Failed to extract exact request headers");
        }

        // Cancel browser download before it prompts user
        try {
          channel.cancel(Components.results.NS_BINDING_ABORTED);
        } catch (e) {
          ABDMPort._log("warn", "Failed to cancel browser download: " + e);
        }

        ABDMPort._log(
          "info",
          "Net observer captured auto download: " +
            url +
            (filename ? " (" + filename + ")" : ""),
        );

        const pageUrl = channel.referrer ? channel.referrer.spec : null;

        // Schedule async to avoid interfering with observers chain
        setTimeout(function () {
          // Pass the exact headers directly to sendToAB
          ABDMPort.sendToAB(url, pageUrl, filename, exactRequestHeaders).then(
            function (success) {
              if (success) {
                ABDMPort._abdmOnline = true;
                return;
              }
              ABDMPort._abdmOnline = false;
              // We already cancelled the browser download, so hand it back so
              // the user still gets the file.
              if (allowPass) {
                ABDMPort._fallbackNativeDownload(url, filename, pageUrl);
              }
            },
          );
        }, 0);
      },
    };

    try {
      observerService.addObserver(
        ABDMPort._netObserver,
        "http-on-examine-response",
        false,
      );
      ABDMPort._netObserverRegistered = true;
      ABDMPort._startHealthMonitor();
      ABDMPort._log("info", "Network observer registered");
    } catch (e) {
      ABDMPort._log("error", "Failed to register net observer: " + e);
    }
  },
  _maybeUnregisterNetObserver: function () {
    if (!ABDMPort._netObserverRegistered) return;
    try {
      const observerService = Components.classes[
        "@mozilla.org/observer-service;1"
      ].getService(Components.interfaces.nsIObserverService);
      observerService.removeObserver(
        ABDMPort._netObserver,
        "http-on-examine-response",
      );
      ABDMPort._netObserverRegistered = false;
      ABDMPort._netObserver = null;
      ABDMPort._stopHealthMonitor();
      ABDMPort._log("info", "network observer unregistered");
    } catch (e) {
      ABDMPort._log("warn", "error unregistering net observer: " + e);
    }
  },

  _getRegisteredExtensions: function () {
    let list = [];
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return list;
      const raw = prefs.getCharPref("abdm_legacy.registeredFileTypes");
      list = raw
        .split(/[\s,]+/)
        .map(function (t) {
          return t.trim().toLowerCase();
        })
        .filter(Boolean);
    } catch (e) {}
    return list;
  },
  _getIgnoredPatterns: function () {
    let list = [];
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return list;
      const raw = prefs.getCharPref("abdm_legacy.ignoredUrlPatterns");
      list = raw
        .split(/\n+/)
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);
    } catch (e) {}
    return list;
  },
  _filenameFromDisposition: function (disp) {
    if (!disp) return null;
    try {
      // filename*= or filename=
      let m = disp.match(/filename\*=UTF-8''([^;]+)$/i);
      if (m) return decodeURIComponent(m[1].replace(/"/g, ""));
      m = disp.match(/filename="?([^";]+)"?/i);
      if (m) return m[1];
    } catch (e) {}
    return null;
  },
  _filenameFromUrl: function (u) {
    if (!u) return null;
    try {
      const part = u.split(/[?#]/)[0];
      const seg = part.substring(part.lastIndexOf("/") + 1);
      if (seg) return decodeURIComponent(seg);
    } catch (e) {}
    return null;
  },

  _isLinkGrabberEnabled: function () {
    try {
      const prefs = ABDMPort._getPrefs();
      return prefs ? prefs.getBoolPref("abdm_legacy.enableLinkGrabber") : false;
    } catch (e) {
      return false;
    }
  },

  _installLinkGrabber: function () {
    if (typeof gBrowser === "undefined") return;
    // Inject into already open tabs.
    for (let i = 0; i < gBrowser.browsers.length; i++) {
      try {
        ABDMPort.injectIntoBrowser(gBrowser.getBrowserAtIndex(i));
      } catch (e) {
        /* ignore per-tab errors */
      }
    }
    // Inject on future loads (including subframes).
    gBrowser.addEventListener(
      "DOMContentLoaded",
      function (event) {
        try {
          const doc = event.originalTarget;
          if (doc && doc.defaultView) {
            ABDMPort.injectIntoBrowser(doc.defaultView);
          }
        } catch (e) {}
      },
      true,
    );
  },

  injectIntoBrowser: function (browserWindow) {
    try {
      // browserWindow can be a <browser> element or a window; normalize
      let win = null;
      if (
        browserWindow &&
        browserWindow.document &&
        browserWindow.document.documentElement
      ) {
        win = browserWindow.contentWindow || browserWindow.content;
      } else if (browserWindow && browserWindow.location) {
        win = browserWindow;
      }
      if (!win) return;

      // Only inject into regular content pages. Skip internal browser pages.
      let href = "";
      try {
        href = (win.location && win.location.href) || "";
      } catch (e) {
        href = "";
      }
      if (!/^https?:|^file:/i.test(href)) return;

      // Avoid injecting multiple times.
      try {
        if (win.__abdmLinkGrabberLoaded) return;
        win.__abdmLinkGrabberLoaded = true;
      } catch (e) {
        return;
      }

      // Run the content script in a sandbox bound to the page window and
      // principal. Injecting <script src="chrome://..."> from web content does
      // not work, which is why the old implementation never ran.
      const sandbox = new Components.utils.Sandbox(win, {
        sandboxPrototype: win,
        wantXrays: false,
      });
      const loader = Components.classes[
        "@mozilla.org/moz/jssubscript-loader;1"
      ].getService(Components.interfaces.mozIJSSubScriptLoader);
      loader.loadSubScript(
        "chrome://abdm_legacy/content/linkgrabber-content.js",
        sandbox,
        "UTF-8",
      );

      ABDMPort._log(
        "info",
        "injected linkgrabber-content.js into " + (href || "(unknown)"),
      );
    } catch (e) {
      ABDMPort._log("warn", "injectIntoBrowser error: " + e);
    }
  },

  updateContextMenu: function (cm) {
    let node = document.popupNode;
    let menuItem = document.getElementById("abdm-send-link");
    if (!menuItem) return;

    // Decide si el nodo es un enlace o contiene un enlace
    let link = ABDMPort.findLinkFromNode(node);
    menuItem.hidden = !link;
    if (link) menuItem.setAttribute("data-abdm-link", link);
    else menuItem.removeAttribute("data-abdm-link");
  },

  _getPrefs: function () {
    try {
      return Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);
    } catch (e) {
      Components.utils.reportError("ABDMPort prefs error: " + e);
      return null;
    }
  },

  // Migrate old preferences from abdm_port.* to abdm_legacy.* on first run
  _migratePrefs: function () {
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return;
      const keys = [
        { name: "method", type: "char" },
        { name: "http_endpoint", type: "char" },
        { name: "process_path", type: "char" },
        { name: "process_args", type: "char" },
        { name: "autoCaptureLinks", type: "bool" },
        { name: "popupEnabled", type: "bool" },
        { name: "silentAddDownload", type: "bool" },
        { name: "registeredFileTypes", type: "char" },
        { name: "ignoredUrlPatterns", type: "char" },
      ];
      keys.forEach(function (k) {
        try {
          const oldKey = "abdm_port." + k.name;
          const newKey = "abdm_legacy." + k.name;
          // read old value
          let val;
          if (k.type === "bool") val = prefs.getBoolPref(oldKey);
          else val = prefs.getCharPref(oldKey);
          // if read succeeded, check if newKey exists; if not, set it
          try {
            if (k.type === "bool") prefs.getBoolPref(newKey);
            else prefs.getCharPref(newKey);
            // new exists, skip
          } catch (e) {
            // new does not exist, set it from old
            try {
              if (k.type === "bool") prefs.setBoolPref(newKey, !!val);
              else prefs.setCharPref(newKey, val);
            } catch (ee) {}
          }
        } catch (e) {
          /* old pref not present */
        }
      });
    } catch (e) {
      Components.utils.reportError("ABDMPort migrate prefs error: " + e);
    }
  },

  togglePrefBool: function (key, value) {
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return;
      const prefName = "abdm_legacy." + key;
      try {
        prefs.setBoolPref(prefName, !!value);
      } catch (e) {
        /* ignore */
      }
      // reflect change in UI
      ABDMPort.syncMenuState();
      // Re-evaluate observer when autoCapture toggled
      if (key === "autoCaptureLinks") {
        try {
          ABDMPort._maybeRegisterNetObserver();
        } catch (e) {}
      }
    } catch (e) {
      Components.utils.reportError("ABDMPort togglePrefBool error: " + e);
    }
  },

  syncMenuState: function () {
    try {
      const prefs = ABDMPort._getPrefs();
      if (!prefs) return;
      try {
        const vAuto = prefs.getBoolPref("abdm_legacy.autoCaptureLinks");
        const elAuto = document.getElementById("abdm-autocapture");
        if (elAuto) {
          if (vAuto) elAuto.setAttribute("checked", "true");
          else elAuto.removeAttribute("checked");
        }
      } catch (e) {}
      try {
        const vPop = prefs.getBoolPref("abdm_legacy.popupEnabled");
        const elPop = document.getElementById("abdm-showpopups");
        if (elPop) {
          if (vPop) elPop.setAttribute("checked", "true");
          else elPop.removeAttribute("checked");
        }
      } catch (e) {}
      try {
        const vSilent = prefs.getBoolPref("abdm_legacy.silentAddDownload");
        const elSilent = document.getElementById("abdm-silentadd");
        if (elSilent) {
          if (vSilent) elSilent.setAttribute("checked", "true");
          else elSilent.removeAttribute("checked");
        }
      } catch (e) {}
    } catch (e) {
      Components.utils.reportError("ABDMPort syncMenuState error: " + e);
    }
  },

  _placeToolbarButtonIfMissing: function () {
    try {
      const btn = document.getElementById("abdm-toolbar-button");
      if (!btn) return;
      // if already placed in a toolbar, nothing to do
      if (btn.parentNode && btn.parentNode.id !== "BrowserToolbarPalette")
        return;
      // Try common toolbar ids; if not found, append to the first toolbar element
      const toolbarIds = ["nav-bar", "toolbar-menubar", "navigator-toolbox"];
      let placed = false;
      for (const id of toolbarIds) {
        try {
          const t = document.getElementById(id);
          if (t) {
            t.appendChild(btn);
            placed = true;
            break;
          }
        } catch (e) {
          /* ignore per-target errors */
        }
      }
      if (!placed) {
        try {
          const toolbars = document.getElementsByTagName("toolbar");
          if (toolbars && toolbars.length > 0) {
            toolbars[0].appendChild(btn);
            placed = true;
          }
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      Components.utils.reportError("ABDMPort placeToolbar error: " + e);
    }
  },

  // Busca la URL asociada a un nodo (ancla, area con href, etc.)
  findLinkFromNode: function (node) {
    if (!node) return null;
    // Nodo directo <a>
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName.toLowerCase() === "a" && node.href) return node.href;
      // Elementos anidados: buscar ancestro con href
      let el = node;
      while (el && el.nodeType === Node.ELEMENT_NODE) {
        if (el.tagName.toLowerCase() === "a" && el.href) return el.href;
        el = el.parentNode;
      }
    }
    // Si es un texto u otro, no hay URL directa
    return null;
  },

  onSendLinkCommand: function () {
    let menuItem = document.getElementById("abdm-send-link");
    if (!menuItem) return;
    let url = menuItem.getAttribute("data-abdm-link");
    if (!url) return;
    ABDMPort.sendToAB(url);
  },

  // Open the options window using nsIWindowWatcher to ensure a proper chrome window
  openOptions: function () {
    try {
      const ww = Components.classes[
        "@mozilla.org/embedcomp/window-watcher;1"
      ].getService(Components.interfaces.nsIWindowWatcher);
      // specify explicit width/height to ensure window opens at a usable size
      ww.openWindow(
        null,
        "chrome://abdm_legacy/content/options.xul",
        "abdm-options",
        "chrome,centerscreen,resizable,width=520,height=420",
        null,
      );
    } catch (e) {
      Components.utils.reportError("ABDMPort openOptions error: " + e);
      try {
        // fallback to window.openDialog
        // include width/height in fallback as well
        window.openDialog(
          "chrome://abdm_legacy/content/options.xul",
          "abdm-options",
          "chrome,centerscreen,resizable,width=520,height=420",
        );
      } catch (e2) {
        Components.utils.reportError(
          "ABDMPort openOptions fallback error: " + e2,
        );
      }
    }
  },

  // sendToAB soporta varios métodos configurables mediante prefs:
  // - 'protocol' : abrir abdm://add?url=...
  // - 'http'     : POST a pref 'abdm_legacy.http_endpoint'
  // - 'process'  : ejecutar un binario local (pref 'abdm_legacy.process_path')
  // - 'auto'     : intentar HTTP y si falla usar protocolo
  sendToAB: function (url, pageUrl, suggestedName, providedHeaders) {
    return new Promise(function (resolve) {
      ABDMPort._log(
        "info",
        "sendToAB called for " +
          url +
          (pageUrl ? " (page: " + pageUrl + ")" : ""),
      );

      // Dedupe recent sends to avoid flooding protocol handlers or loops
      const NOW = Date.now();
      const DEDUPE_MS = 3000;

      for (let i = 0; i < ABDMPort._recent.length; i++) {
        const it = ABDMPort._recent[i];
        if (it && it.url === url && NOW - it.when < DEDUPE_MS) {
          ABDMPort._log("info", "skipping duplicate sendToAB for " + url);
          // Already handled recently: report success so callers do not fall back.
          return resolve(true);
        }
      }

      ABDMPort._inflight = ABDMPort._inflight || {};
      if (ABDMPort._inflight[url]) {
        ABDMPort._log("info", "sendToAB already in-flight for " + url);
        return resolve(true);
      }

      ABDMPort._inflight[url] = true;
      setTimeout(function () {
        if (ABDMPort._inflight) delete ABDMPort._inflight[url];
      }, 5000);

      ABDMPort._recent.unshift({ url: url, when: NOW });
      if (ABDMPort._recent.length > 200) ABDMPort._recent.length = 200;

      const prefs = ABDMPort._getPrefs();
      let method = "auto";
      if (prefs) {
        try {
          method = prefs.getCharPref("abdm_legacy.method");
        } catch (e) {}
      }

      // Usar cabeceras exactas si se pasaron, de lo contrario usar el fallback nativo
      const headers =
        providedHeaders && Object.keys(providedHeaders).length > 0
          ? providedHeaders
          : ABDMPort._getHeadersForUrl(url, pageUrl);

      // Handle local process execution directly in the overlay
      if (method === "process") {
        try {
          const path = prefs ? prefs.getCharPref("abdm_legacy.process_path") : "";
          if (!path) {
            ABDMPort._log(
              "warn",
              "process: abdm_legacy.process_path is not configured",
            );
            return resolve(false);
          }

          const file = Components.classes[
            "@mozilla.org/file/local;1"
          ].createInstance(Components.interfaces.nsIFile);
          file.initWithPath(path);

          let args = [];
          const argstr = prefs.getCharPref("abdm_legacy.process_args");
          if (argstr) args = argstr.split(" ");

          const urlIndex = args.indexOf("%URL%");
          if (urlIndex !== -1) {
            args[urlIndex] = url;
          } else {
            args.push(url);
          }

          const process = Components.classes[
            "@mozilla.org/process/util;1"
          ].createInstance(Components.interfaces.nsIProcess);
          process.init(file);
          process.run(false, args, args.length);
          ABDMPort._log(
            "info",
            "process started " + path + " args=" + args.join(" "),
          );
          return resolve(true);
        } catch (e) {
          ABDMPort._log("error", "process error: " + e);
          return resolve(false);
        }
      }

      // Pasamos los headers hacia el Backend unificado
      if (typeof ABDMBackend !== "undefined" && ABDMBackend.send) {
        ABDMBackend.send(url, pageUrl, suggestedName, headers).then(
          function (success) {
            if (!success)
              ABDMPort._log("warn", "ABDMBackend failed to deliver payload");
            resolve(!!success);
          },
          function (err) {
            ABDMPort._log("error", "ABDMBackend send rejected: " + err);
            resolve(false);
          },
        );
      } else {
        ABDMPort._log("error", "ABDMBackend module not found!");
        resolve(false);
      }
    });
  },
};

// Share the capture dedupe state across all browser windows. Without this,
// every open window registers its own network observer and the same download
// could be delivered to the app once per window. The module is a per-app
// singleton, so all windows read and mutate the same arrays.
(function () {
  try {
    const holder = {};
    Components.utils.import("resource://abdm_legacy/shared.jsm", holder);
    const shared = holder.ABDMSharedState;
    if (shared) {
      ABDMPort._recent = shared.recent;
      ABDMPort._inflight = shared.inflight;
    }
  } catch (e) {
    // Keep the per-window defaults defined in the object literal.
  }
})();

// Inicializar cuando la ventana principal esté lista
window.addEventListener(
  "load",
  function onLoad() {
    window.removeEventListener("load", onLoad, false);
    try {
      ABDMPort.init();
    } catch (e) {
      Components.utils.reportError("ABDMPort load error: " + e);
    }
  },
  false,
);

// Ensure we cleanup observers on window unload
window.addEventListener(
  "unload",
  function onUnload() {
    try {
      ABDMPort._maybeUnregisterNetObserver();
    } catch (e) {}
    try {
      ABDMPort._unregisterPrefsObserver();
    } catch (e) {}
  },
  false,
);
