import {
  getCloudSettingsScopeVersion,
  mutateCloudArraySetting,
  readCloudSetting,
  readCloudSettingFresh,
  subscribeCloudSetting,
  subscribeCloudSettingsScopeChange,
  writeCloudSetting,
  type CloudArrayMutation,
} from "./cloudSettings";

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
  let storeEpoch = 0;
  let pendingMutations = 0;
  let mutationQueue: Promise<void> = Promise.resolve();
  let unsubscribeCloud: (() => void) | null = null;
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

  subscribeCloudSettingsScopeChange(() => {
    storeEpoch += 1;
    pendingMutations = 0;
    mutationQueue = Promise.resolve();
    cache = null;
    bootstrapped = false;
    unsubscribeCloud?.();
    unsubscribeCloud = null;
    notify();
  });

  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
    const epoch = storeEpoch;
    void readCloudSetting<T[]>(key, []).then((rows) => {
      if (epoch === storeEpoch && pendingMutations === 0) setCache(rows);
    }).catch(() => undefined);
    unsubscribeCloud = subscribeCloudSetting<T[]>(key, (rows) => {
      if (epoch === storeEpoch && pendingMutations === 0) setCache(rows || []);
    });
  }

  function load(): T[] {
    bootstrap();
    if (!cache) cache = [];
    return cache;
  }

  function reportSaveFailure(error: unknown) {
    console.warn(`[createStore:${key}] Supabase setting write failed`, error);
    if (typeof window !== "undefined") {
      void import("sonner").then(({ toast }) => {
        toast.error("لم تُحفظ البيانات في السحابة. أعد فتح السجل وتحقق قبل المتابعة.");
      });
    }
  }

  function enqueue(mutation: CloudArrayMutation<T>): Promise<T[]> {
    const epoch = storeEpoch;
    const scopeVersion = getCloudSettingsScopeVersion();
    pendingMutations += 1;
    const request = mutationQueue.then(() => mutateCloudArraySetting(key, mutation, scopeVersion));
    mutationQueue = request.then(() => undefined, () => undefined);
    void request.then((rows) => {
      if (epoch !== storeEpoch) return;
      pendingMutations -= 1;
      if (pendingMutations === 0) setCache(rows);
    }, () => {
      if (epoch !== storeEpoch) return;
      pendingMutations -= 1;
      if (pendingMutations === 0) {
        void readCloudSettingFresh<T[]>(key, []).then((rows) => {
          if (epoch === storeEpoch && pendingMutations === 0) setCache(rows);
        }).catch((error) => console.warn(`[createStore:${key}] reconciliation failed`, error));
      }
    });
    return request;
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
      notify();
      void enqueue({ type: "add", item }).then(() => {
        mutationHandler?.({ type: "add", item });
      }).catch(reportSaveFailure);
    },
    async addConfirmed(item: T): Promise<T> {
      load();
      await enqueue({ type: "add", item });
      mutationHandler?.({ type: "add", item });
      return item;
    },
    update(id: string, patch: Partial<T>) {
      const list = load();
      const idx = list.findIndex((item) => item.id === id);
      if (idx >= 0) {
        const previous = list[idx];
        list[idx] = { ...list[idx], ...patch };
        const updated = list[idx];
        notify();
        void enqueue({ type: "update", id, patch }).then(() => {
          mutationHandler?.({ type: "update", item: updated, previous });
        }).catch(reportSaveFailure);
      }
    },
    async updateConfirmed(id: string, patch: Partial<T>): Promise<T> {
      const previous = load().find((item) => item.id === id);
      await enqueue({ type: "update", id, patch });
      const updated = { ...previous, ...patch } as T;
      mutationHandler?.({ type: "update", item: updated, previous });
      return updated;
    },
    remove(id: string): T | undefined {
      const list = load();
      const idx = list.findIndex((item) => item.id === id);
      if (idx === -1) return undefined;
      const [removed] = list.splice(idx, 1);
      notify();
      void enqueue({ type: "remove", id }).then(() => {
        mutationHandler?.({ type: "remove", item: removed });
      }).catch(reportSaveFailure);
      return removed;
    },
    async removeConfirmed(id: string): Promise<T | undefined> {
      const removed = load().find((item) => item.id === id);
      if (!removed) return undefined;
      await enqueue({ type: "remove", id });
      mutationHandler?.({ type: "remove", item: removed });
      return removed;
    },
    restore(item: T) {
      const list = load();
      if (list.some((existing) => existing.id === item.id)) return;
      list.unshift(item);
      notify();
      void enqueue({ type: "restore", item }).then(() => {
        mutationHandler?.({ type: "restore", item });
      }).catch(reportSaveFailure);
    },
    replaceAll(rows: T[]) {
      setCache(rows);
      void writeCloudSetting<T[]>(key, rows).catch(reportSaveFailure);
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      bootstrap();
      return () => {
        listeners.delete(cb);
      };
    },
    refresh() {
      const epoch = storeEpoch;
      void readCloudSetting<T[]>(key, []).then((rows) => {
        if (epoch === storeEpoch && pendingMutations === 0) setCache(rows);
      }).catch(() => undefined);
    },
    setMutationHandler(handler: typeof mutationHandler) {
      mutationHandler = handler;
    },
  };
}
