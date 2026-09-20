(function () {
  // Passive helper used only by the (not yet implemented) "Download Selected"
  // batch feature. It annotates links and media candidates on the page and
  // NEVER triggers downloads on its own.
  //
  // It intentionally does not patch XMLHttpRequest/fetch: intercepting every
  // response was expensive, could break streaming and could capture sensitive
  // data.

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
    return !!ext && REGISTERED_FILE_TYPES.has(ext);
  }

  function scanAnchors() {
    try {
      const anchors = document.querySelectorAll("a[href]");
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (isRegistered(a.href)) a.dataset.abdmCandidate = "1";
      }
    } catch (e) {}
  }

  function scanMediaTags() {
    try {
      const medias = document.querySelectorAll("video, audio, source");
      for (let i = 0; i < medias.length; i++) {
        const m = medias[i];
        const src =
          m.src ||
          m.getAttribute("src") ||
          (m.tagName.toLowerCase() === "source" && m.parentElement
            ? m.parentElement.src
            : null);
        if (src && (isRegistered(src) || src.indexOf(".m3u8") !== -1)) {
          m.dataset.abdmCandidate = "1";
        }
      }
    } catch (e) {}
  }

  try {
    scanAnchors();
  } catch (e) {}
  try {
    scanMediaTags();
  } catch (e) {}

  // Let the chrome overlay know the script is running (debug only).
  try {
    window.postMessage({ type: "abdm-ready" }, "*");
  } catch (e) {}
})();
