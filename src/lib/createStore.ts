import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

export interface BaseEntity {
  id: string;
}

interface StoreOptions<T extends BaseEntity> {
  key: string;
  seed: T[];
  storage?: boolean;
}

/**
 * Legacy synchronous CRUD facade backed by tenant_settings, not localStorage.
 * It keeps a small in-memory cache for immediate UI rendering and writes every
 * mutation to Supabase. Seed data is intentionally ignored in production.
 */
export function createStore<T extends BaseEntity>({ key }: StoreOptions<T>) {
  let cache: T[] | null = null;
  let bootstrapped = false;
  let mutationHandler: ((event: { type: "add" | "update" | "remove" | "restore"; item: T; previous?: T }) => void) | null = null;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => {
      try { listener(); } catch {}
    });
  }

  function setCache(rows: T[]) {
    cache = Array.isArray(rows) ? rows : [];
    notify();
  }

  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    void readCloudSetting<T[]>(key, []).then(setCache).catch(() => undefined);
    subscribeCloudSetting<T[]>(key, (rows) => setCache(rows || []));
  }

  function load(): T[] {
    bootstrap();
    if (!cache) cache = [];
    return cache;
  }

  function persist() {
    if (!cache) return;
    notify();
    void writeCloudSetting<T[]>(key, cache).catch((error) => {
      console.warn(`[createStore:${key}] Supabase setting write failed`, error);
    });
  }

  return {
    getAll(): T[] {
      return load();
    },
    getById(id: string): T | undefined {
      return load().find((item) => item.id === id);
    },
    add(item: T) {
      const list = load();
      list.unshift(item);
      persist();
      mutationHandler?.({ type: "add", item });
    },
    update(id: string, patch: Partial<T>) {
      const list = load();
      const idx = list.findIndex((item) => item.id === id);
      if (idx >= 0) {
        const previous = list[idx];
        list[idx] = { ...list[idx], ...patch };
        persist();
        mutationHandler?.({ type: "update", item: list[idx], previous });
      }
    },
    remove(id: string): T | undefined {
      const list = load();
      const idx = list.findIndex((item) => item.id === id);
      if (idx === -1) return undefined;
      const [removed] = list.splice(idx, 1);
      persist();
      mutationHandler?.({ type: "remove", item: removed });
      return removed;
    },
    restore(item: T) {
      const list = load();
      if (list.some((existing) => existing.id === item.id)) return;
      list.unshift(item);
      persist();
      mutationHandler?.({ type: "restore", item });
    },
    replaceAll(rows: T[]) {
      setCache(rows);
      persist();
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      bootstrap();
      return () => {
        listeners.delete(cb);
      };
    },
    refresh() {
      void readCloudSetting<T[]>(key, []).then(setCache).catch(() => undefined);
    },
    setMutationHandler(handler: typeof mutationHandler) {
      mutationHandler = handler;
    },
  };
}
