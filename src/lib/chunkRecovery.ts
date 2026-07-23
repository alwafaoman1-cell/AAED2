import { CURRENT_APP_VERSION } from "@/lib/appVersion";
import { hasUnsavedWork } from "@/lib/unsavedWork";

const RECOVERY_KEY = "__aaed_chunk_recovery_v1";
const RECOVERY_COOLDOWN_MS = 30_000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|dynamically imported module|\/assets\/.*\.(js|css)/i;

export type ChunkRecoveryResult =
  | { status: "not_chunk_error" }
  | { status: "blocked_dirty_form" }
  | { status: "already_attempted" }
  | { status: "reloading" };

function readLastRecovery(): number {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { at?: number };
    return Number(parsed.at || 0);
  } catch {
    return 0;
  }
}

function markRecoveryAttempt(): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({
      at: Date.now(),
      route: window.location.pathname,
      build: CURRENT_APP_VERSION,
    }));
  } catch {
    // Session storage failure must not block manual recovery.
  }
}

export function isChunkLoadError(input: unknown): boolean {
  const message =
    typeof input === "string"
      ? input
      : String((input as { message?: unknown })?.message || input || "");
  return CHUNK_ERROR_RE.test(message);
}

export async function clearApplicationShellCaches(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((registration) => registration.unregister()));
  }

  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    const appCacheKeys = keys.filter((key) =>
      /workbox|vite|aaed|temo|html-shell|supabase-storage|precache|runtime/i.test(key),
    );
    await Promise.all(appCacheKeys.map((key) => caches.delete(key)));
  }
}

function reloadWithCacheBuster(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("__app_reload", String(Date.now()));
  window.location.replace(url.toString());
}

export async function recoverFromChunkLoadError(input: unknown, options?: { force?: boolean }): Promise<ChunkRecoveryResult> {
  if (!isChunkLoadError(input) && !options?.force) return { status: "not_chunk_error" };
  if (!options?.force && hasUnsavedWork()) return { status: "blocked_dirty_form" };

  const last = readLastRecovery();
  if (!options?.force && Date.now() - last < RECOVERY_COOLDOWN_MS) {
    return { status: "already_attempted" };
  }

  markRecoveryAttempt();
  try {
    await clearApplicationShellCaches();
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[chunk-recovery] cache cleanup failed", error);
  }
  reloadWithCacheBuster();
  return { status: "reloading" };
}

export function installChunkLoadErrorRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.message || event.error)) {
      void recoverFromChunkLoadError(event.message || event.error);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      void recoverFromChunkLoadError(event.reason);
    }
  });
}
