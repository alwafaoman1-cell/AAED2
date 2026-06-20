// Generic localStorage-backed CRUD store factory with cross-tab realtime sync.
// كل تغيير ينعكس فوراً في كل التبويبات/الصفحات بفضل BroadcastChannel + storage event.

export interface BaseEntity {
  id: string;
}

interface StoreOptions<T extends BaseEntity> {
  key: string;
  seed: T[];
}

export function createStore<T extends BaseEntity>({ key, seed }: StoreOptions<T>) {
  let cache: T[] | null = null;
  const listeners = new Set<() => void>();
  const channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`store:${key}`) : null;

  function notify() {
    listeners.forEach((l) => {
      try { l(); } catch {}
    });
  }

  function reloadFromStorage() {
    try {
      const raw = localStorage.getItem(key);
      cache = raw ? JSON.parse(raw) : [];
    } catch {
      cache = [];
    }
    notify();
  }

  // Cross-tab: BroadcastChannel
  if (channel) {
    channel.onmessage = () => reloadFromStorage();
  }

  // Cross-tab fallback: storage event (fires only in OTHER tabs)
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === key) reloadFromStorage();
    });
  }

  function load(): T[] {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        cache = JSON.parse(raw);
        return cache!;
      }
    } catch {}
    cache = [...seed];
    persist(false);
    return cache;
  }

  function persist(broadcast = true) {
    if (!cache) return;
    try {
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {}
    notify();
    if (broadcast && channel) {
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
    },
    update(id: string, patch: Partial<T>) {
      const list = load();
      const idx = list.findIndex((i) => i.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        persist();
      }
    },
    remove(id: string): T | undefined {
      const list = load();
      const idx = list.findIndex((i) => i.id === id);
      if (idx === -1) return undefined;
      const [removed] = list.splice(idx, 1);
      persist();
      return removed;
    },
    restore(item: T) {
      const list = load();
      if (list.some((i) => i.id === item.id)) return;
      list.unshift(item);
      persist();
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    /** يفرض إعادة تحميل من localStorage (مفيد بعد عمليات مجمّعة خارجية) */
    refresh() {
      reloadFromStorage();
    },
  };
}
