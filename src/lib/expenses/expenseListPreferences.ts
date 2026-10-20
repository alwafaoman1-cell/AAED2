export const EXPENSE_FILTER_TTL_MS = 12 * 60 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type SavedFilters = { savedAt: number; query: string };

const storageKey = (tenantId: string) => `expense_management_filters_v1:${tenantId}`;
const browserStorage = (): StorageLike | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

function allowedParams(params: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const allowed = new URLSearchParams();
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) allowed.set(key, value);
  }
  return allowed;
}

export function loadExpenseListFilters(
  tenantId: string,
  keys: readonly string[],
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): URLSearchParams | null {
  if (!tenantId || !storage) return null;
  const key = storageKey(tenantId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedFilters;
    if (!saved || !Number.isFinite(saved.savedAt) || saved.savedAt > now || now - saved.savedAt > EXPENSE_FILTER_TTL_MS || typeof saved.query !== "string") {
      storage.removeItem(key);
      return null;
    }
    return allowedParams(new URLSearchParams(saved.query), keys);
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function saveExpenseListFilters(
  tenantId: string,
  params: URLSearchParams,
  keys: readonly string[],
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): void {
  if (!tenantId || !storage) return;
  try {
    storage.setItem(storageKey(tenantId), JSON.stringify({ savedAt: now, query: allowedParams(params, keys).toString() }));
  } catch {
    // Filters are a convenience; a storage quota/privacy setting must not break the page.
  }
}

export function clearExpenseListFilters(tenantId: string, storage: StorageLike | null = browserStorage()): void {
  if (!tenantId || !storage) return;
  try { storage.removeItem(storageKey(tenantId)); } catch { /* storage unavailable */ }
}
