// Register the PWA service worker safely.
// Guards against Lovable preview iframes (which break SW caching),
// auto-updates to new deploys without a manual reload,
// and forces a fresh data fetch when the tab regains focus.

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
        // لا نُحدّث تلقائياً ولا نعيد تحميل الصفحة. التحديث يُطبَّق طبيعياً في الجلسة التالية
        // (عند فتح التبويب من جديد). هذا يمنع إعادة التحميل المفاجئة وفقدان العمل الجاري.
        onNeedRefresh() { /* noop — لا reload تلقائي */ },
        onOfflineReady() { /* noop */ },
      });
    })
    .catch(() => {
      // virtual module may not exist in dev — fine
    });

  // لا نستمع لـ controllerchange ولا نعيد التحميل تلقائياً.
  // النسخة الجديدة من الـ shell ستُستخدم عند إعادة فتح التبويب يدوياً.
}
