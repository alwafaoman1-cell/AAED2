// Generic localStorage-backed CRUD store factory with cross-tab realtime sync.
// كل تغيير ينعكس فوراً في كل التبويبات/الصفحات بفضل BroadcastChannel + storage event.

export interface BaseEntity {
  id: string;
}

interface StoreOptions<T extends BaseEntity> {
  key: string;
  seed: T[];
  storage?: boolean;
}

export function createStore<T extends BaseEntity>({ key, storage = true }: StoreOptions<T>) {
  let cache: T[] | null = null;
  let mutationHandler: ((event: { type: "add" | "update" | "remove" | "restore"; item: T; previous?: T }) => void) | null = null;
  const listeners = new Set<() => void>();
  const channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`store:${key}`) : null;

  function notify() {
    listeners.forEach((l) => {
      try { l(); } catch {}
    });
  }

  function reloadFromStorage() {
    if (!storage) {
      cache = [];
      notify();
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      cache = raw ? JSON.parse(raw) : [];
    } catch {
      cache = [];
    }
    notify();
  }

  // Cross-tab: BroadcastChannel
  if (channel && storage) {
    channel.onmessage = () => reloadFromStorage();
  }

  // Cross-tab fallback: storage event (fires only in OTHER tabs)
  if (typeof window !== "undefined" && storage) {
    window.addEventListener("storage", (e) => {
      if (e.key === key) reloadFromStorage();
    });
  }

  function load(): T[] {
    if (cache) return cache;
    if (storage) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          cache = JSON.parse(raw);
          return cache!;
        }
      } catch {}
    }
    // Production starts empty. Demo seed arrays are intentionally ignored.
    cache = [];
    persist(false);
    return cache;
  }

  function persist(broadcast = true) {
    if (!cache) return;
    if (storage) {
      try {
        localStorage.setItem(key, JSON.stringify(cache));
      } catch {}
    }
    notify();
    if (broadcast && channel && storage) {
      try { channel.postMessage({ ts: Date.now() }); } catch {}
    }
  }

  return {
    getAll(): T[] {
      return load();
    },
    getById(id: string): T | undefined {
      return load().find((i) => i.id === id);
    },
    add(item: T) {
      const list = load();
      list.unshift(item);
      persist();
      mutationHandler?.({ type: "add", item });
    },
    update(id: string, patch: Partial<T>) {
      const list = load();
      const idx = list.findIndex((i) => i.id === id);
      if (idx >= 0) {
        const previous = list[idx];
        list[idx] = { ...list[idx], ...patch };
        persist();
        mutationHandler?.({ type: "update", item: list[idx], previous });
      }
    },
    remove(id: string): T | undefined {
      const list = load();
      const idx = list.findIndex((i) => i.id === id);
      if (idx === -1) return undefined;
      const [removed] = list.splice(idx, 1);
      persist();
      mutationHandler?.({ type: "remove", item: removed });
      return removed;
    },
    restore(item: T) {
      const list = load();
      if (list.some((i) => i.id === item.id)) return;
      list.unshift(item);
      persist();
      mutationHandler?.({ type: "restore", item });
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    /** يعيد تهيئة الذاكرة من التخزين للإعدادات المحلية فقط. */
    refresh() {
      reloadFromStorage();
    },
    setMutationHandler(handler: typeof mutationHandler) {
      mutationHandler = handler;
    },
  };
}
