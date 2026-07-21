// Register the PWA service worker safely.
// Guards against Lovable preview iframes (which break SW caching),
// keeps deploy updates safe: the service worker may detect a new shell while
// the user is editing, so never auto-reload from this low-level hook.

export function registerTechPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    (host.includes("lovable.app") && host.includes("id-preview"));

  if (isInIframe || isPreviewHost) {
    // Clean any leftover SW + caches so preview isn't stuck on stale shell
    navigator.serviceWorker.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => (typeof caches !== "undefined" ? caches.keys() : Promise.resolve([])))
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
    return;
  }

  // Only register in production
  if (import.meta.env.DEV) return;

  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        // Do not call updateSW(true) here. On Chromium, SW update checks can
        // happen when returning to a browser tab; forcing skipWaiting reloads
        // the app and drops unsaved form data. The explicit update notice flow
        // is the only place allowed to reload the app shell.
        onNeedRefresh() {
          // Intentionally no-op.
        },
        onOfflineReady() { /* noop */ },
      });
    })
    .catch(() => {
      // virtual module may not exist in dev — fine
    });

  // The generated SW uses skipWaiting + clientsClaim; this keeps the app from
  // staying pinned to an old shell after a successful Vercel deployment.
}
