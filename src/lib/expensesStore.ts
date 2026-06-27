// Cloud-backed expenses store with synchronous cache + Supabase Realtime mirror.
// Keeps the same imperative API consumers rely on (getAll / getById / add / update / remove / subscribe)
// but persists every change to Supabase and listens for changes from other devices so the website
// and the supervisor/technician apps stay in sync across phones and browsers.
import type { PaymentMethod } from "./financeSettingsStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { isUuid } from "@/lib/uuid";

export interface ExpenseRecord {
  id: string;
  voucherNumber: string;
  date: string;
  amount: number;
  categoryId: string;
  categoryName?: string;
  cashboxId: string;
  cashboxName?: string;
  paymentMethod: PaymentMethod;
  beneficiary?: string;
  description?: string;
  photo?: string | null;
  linkedWorkOrderId?: string;
  customerId?: string;
  vehicleId?: string;
  claimId?: string;
  invoiceId?: string;
  linkedVehiclePlate?: string;
  linkedVehicleName?: string;
  reference?: string;
  edited?: boolean;
  refunded?: boolean;
  refundedAt?: string;
  supplierTaxNumber?: string;
  supplierInvoiceNumber?: string;
  partId?: string;
  partName?: string;
  partNumber?: string;
  partQty?: number;
  unitBuyPrice?: number;
  unitSellPrice?: number;
  requiredPartId?: string;
  sourceWorkOrderId?: string;
  sourceClaimId?: string;
  convertedFromRequiredPart?: boolean;
  archivedAt?: string;
  deletedAt?: string;
  deleteReason?: string;
  createdAt: string;
}

export function getExpensePartProfit(e: ExpenseRecord): number {
  if (!e.partName || !e.partQty || e.unitSellPrice == null || e.unitBuyPrice == null) return 0;
  return (e.unitSellPrice - e.unitBuyPrice) * e.partQty;
}
export function getExpensePartRevenue(e: ExpenseRecord): number {
  if (!e.partName || !e.partQty || e.unitSellPrice == null) return 0;
  return e.unitSellPrice * e.partQty;
}

// ---------------- in-memory cache + sync ----------------
let cache: ExpenseRecord[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function notify() { listeners.forEach((l) => { try { l(); } catch {} }); }

function persistLocal() {}

function rowToRecord(r: any): ExpenseRecord {
  const meta = (r.meta || {}) as Record<string, any>;
  const photo = Array.isArray(r.attachments) && r.attachments[0]?.url ? r.attachments[0].url : (meta.photo ?? null);
  return {
    id: r.id,
    voucherNumber: r.voucher_number,
    date: r.date,
    amount: Number(r.amount || 0),
    categoryId: r.category_id || "",
    categoryName: r.category_name || undefined,
    cashboxId: r.cashbox_id || "",
    cashboxName: r.cashbox_name || undefined,
    paymentMethod: (r.payment_method || "cash") as PaymentMethod,
    beneficiary: r.beneficiary || undefined,
    description: r.description || undefined,
    photo,
    linkedWorkOrderId: r.linked_work_order_id || undefined,
    customerId: r.customer_id || meta.customerId || undefined,
    vehicleId: r.vehicle_id || meta.vehicleId || undefined,
    claimId: r.claim_id || meta.claimId || undefined,
    invoiceId: r.invoice_id || meta.invoiceId || undefined,
    linkedVehiclePlate: r.linked_vehicle_plate || undefined,
    linkedVehicleName: r.linked_vehicle_name || undefined,
    reference: meta.reference,
    edited: meta.edited,
    refunded: meta.refunded,
    refundedAt: meta.refundedAt,
    supplierTaxNumber: meta.supplierTaxNumber,
    supplierInvoiceNumber: meta.supplierInvoiceNumber,
    partId: meta.partId,
    partName: meta.partName,
    partNumber: meta.partNumber,
    partQty: meta.partQty,
    unitBuyPrice: meta.unitBuyPrice,
    unitSellPrice: meta.unitSellPrice,
    requiredPartId: meta.requiredPartId,
    sourceWorkOrderId: meta.sourceWorkOrderId,
    sourceClaimId: meta.sourceClaimId,
    convertedFromRequiredPart: meta.convertedFromRequiredPart,
    archivedAt: meta.archivedAt,
    deletedAt: meta.deletedAt || r.deleted_at || undefined,
    deleteReason: meta.deleteReason,
    createdAt: r.created_at || new Date().toISOString(),
  };
}

function recordToRow(e: ExpenseRecord, tenantId: string) {
  const meta: Record<string, any> = {};
  if (e.reference !== undefined) meta.reference = e.reference;
  if (e.edited !== undefined) meta.edited = e.edited;
  if (e.refunded !== undefined) meta.refunded = e.refunded;
  if (e.refundedAt !== undefined) meta.refundedAt = e.refundedAt;
  if (e.supplierTaxNumber) meta.supplierTaxNumber = e.supplierTaxNumber;
  if (e.supplierInvoiceNumber) meta.supplierInvoiceNumber = e.supplierInvoiceNumber;
  if (e.partId) meta.partId = e.partId;
  if (e.partName) meta.partName = e.partName;
  if (e.partNumber) meta.partNumber = e.partNumber;
  if (e.partQty != null) meta.partQty = e.partQty;
  if (e.unitBuyPrice != null) meta.unitBuyPrice = e.unitBuyPrice;
  if (e.unitSellPrice != null) meta.unitSellPrice = e.unitSellPrice;
  if (e.requiredPartId) meta.requiredPartId = e.requiredPartId;
  if (e.customerId) meta.customerId = e.customerId;
  if (e.vehicleId) meta.vehicleId = e.vehicleId;
  if (e.claimId) meta.claimId = e.claimId;
  if (e.invoiceId) meta.invoiceId = e.invoiceId;
  if (e.sourceWorkOrderId) meta.sourceWorkOrderId = e.sourceWorkOrderId;
  if (e.sourceClaimId) meta.sourceClaimId = e.sourceClaimId;
  if (e.convertedFromRequiredPart !== undefined) meta.convertedFromRequiredPart = e.convertedFromRequiredPart;
  if (e.archivedAt) meta.archivedAt = e.archivedAt;
  if (e.deletedAt) meta.deletedAt = e.deletedAt;
  if (e.deleteReason) meta.deleteReason = e.deleteReason;
  // photo stored under attachments; also mirror in meta for resilience
  const attachments = e.photo ? [{ url: e.photo }] : [];
  if (e.photo) meta.photo = e.photo;
  return {
    id: e.id,
    tenant_id: tenantId,
    voucher_number: e.voucherNumber,
    date: e.date,
    amount: Number(e.amount || 0),
    category_id: e.categoryId || null,
    category_name: e.categoryName || null,
    cashbox_id: e.cashboxId || null,
    cashbox_name: e.cashboxName || null,
    payment_method: e.paymentMethod || "cash",
    beneficiary: e.beneficiary || null,
    description: e.description || null,
    linked_work_order_id: e.linkedWorkOrderId || null,
    customer_id: e.customerId && isUuid(e.customerId) ? e.customerId : null,
    vehicle_id: e.vehicleId && isUuid(e.vehicleId) ? e.vehicleId : null,
    claim_id: e.claimId && isUuid(e.claimId) ? e.claimId : null,
    invoice_id: e.invoiceId && isUuid(e.invoiceId) ? e.invoiceId : null,
    linked_vehicle_plate: e.linkedVehiclePlate || null,
    linked_vehicle_name: e.linkedVehicleName || null,
    attachments,
    meta,
    deleted_at: e.deletedAt || null,
    archived_at: e.archivedAt || null,
  };
}

async function hydrateFromCloud() {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("date", { ascending: false });
    if (error) throw error;
    const cloud = (data || []).map(rowToRecord);
    cache = cloud;
    hydrated = true;
    persistLocal();
    notify();
  } catch (e) {
    if (!hydrated) notify();
  }
}

// Initial hydration is Supabase-only.
if (typeof window !== "undefined") {
  hydrateFromCloud();

  // Refresh after sign-in.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      hydrateFromCloud();
    }
  });

  // Realtime mirror: any insert/update/delete from any device updates the cache.
  try {
    supabase
      .channel("expenses_store_sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        (payload) => {
          const ev = payload.eventType;
          if (ev === "INSERT" || ev === "UPDATE") {
            const rec = rowToRecord(payload.new);
            if (rec.deletedAt || rec.archivedAt) {
              cache = cache.filter((x) => x.id !== rec.id);
              persistLocal();
              notify();
              return;
            }
            const idx = cache.findIndex((x) => x.id === rec.id);
            if (idx >= 0) cache[idx] = rec;
            else cache.unshift(rec);
          } else if (ev === "DELETE") {
            const oldId = (payload.old as any)?.id;
            if (oldId) cache = cache.filter((x) => x.id !== oldId);
          }
          persistLocal();
          notify();
        },
      )
      .subscribe();
  } catch {}
}

// ---------------- public store API (same shape as before) ----------------
export const expensesStore = {
  getAll(): ExpenseRecord[] {
    return cache;
  },
  getById(id: string): ExpenseRecord | undefined {
    return cache.find((e) => e.id === id);
  },
  async add(item: ExpenseRecord) {
    // DB id is uuid — normalize legacy "EXP-<ts>" ids to a real uuid so the row inserts.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id || "");
    if (!isUuid) {
      const newId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      item.id = newId; // mutate so caller keeps a valid reference
    }
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
    const row = recordToRow(item, tenantId);
    const { data, error } = await (supabase.from("expenses") as any)
      .upsert(row)
      .select("*")
      .single();
    if (error) throw error;
    if (!data?.id) throw new Error("تعذر تأكيد حفظ المصروف في Supabase");
    const saved = rowToRecord(data);
    cache = [saved, ...cache.filter((e) => e.id !== saved.id)];
    persistLocal();
    notify();
    return saved;
  },
  async update(id: string, patch: Partial<ExpenseRecord>) {
    if (!isUuid(id)) throw new Error("expense_id غير صالح للحفظ في Supabase");
    const idx = cache.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("المصروف غير موجود في القائمة الحالية");
    const next = { ...cache[idx], ...patch };
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
    const row = recordToRow(next, tenantId);
    // Remove tenant_id from update payload to avoid changing it.
    const { tenant_id, id: _id, ...updatable } = row as any;
    const { data, error } = await supabase
      .from("expenses")
      .update(updatable)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    if (!data?.id) throw new Error("تعذر تأكيد تحديث المصروف في Supabase");
    cache[idx] = rowToRecord(data);
    persistLocal();
    notify();
    return cache[idx];
  },
  async remove(id: string): Promise<ExpenseRecord | undefined> {
    if (!isUuid(id)) throw new Error("expense_id غير صالح للحذف في Supabase");
    const idx = cache.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("المصروف غير موجود في القائمة الحالية");
    const removed = cache[idx];
    const deletedAt = new Date().toISOString();
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
      const { data, error } = await supabase
        .from("expenses")
        .update({
          deleted_at: deletedAt,
          meta: { ...(recordToRow(removed, "unused").meta as any), deletedAt, deleteReason: removed.deleteReason || "soft delete" },
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error("لم يتم حذف المصروف في Supabase");
      cache = cache.filter((e) => e.id !== id);
      persistLocal();
      notify();
    } catch (e) {
      console.warn("[expensesStore.remove] failed", e);
      throw e;
    }
    return removed;
  },
  restore(item: ExpenseRecord) {
    if (cache.some((e) => e.id === item.id)) return;
    cache = [item, ...cache];
    persistLocal();
    notify();
    // Best effort re-insert in cloud
    (async () => {
      try {
        const tenantId = await getCurrentTenantId();
        if (!tenantId) return;
        await (supabase.from("expenses") as any).upsert(recordToRow(item, tenantId));
      } catch {}
    })();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  refresh() {
    hydrateFromCloud();
  },
};

export function getExpensesForWorkOrder(workOrderId: string): ExpenseRecord[] {
  return expensesStore
    .getAll()
    .filter((e) => (e.linkedWorkOrderId === workOrderId || e.sourceWorkOrderId === workOrderId) && !e.deletedAt && !e.archivedAt)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function getExpensesTotalForWorkOrder(workOrderId: string): number {
  return getExpensesForWorkOrder(workOrderId).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function getExpensesForClaim(claimId: string): ExpenseRecord[] {
  return expensesStore
    .getAll()
    .filter((e) => (e.claimId === claimId || e.sourceClaimId === claimId) && !e.deletedAt && !e.archivedAt)
    .sort((a, b) => b.date.localeCompare(a.date));
}
