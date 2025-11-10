(function () {
  // This script runs in page context. It detects clicks on links, media tags and XHR/fetch responses
  // and posts a message to the page window for the chrome overlay to pick up.

  const REGISTERED_FILE_TYPES = new Set([
    "zip",
    "rar",
    "7z",
    "iso",
    "tar",
    "gz",
    "exe",
    "msi",
    "deb",
    "jar",
    "apk",
    "bin",
    "mp3",
    "aac",
    "pdf",
    "mp4",
    "3gp",
    "avi",
    "mkv",
    "wav",
    "mpeg",
    "srt",
  ]);

  function getExtensionFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const pathname = u.pathname || "";
      const i = pathname.lastIndexOf(".");
      if (i === -1) return null;
      return pathname.substring(i + 1).toLowerCase();
    } catch (e) {
      return null;
    }
  }

  function isRegistered(url) {
    const ext = getExtensionFromUrl(url);
    return ext && REGISTERED_FILE_TYPES.has(ext);
  }

  function postDetected(url) {
    try {
      try {
        // page-context log for debugging
        if (window.console && window.console.log)
          window.console.log("ABDM linkgrabber: detected " + url);
      } catch (e) {}
      // include the page URL and a suggestedName when available
      let suggested = null;
      try {
        // if the element had a download attribute, prefer it as suggested name
        if (document.activeElement && document.activeElement.tagName === "A") {
          try {
            suggested = document.activeElement.getAttribute("download") || null;
          } catch (e) {}
        }
      } catch (e) {}
      window.postMessage(
        {
          type: "abdm-detected",
          url: url,
          pageUrl: location.href || null,
          suggestedName: suggested,
        },
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  // Click capture on links
  document.addEventListener(
    "click",
    function (ev) {
      try {
        let el = ev.target;
        while (el && el.nodeType === 1) {
          if (el.tagName.toLowerCase() === "a" && el.href) {
            const url = el.href;
            if (isRegistered(url) || url.includes(".m3u8")) {
              // prevent the browser from performing the default navigation/download
              try {
                if (ev && typeof ev.preventDefault === "function")
                  ev.preventDefault();
                if (ev && typeof ev.stopImmediatePropagation === "function")
                  ev.stopImmediatePropagation();
                if (ev && typeof ev.stopPropagation === "function")
                  ev.stopPropagation();
                try {
                  if (window.console && window.console.log)
                    window.console.log(
                      "ABDM linkgrabber: prevented default click for " + url
                    );
                } catch (e) {}
              } catch (e) {}
              postDetected(url);
              // small timeout to stop any navigation that other handlers may have started
              try {
                setTimeout(function () {
                  try {
                    if (typeof window.stop === "function") {
                      window.stop();
                      try {
                        if (window.console && window.console.log)
                          window.console.log(
                            "ABDM linkgrabber: called window.stop() to halt navigation for " +
                              url
                          );
                      } catch (e) {}
                    }
                  } catch (e) {}
                }, 20);
              } catch (e) {}
            }
            break;
          }
          el = el.parentNode;
        }
      } catch (e) {}
    },
    true
  );

  // Also listen to mousedown to catch links that start download on press
  document.addEventListener(
    "mousedown",
    function (ev) {
      try {
        let el = ev.target;
        while (el && el.nodeType === 1) {
          if (el.tagName.toLowerCase() === "a" && el.href) {
            const url = el.href;
            if (isRegistered(url) || url.includes(".m3u8")) {
              // some sites begin downloads on mousedown; prevent default to stop
              // the browser download and let the native app handle it
              try {
                if (ev && typeof ev.preventDefault === "function")
                  ev.preventDefault();
                if (ev && typeof ev.stopImmediatePropagation === "function")
                  ev.stopImmediatePropagation();
                if (ev && typeof ev.stopPropagation === "function")
                  ev.stopPropagation();
                try {
                  if (window.console && window.console.log)
                    window.console.log(
                      "ABDM linkgrabber: prevented default mousedown for " + url
                    );
                } catch (e) {}
              } catch (e) {}
              postDetected(url);
              try {
                setTimeout(function () {
                  try {
                    if (typeof window.stop === "function") {
                      window.stop();
                      try {
                        if (window.console && window.console.log)
                          window.console.log(
                            "ABDM linkgrabber: called window.stop() to halt navigation for " +
                              url
                          );
                      } catch (e) {}
                    }
                  } catch (e) {}
                }, 20);
              } catch (e) {}
            }
            break;
          }
          el = el.parentNode;
        }
      } catch (e) {}
    },
    true
  );

  // Scan existing anchors on load
  function scanAnchors() {
    try {
      const anchors = document.querySelectorAll("a[href]");
      for (const a of anchors) {
        const url = a.href;
        if (isRegistered(url)) {
          // we don't auto-send to avoid surprising user; just annotate dataset so overlay menu can find
          a.dataset.abdmCandidate = "1";
        }
      }
    } catch (e) {}
  }
  try {
    scanAnchors();
  } catch (e) {}

  // Media tags detection
  function scanMediaTags() {
    try {
      const medias = document.querySelectorAll("video, audio, source");
      medias.forEach((m) => {
        const src =
          m.src ||
          m.getAttribute("src") ||
          (m.tagName.toLowerCase() === "source" && m.parentElement
            ? m.parentElement.src
            : null);
        if (src) {
          if (isRegistered(src) || src.includes(".m3u8")) postDetected(src);
        }
      });
    } catch (e) {}
  }
  try {
    scanMediaTags();
  } catch (e) {}

  // announce readiness to the chrome overlay so it can confirm injection
  try {
    window.postMessage({ type: "abdm-ready" }, "*");
  } catch (e) {}

  // Monkey-patch XHR to detect responses containing m3u8 or manifest JSON
  (function () {
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._abdm_url = url;
      return _open.apply(this, arguments);
    };
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        this.addEventListener("load", function () {
          try {
            const url = this.responseURL || this._abdm_url;
            if (!url) return;
            if (url.includes(".m3u8")) {
              postDetected(url);
              return;
            }
            const contentType = this.getResponseHeader
              ? this.getResponseHeader("content-type")
              : null;
            if (
              contentType &&
              contentType.indexOf("application/vnd.apple.mpegurl") !== -1
            ) {
              postDetected(url);
              return;
            }
            // small heuristic: if responseText contains EXTM3U (m3u8) or looks like a manifest with media links
            if (
              this.responseText &&
              this.responseText.indexOf("EXTM3U") !== -1
            ) {
              postDetected(url);
              return;
            }
            // JSON manifests: try parse and search for 'url' fields
            if (
              contentType &&
              contentType.indexOf("application/json") !== -1 &&
              this.responseText
            ) {
              try {
                const json = JSON.parse(this.responseText);
                const found = findUrlsInObject(json);
                if (found) postDetected(found);
              } catch (e) {}
            }
          } catch (e) {}
        });
      } catch (e) {}
      return _send.apply(this, arguments);
    };

    // patch fetch as well
    if (window.fetch) {
      const _fetch = window.fetch;
      window.fetch = function () {
        return _fetch.apply(this, arguments).then(async function (resp) {
          try {
            const url = resp.url;
            const ct = resp.headers ? resp.headers.get("content-type") : null;
            if (url && url.indexOf(".m3u8") !== -1) {
              postDetected(url);
              return resp;
            }
            if (ct && ct.indexOf("application/vnd.apple.mpegurl") !== -1) {
              postDetected(url);
              return resp;
            }
            // try clone and peek
            try {
              const clone = resp.clone();
              const text = await clone.text();
              if (text && text.indexOf("EXTM3U") !== -1) {
                postDetected(url);
                return resp;
              }
              if (ct && ct.indexOf("application/json") !== -1) {
                try {
                  const json = JSON.parse(text);
                  const found = findUrlsInObject(json);
                  if (found) postDetected(found);
                } catch (e) {}
              }
            } catch (e) {}
          } catch (e) {}
          return resp;
        });
      };
    }
  })();

  function findUrlsInObject(obj) {
    if (!obj) return null;
    if (typeof obj === "string") {
      if (
        obj.indexOf("http") === 0 &&
        (isRegistered(obj) || obj.indexOf(".m3u8") !== -1)
      )
        return obj;
      return null;
    }
    if (Array.isArray(obj)) {
      for (const it of obj) {
        const f = findUrlsInObject(it);
        if (f) return f;
      }
    } else if (typeof obj === "object") {
      for (const k in obj) {
        try {
          const val = obj[k];
          const f = findUrlsInObject(val);
          if (f) return f;
        } catch (e) {}
      }
    }
    return null;
  }
})();
