(function () {
  // This script runs in page context. It passively detects media tags, anchors, and XHR/fetch responses
  // to populate a list for the future "Download Selected" batch download feature.

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

  // Scan existing anchors on load
  function scanAnchors() {
    try {
      const anchors = document.querySelectorAll("a[href]");
      for (const a of anchors) {
        const url = a.href;
        if (isRegistered(url)) {
          // just annotate dataset so overlay menu can find it for batch download later
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
          if (isRegistered(src) || src.includes(".m3u8")) {
            m.dataset.abdmCandidate = "1";
          }
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

  // Monkey-patch XHR/Fetch to silently store URLs for batch downloading
  (function () {
    window._abdm_captured_media = window._abdm_captured_media || new Set();

    function silentlyCapture(url) {
      if (url) window._abdm_captured_media.add(url);
    }

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
              silentlyCapture(url);
              return;
            }
            const contentType = this.getResponseHeader
              ? this.getResponseHeader("content-type")
              : null;
            if (
              contentType &&
              contentType.indexOf("application/vnd.apple.mpegurl") !== -1
            ) {
              silentlyCapture(url);
              return;
            }
            if (
              this.responseText &&
              this.responseText.indexOf("EXTM3U") !== -1
            ) {
              silentlyCapture(url);
              return;
            }
            if (
              contentType &&
              contentType.indexOf("application/json") !== -1 &&
              this.responseText
            ) {
              try {
                const json = JSON.parse(this.responseText);
                const found = findUrlsInObject(json);
                if (found) silentlyCapture(found);
              } catch (e) {}
            }
          } catch (e) {}
        });
      } catch (e) {}
      return _send.apply(this, arguments);
    };

    if (window.fetch) {
      const _fetch = window.fetch;
      window.fetch = function () {
        return _fetch.apply(this, arguments).then(async function (resp) {
          try {
            const url = resp.url;
            const ct = resp.headers ? resp.headers.get("content-type") : null;
            if (url && url.indexOf(".m3u8") !== -1) {
              silentlyCapture(url);
              return resp;
            }
            if (ct && ct.indexOf("application/vnd.apple.mpegurl") !== -1) {
              silentlyCapture(url);
              return resp;
            }
            try {
              const clone = resp.clone();
              const text = await clone.text();
              if (text && text.indexOf("EXTM3U") !== -1) {
                silentlyCapture(url);
                return resp;
              }
              if (ct && ct.indexOf("application/json") !== -1) {
                try {
                  const json = JSON.parse(text);
                  const found = findUrlsInObject(json);
                  if (found) silentlyCapture(found);
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
