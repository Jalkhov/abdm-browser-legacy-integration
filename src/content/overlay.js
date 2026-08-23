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
      cm.addEventListener(
        "popupshowing",
        function () {
          ABDMPort.updateContextMenu(cm);
        },
        false,
      );

      // Inject content listener into pages to detect media/links from the page context
      try {
        // Listen to page loads and inject a small content script into each document
        if (typeof gBrowser !== "undefined") {
          // Inject into already open tabs
          for (let i = 0; i < gBrowser.browsers.length; i++) {
            const browser = gBrowser.getBrowserAtIndex(i);
            try {
              ABDMPort.injectIntoBrowser(browser);
            } catch (e) {
              /* ignore per-tab errors */
            }
          }

          // Inject on future loads
          gBrowser.addEventListener(
            "DOMContentLoaded",
            function (event) {
              try {
                const doc = event.originalTarget;
                if (doc && doc.defaultView) {
                  ABDMPort.injectIntoBrowser(doc.defaultView);
                }
              } catch (e) {
                Components.utils.reportError(
                  "ABDMPort inject load error: " + e,
                );
              }
            },
            true,
          );
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
    } catch (e) {
      Components.utils.reportError("ABDMPort init error: " + e);
    }
  },

  _netObserverRegistered: false,
  _netObserver: null,
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
    const registeredExts = ABDMPort._getRegisteredExtensions();
    const ignorePatterns = ABDMPort._getIgnoredPatterns();

    ABDMPort._netObserver = {
      observe: function (subject, topic, data) {
        if (topic !== "http-on-examine-response") return;

        const channel = subject.QueryInterface(Ci.nsIHttpChannel);
        const url = channel.URI ? channel.URI.spec : null;
        if (!url) return;

        // Skip already processed via click (recent dedupe)
        for (let i = 0; i < ABDMPort._recent.length; i++) {
          const it = ABDMPort._recent[i];
          if (it && it.url === url && Date.now() - it.when < 5000) return;
        }

        // Filter ignored patterns
        if (ignorePatterns.some((pattern) => url.includes(pattern))) return;

        // Examine content-disposition / type / extension
        const disposition =
          channel.getResponseHeader("Content-Disposition") || "";
        const contentType = channel.contentType || "";
        const filename =
          ABDMPort._filenameFromDisposition(disposition) ||
          ABDMPort._filenameFromUrl(url) ||
          "";
        const lowerFilename = filename.toLowerCase();

        // Determine if this is a top-level document load
        let isTopLevel = false;
        if (
          channel.loadInfo &&
          typeof channel.loadInfo.contentPolicyType !== "undefined"
        ) {
          const TYPE_DOCUMENT = Ci.nsIContentPolicy
            ? Ci.nsIContentPolicy.TYPE_DOCUMENT
            : 6;
          isTopLevel = channel.loadInfo.contentPolicyType === TYPE_DOCUMENT;
        } else if (channel.loadFlags) {
          const LOAD_DOCUMENT_URI = Ci.nsIChannel.LOAD_DOCUMENT_URI;
          isTopLevel =
            (channel.loadFlags & LOAD_DOCUMENT_URI) === LOAD_DOCUMENT_URI;
        }

        let matched = false;
        const isAttachment = /attachment/i.test(disposition);

        // We only cancel when it's an attachment anywhere, or a top-level navigation to a registered extension
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

        // schedule async to avoid interfering with observers chain
        setTimeout(function () {
          ABDMPort.sendToAB(url, pageUrl, filename);
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

  injectIntoBrowser: function (browserWindow) {
    try {
      // browserWindow can be a <browser> element or a window; normalize
      let win = null;
      if (
        browserWindow &&
        browserWindow.document &&
        browserWindow.document.documentElement
      ) {
        // it's a browser element (XUL)
        win = browserWindow.contentWindow || browserWindow.content;
      } else if (browserWindow && browserWindow.location) {
        // it's a DOMWindow
        win = browserWindow;
      }
      if (!win) return;

      const doc = win.document;
      if (!doc) return;

      // Only inject into regular content pages. Skip internal browser pages
      // (about:, chrome:, resource:, moz-extension:, view-source:, data:, etc.).
      let href = "";
      try {
        href = (win.location && win.location.href) || "";
      } catch (e) {
        href = "";
      }
      // allow only http(s) and file URLs for injection
      if (!/^https?:|^file:/i.test(href)) {
        try {
          ABDMPort._log(
            "info",
            "skipping injection for non-content page: " + (href || "(unknown)"),
          );
        } catch (e) {}
        return;
      }

      // Avoid injecting multiple times
      if (doc.getElementById("abdm-linkgrabber-injected")) return;

      const script = doc.createElement("script");
      script.setAttribute("id", "abdm-linkgrabber-injected");
      script.setAttribute("type", "text/javascript");
      script.setAttribute(
        "src",
        "chrome://abdm_legacy/content/linkgrabber-content.js",
      );
      // append to document to execute in page context
      (doc.documentElement || doc.body || doc).appendChild(script);
      try {
        ABDMPort._log(
          "info",
          "injected linkgrabber-content.js into " + (href || "(unknown)"),
        );
      } catch (e) {}

      // listen to messages coming from the page
      win.addEventListener(
        "message",
        function (ev) {
          try {
            const data = ev.data;
            if (!data) return;
            if (data.type === "abdm-detected" && data.url) {
              try {
                ABDMPort._log(
                  "info",
                  "message received abdm-detected -> " +
                    data.url +
                    (data.pageUrl ? " (page: " + data.pageUrl + ")" : ""),
                );
              } catch (e) {}
              ABDMPort.sendToAB(
                data.url,
                data.pageUrl || null,
                data.suggestedName || null,
              );
            }
            if (data.type === "abdm-ready") {
              // content script confirmed injection
              ABDMPort._log(
                "info",
                "linkgrabber script ready in tab " +
                  (win.location.href || "(unknown)"),
              );
            }
          } catch (e) {
            Components.utils.reportError(
              "ABDMPort message handler error: " + e,
            );
          }
        },
        false,
      );

      // After appending the script, set a short timeout to detect injection failure
      try {
        let ready = false;
        const onReady = function (ev) {
          try {
            if (ev && ev.data && ev.data.type === "abdm-ready") {
              ready = true;
              win.removeEventListener("message", onReady, false);
            }
          } catch (e) {}
        };
        win.addEventListener("message", onReady, false);
        setTimeout(function () {
          try {
            if (!ready) {
              ABDMPort._log(
                "warn",
                "linkgrabber script did not signal ready in " +
                  (win.location.href || "(unknown)"),
              );
            }
            try {
              win.removeEventListener("message", onReady, false);
            } catch (e) {}
          } catch (e) {}
        }, 2500);
      } catch (e) {}
    } catch (e) {
      Components.utils.reportError("ABDMPort injectIntoBrowser error: " + e);
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
  sendToAB: function (url, pageUrl, suggestedName) {
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
        return;
      }
    }

    ABDMPort._inflight = ABDMPort._inflight || {};
    if (ABDMPort._inflight[url]) {
      ABDMPort._log("info", "sendToAB already in-flight for " + url);
      return;
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

    // Extraemos las credenciales del navegador para enviarlas al gestor
    const headers = ABDMPort._getHeadersForUrl(url, pageUrl);

    // Handle local process execution directly in the overlay
    if (method === "process") {
      try {
        const path = prefs ? prefs.getCharPref("abdm_legacy.process_path") : "";
        if (!path) {
          ABDMPort._log(
            "warn",
            "process: abdm_legacy.process_path is not configured",
          );
          return;
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
      } catch (e) {
        ABDMPort._log("error", "process error: " + e);
      }
      return;
    }

    // Pasamos los headers hacia el Backend unificado
    if (typeof ABDMBackend !== "undefined" && ABDMBackend.send) {
      ABDMBackend.send(url, pageUrl, suggestedName, headers).then((success) => {
        if (!success)
          ABDMPort._log("warn", "ABDMBackend failed to deliver payload");
      });
    } else {
      ABDMPort._log("error", "ABDMBackend module not found!");
    }
  },
};

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
  },
  false,
);
