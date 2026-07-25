const PREFIX = "aaed:draft:v1:";
const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface StoredDraft<T> {
  version: 1;
  scopeId: string;
  updatedAt: number;
  expiresAt: number;
  data: T;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const testKey = `${PREFIX}__test`;
    window.sessionStorage.setItem(testKey, "1");
    window.sessionStorage.removeItem(testKey);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function draftKey(scopeId: string): string {
  return `${PREFIX}${encodeURIComponent(scopeId)}`;
}

function sanitize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_key, value) => {
    if (typeof File !== "undefined" && value instanceof File) return undefined;
    if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
    if (typeof value === "string" && /^(EAAG|sk_live_|sk_test_|xox|ghp_)/i.test(value)) return undefined;
    return value;
  }));
}

export function saveDraft<T>(scopeId: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  const s = storage();
  if (!s || !scopeId) return;
  const now = Date.now();
  const payload: StoredDraft<T> = {
    version: 1,
    scopeId,
    updatedAt: now,
    expiresAt: now + ttlMs,
    data: sanitize(data),
  };
  s.setItem(draftKey(scopeId), JSON.stringify(payload));
}

export function readDraft<T>(scopeId: string): StoredDraft<T> | null {
  const s = storage();
  if (!s || !scopeId) return null;
  const raw = s.getItem(draftKey(scopeId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      s.removeItem(draftKey(scopeId));
      return null;
    }
    return parsed;
  } catch {
    s.removeItem(draftKey(scopeId));
    return null;
  }
}

export function clearDraft(scopeId: string): void {
  const s = storage();
  if (!s || !scopeId) return;
  s.removeItem(draftKey(scopeId));
}

