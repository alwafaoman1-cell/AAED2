// Single source of truth for the running app build version.
// Bump this on every deploy (or set VITE_APP_VERSION at build time).
// The Cloud Update System compares this with the latest row in `app_versions`
// to decide if a new release is available.

export const CURRENT_APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || "2026.06.20";

/** Compare two version strings (semver-ish or date-based). Returns >0 if a>b. */
export function compareVersions(a: string, b: string): number {
  const norm = (s: string) =>
    String(s || "")
      .trim()
      .replace(/^v/i, "")
      .split(/[.\-_]/)
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const aa = norm(a);
  const bb = norm(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
