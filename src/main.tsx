import { createRoot } from "react-dom/client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { registerTechPwa } from "./lib/registerPwa";
import { ensureCacheVersion } from "./lib/cacheVersion";
import { installEnglishDigitGuards } from "./lib/formatters/englishDigitsRuntime";
import { installChunkLoadErrorRecovery, isChunkLoadError, recoverFromChunkLoadError } from "./lib/chunkRecovery";
import { CURRENT_APP_VERSION } from "./lib/appVersion";

ensureCacheVersion();
installEnglishDigitGuards();
registerTechPwa();
installChunkLoadErrorRecovery();

const categorizeError = (error: Error) => {
  const msg = error.message || "";
  if (isChunkLoadError(msg)) return "ChunkLoadError";
  if (/supabase|postgrest|row-level security|schema cache|column .* does not exist/i.test(msg)) return "SupabaseError";
  if (/network|failed to fetch|timeout|abort/i.test(msg)) return "NetworkError";
  if (/permission|not authorized|unauthorized|forbidden/i.test(msg)) return "PermissionError";
  if (/mutationobserver|dom/i.test(msg)) return "DOMMutationError";
  return "RuntimeError";
};

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; errorId: string | null; category: string | null }> {
  state = { error: null as Error | null, errorId: null as string | null, category: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return {
      error,
      errorId: `ERR-${Date.now().toString(36).toUpperCase()}`,
      category: categorizeError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Application render error", {
      errorId: this.state.errorId,
      category: categorizeError(error),
      route: window.location.pathname,
      message: error.message,
      componentStack: errorInfo.componentStack,
    });
    if (isChunkLoadError(error.message || "")) {
      void recoverFromChunkLoadError(error);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background p-6 text-foreground" translate="no">
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-5 shadow">
            <h1 className="mb-2 text-lg font-bold">حدث خطأ غير متوقع</h1>
            <p className="text-sm text-muted-foreground">
              لم يتم حذف بياناتك المحفوظة. حاول إعادة المحاولة أو الرجوع للوحة التحكم.
            </p>
            <dl className="mt-4 grid grid-cols-[120px_1fr] gap-2 rounded bg-muted p-3 text-xs" dir="ltr">
              <dt>Error ID</dt>
              <dd>{this.state.errorId}</dd>
              <dt>Route</dt>
              <dd>{window.location.pathname}</dd>
              <dt>Category</dt>
              <dd>{this.state.category}</dd>
              <dt>Build</dt>
              <dd>{CURRENT_APP_VERSION}</dd>
              <dt>Time</dt>
              <dd>{new Date().toISOString()}</dd>
            </dl>
            <pre className="mt-4 max-h-40 overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
              {this.state.error.message}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>
                إعادة المحاولة
              </button>
              <button
                className="rounded border border-border px-4 py-2 text-sm"
                onClick={() => { void recoverFromChunkLoadError(this.state.error, { force: true }); }}
              >
                تنظيف Cache وإعادة التحميل
              </button>
              <button className="rounded border border-border px-4 py-2 text-sm" onClick={() => { window.location.href = "/dashboard"; }}>
                العودة للوحة التحكم
              </button>
              <button
                className="rounded border border-border px-4 py-2 text-sm"
                onClick={() => navigator.clipboard?.writeText(JSON.stringify({
                  errorId: this.state.errorId,
                  route: window.location.pathname,
                  category: this.state.category,
                  build: CURRENT_APP_VERSION,
                  message: this.state.error?.message,
                }, null, 2))}
              >
                نسخ معلومات الخطأ
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
