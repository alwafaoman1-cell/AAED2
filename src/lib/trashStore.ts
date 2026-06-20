// Centralized soft-delete trash bin for all entities (client-side store).
// Each entity type registers a restore handler. Items moved to trash can be
// restored or permanently deleted. Currently persists in localStorage.

export type EntityType =
  | "work_order"
  | "invoice"
  | "quote"
  | "vehicle"
  | "inventory"
  | "claim"
  | "inspection"
  | "staff"
  | "customer";

export interface TrashItem {
  trashId: string;
  type: EntityType;
  entityId: string;
  label: string; // human readable label e.g. "WO-2024-001 - أحمد محمد"
  payload: unknown; // serialized full entity for restore
  deletedAt: string;
  deletedBy?: string;
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  work_order: "أمر عمل / Work Order",
  invoice: "فاتورة / Invoice",
  quote: "عرض سعر / Quote",
  vehicle: "مركبة / Vehicle",
  inventory: "قطعة مخزون / Part",
  claim: "مطالبة تأمين / Claim",
  inspection: "تقرير فحص / Inspection",
  staff: "موظف / Staff",
  customer: "عميل / Customer",
};

const STORAGE_KEY = "alwafa_trash_v1";

let cache: TrashItem[] | null = null;
const listeners = new Set<() => void>();
const restoreHandlers = new Map<EntityType, (payload: unknown) => void>();

function load(): TrashItem[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

export function getTrash(): TrashItem[] {
  return load();
}

export function moveToTrash(item: Omit<TrashItem, "trashId" | "deletedAt">) {
  const list = load();
  list.unshift({
    ...item,
    trashId: `trash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    deletedAt: new Date().toISOString(),
  });
  persist();
}

export function permanentlyDelete(trashId: string) {
  cache = load().filter((t) => t.trashId !== trashId);
  persist();
}

export function emptyTrash() {
  cache = [];
  persist();
}

export function restore(trashId: string): boolean {
  const list = load();
  const item = list.find((t) => t.trashId === trashId);
  if (!item) return false;
  const handler = restoreHandlers.get(item.type);
  if (!handler) return false;
  handler(item.payload);
  cache = list.filter((t) => t.trashId !== trashId);
  persist();
  return true;
}

export function registerRestoreHandler(
  type: EntityType,
  handler: (payload: unknown) => void
) {
  restoreHandlers.set(type, handler);
}

export function subscribeTrash(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
