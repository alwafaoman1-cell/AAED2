import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { registerTechPwa } from "./lib/registerPwa";
import { ensureCacheVersion } from "./lib/cacheVersion";
import { installEnglishDigitGuards } from "./lib/formatters/englishDigitsRuntime";

ensureCacheVersion();
installEnglishDigitGuards();
registerTechPwa();

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Application render error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background p-6 text-foreground" translate="no">
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-5 shadow">
            <h1 className="mb-2 text-lg font-bold">Application error</h1>
            <p className="text-sm text-muted-foreground">
              Please use the built-in language switcher instead of browser translation, then refresh the page.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
              {this.state.error.message}
            </pre>
            <button className="mt-4 rounded bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
