import { supabase } from "@/integrations/supabase/client";

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
  label: string;
  payload: unknown;
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

let cache: TrashItem[] = [];
let loadingPromise: Promise<TrashItem[]> | null = null;
let channelStarted = false;
const listeners = new Set<() => void>();
const restoreHandlers = new Map<EntityType, (payload: unknown, item: TrashItem) => void | Promise<void>>();

function notify() {
  listeners.forEach((listener) => listener());
}

function mapRow(row: any): TrashItem {
  return {
    trashId: row.id,
    type: row.entity_type,
    entityId: row.entity_id,
    label: row.label || "",
    payload: row.payload || {},
    deletedAt: row.deleted_at || row.created_at,
    deletedBy: row.deleted_by || undefined,
  };
}

async function getTenantId(): Promise<string> {
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error || !data) throw new Error(error?.message || "تعذر تحديد المؤسسة الحالية");
  return String(data);
}

export async function refreshTrash(): Promise<TrashItem[]> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const tenantId = await getTenantId();
    const { data, error } = await (supabase.from("app_trash" as any) as any)
      .select("id,entity_type,entity_id,label,payload,deleted_at,deleted_by,created_at")
      .eq("tenant_id", tenantId)
      .eq("restore_status", "trashed")
      .order("deleted_at", { ascending: false });
    if (error) throw error;
    cache = (data || []).map(mapRow);
    notify();
    return cache;
  })().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

function ensureRealtime() {
  if (channelStarted) return;
  channelStarted = true;
  supabase
    .channel("app_trash_cloud_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_trash" }, () => {
      void refreshTrash().catch(() => undefined);
    })
    .subscribe();
}

export function getTrash(): TrashItem[] {
  ensureRealtime();
  void refreshTrash().catch(() => undefined);
  return cache;
}

export async function moveToTrash(item: Omit<TrashItem, "trashId" | "deletedAt">): Promise<void> {
  const tenantId = await getTenantId();
  const optimistic: TrashItem = {
    ...item,
    trashId: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    deletedAt: new Date().toISOString(),
  };
  cache = [optimistic, ...cache.filter((entry) => !(entry.type === item.type && entry.entityId === item.entityId))];
  notify();

  const { error } = await (supabase.from("app_trash" as any) as any).insert({
    tenant_id: tenantId,
    entity_type: item.type,
    entity_id: item.entityId,
    label: item.label,
    payload: item.payload ?? {},
    deleted_by: item.deletedBy || null,
    restore_status: "trashed",
    metadata: {},
  });
  if (error) {
    cache = cache.filter((entry) => entry.trashId !== optimistic.trashId);
    notify();
    throw error;
  }
  await refreshTrash();
}

export async function permanentlyDelete(trashId: string): Promise<void> {
  const previous = cache;
  cache = cache.filter((entry) => entry.trashId !== trashId);
  notify();
  const { error } = await (supabase.from("app_trash" as any) as any)
    .delete()
    .eq("id", trashId);
  if (error) {
    cache = previous;
    notify();
    throw error;
  }
}

export async function emptyTrash(): Promise<void> {
  const previous = cache;
  cache = [];
  notify();
  const tenantId = await getTenantId();
  const { error } = await (supabase.from("app_trash" as any) as any)
    .delete()
    .eq("tenant_id", tenantId)
    .eq("restore_status", "trashed");
  if (error) {
    cache = previous;
    notify();
    throw error;
  }
}

export async function restore(trashId: string): Promise<boolean> {
  const item = cache.find((entry) => entry.trashId === trashId);
  if (!item) {
    await refreshTrash();
  }
  const current = cache.find((entry) => entry.trashId === trashId);
  if (!current) return false;
  const handler = restoreHandlers.get(current.type);
  if (!handler) return false;
  await handler(current.payload, current);

  const { error } = await (supabase.from("app_trash" as any) as any)
    .update({ restore_status: "restored", restored_at: new Date().toISOString() })
    .eq("id", trashId);
  if (error) throw error;
  cache = cache.filter((entry) => entry.trashId !== trashId);
  notify();
  return true;
}

export function registerRestoreHandler(
  type: EntityType,
  handler: (payload: unknown, item: TrashItem) => void | Promise<void>,
) {
  restoreHandlers.set(type, handler);
}

export function subscribeTrash(callback: () => void): () => void {
  ensureRealtime();
  listeners.add(callback);
  void refreshTrash().catch(() => undefined);
  return () => {
    listeners.delete(callback);
  };
}
