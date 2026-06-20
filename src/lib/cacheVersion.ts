// On every app load, compare the build version stored locally with the current
// one. If different, wipe transient caches (cloud setting cache + Realtime
// channels metadata) so the user immediately picks up the latest schema/data
// from the cloud. Authoritative data lives in Supabase — local caches are
// disposable.

const VERSION_KEY = "app_build_version";
const CURRENT_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || "2026.06.17";

export function ensureCacheVersion(): void {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (stored !== CURRENT_VERSION) {
      // Wipe only transient/cache keys, not user-entered drafts
      const keysToDrop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("cloud_setting_cache:") || k.startsWith("store:")) keysToDrop.push(k);
      }
      keysToDrop.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
      // eslint-disable-next-line no-console
      console.info(`[cache] upgraded ${stored || "(none)"} → ${CURRENT_VERSION}, cleared ${keysToDrop.length} cache keys`);
    }
  } catch {
    // ignore — non-critical
  }
}
