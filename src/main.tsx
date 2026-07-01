import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { registerTechPwa } from "./lib/registerPwa";
import { ensureCacheVersion } from "./lib/cacheVersion";
import { installEnglishDigitGuards } from "./lib/formatters/englishDigitsRuntime";

ensureCacheVersion();
installEnglishDigitGuards();
registerTechPwa();

// Recovery for stale PWA chunks after a new deploy.
// When a dynamic import fails ("Importing a module script failed" /
// "Failed to fetch dynamically imported module"), clear caches + SW and reload once.
(function installChunkErrorRecovery() {
  const KEY = "__chunk_reload_at";
  const isChunkError = (msg: string) =>
    /Importing a module script failed|Failed to fetch dynamically imported module|Loading chunk \d+ failed|ChunkLoadError/i.test(msg);

  async function recover() {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10_000) return; // avoid reload loops
    sessionStorage.setItem(KEY, String(Date.now()));
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* noop */ }
    window.location.reload();
  }

  window.addEventListener("error", (e) => {
    if (e?.message && isChunkError(e.message)) recover();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e as PromiseRejectionEvent).reason?.message || (e as PromiseRejectionEvent).reason || "");
    if (isChunkError(msg)) recover();
  });
})();

createRoot(document.getElementById("root")!).render(<App />);
