// Preferencias por defecto para AB Download Manager - Legacy XUL
pref("abdm_legacy.method", "auto");
pref("abdm_legacy.http_endpoint", "http://127.0.0.1:15151/add");
pref("abdm_legacy.process_path", "");
pref("abdm_legacy.process_args", "");
pref("abdm_legacy.autoCaptureLinks", true);
pref("abdm_legacy.silentAddDownload", false);
pref("abdm_legacy.silentStartDownload", false);
pref("abdm_legacy.api_key", "");
// If the app does not respond, let the browser download the file instead of
// cancelling it and losing it.
pref("abdm_legacy.allowPassDownloadIfAppNotRespond", true);
pref(
  "abdm_legacy.registeredFileTypes",
  "zip rar 7z iso tar gz exe msi deb jar apk bin mp3 aac pdf mp4 3gp avi mkv wav mpeg srt"
);
pref("abdm_legacy.ignoredUrlPatterns", "");
// Minimum file size (in KB) to auto-capture. 0 = capture any size.
pref("abdm_legacy.captureFileSizeMinimumKb", 0);
// Passive link grabber for the future batch-download feature (disabled by
// default: it adds overhead and is not used yet).
pref("abdm_legacy.enableLinkGrabber", false);
