// Cloud-backed expenses store with synchronous cache + Supabase Realtime mirror.
// Keeps the same imperative API consumers rely on (getAll / getById / add / update / remove / subscribe)
// but persists every change to Supabase and listens for changes from other devices so the website
// and the supervisor/technician apps stay in sync across phones and browsers.
import type { PaymentMethod } from "./financeSettingsStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { isUuid } from "@/lib/uuid";
import { deriveExpenseTotals } from "@/lib/expenses/expenseTotals";
import {
  checkExpenseDuplicates,
  duplicateExpenseMessage,
  exactDuplicateErrorFromDatabase,
  ExpenseExactDuplicateError,
  ExpensePotentialDuplicateError,
} from "@/lib/expenses/expenseDuplicateGuard";
import { queryKeys } from "@/lib/queryKeys";
import type { QueryClient } from "@tanstack/react-query";

export type ExpenseAccountingType =
  | "workshop_general"
  | "cash_vehicle_parts"
  | "insurance_claim"
  | "other_direct_vehicle"
  | "unassigned";

export interface ExpenseRecord {
  id: string;
  voucherNumber: string;
  date: string;
  amount: number;
  expenseType?: ExpenseAccountingType;
  costCenter?: string;
  subtotal?: number;
  vatAmount?: number;
  total?: number;
  isVatApplicable?: boolean;
  categoryId: string;
  categoryName?: string;
  departmentId?: string;
  expenseCategoryId?: string;
  subcategoryId?: string;
  cashboxId: string;
  cashboxName?: string;
  paymentMethod: PaymentMethod;
  beneficiary?: string;
  description?: string;
  photo?: string | null;
  /** Canonical Supabase job_orders.id. Kept separately from the visible order number. */
  canonicalWorkOrderId?: string;
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
  supplierId?: string;
  supplierName?: string;
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
  duplicateBatchId?: string;
  duplicateOverrideReason?: string;
  documentSha256?: string;
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

export function inferExpenseAccountingType(e: Partial<ExpenseRecord>): ExpenseAccountingType {
  const text = [e.categoryName, e.description, e.partName, e.reference].filter(Boolean).join(" ").toLowerCase();
  if (e.claimId || e.sourceClaimId) return "insurance_claim";
  if (e.partName || /spare|part|قطع|غيار/.test(text)) return "cash_vehicle_parts";
  if (e.vehicleId || e.linkedVehiclePlate || e.linkedWorkOrderId || e.sourceWorkOrderId) return "other_direct_vehicle";
  if (/general|overhead|rent|utility|workshop|عام|ورشة|ايجار|كهرباء/.test(text)) return "workshop_general";
  return "unassigned";
}

export function normalizeExpenseAccountingFields(e: ExpenseRecord): ExpenseRecord {
  // A supplier tax number is the sole VAT eligibility signal. The entered
  // amount remains the final amount paid and VAT is split from it when eligible.
  const isVatApplicable = Boolean(e.supplierTaxNumber?.trim());
  const { subtotal, vatAmount, total } = deriveExpenseTotals(e.amount, isVatApplicable);
  const expenseType = e.expenseType || inferExpenseAccountingType(e);
  const costCenter = e.costCenter || (
    expenseType === "workshop_general"
      ? "workshop_general"
      : e.claimId || e.sourceClaimId || e.linkedWorkOrderId || e.sourceWorkOrderId || e.vehicleId || e.linkedVehiclePlate || "unassigned"
  );
  return { ...e, expenseType, costCenter, subtotal, vatAmount, total, isVatApplicable };
}

// ---------------- in-memory cache + sync ----------------
let cache: ExpenseRecord[] = [];
let hydrated = false;
const listeners = new Set<() => void>();
let cacheRevision = 0;
let hydrationRequest = 0;
let hydrationPromise: Promise<void> | null = null;
const deletedExpenseIds = new Set<string>();
let expenseQueryClient: QueryClient | null = null;
let expenseAuthWatcherStarted = false;
let expenseSessionUserId: string | null = null;
let expenseTenantId: string | null = null;

function clearExpenseSessionCache(nextUserId: string | null = null) {
  hydrationRequest += 1;
  hydrationPromise = null;
  cache = [];
  hydrated = false;
  deletedExpenseIds.clear();
  expenseSessionUserId = nextUserId;
  expenseTenantId = null;
  markCacheChanged();
  notify();
}

function ensureExpenseStoreSessionWatcher() {
  if (expenseAuthWatcherStarted || typeof window === "undefined") return;
  expenseAuthWatcherStarted = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id ?? null;
    const userChanged = nextUserId !== expenseSessionUserId;
    if (event === "SIGNED_OUT" || userChanged || event === "USER_UPDATED") {
      clearExpenseSessionCache(nextUserId);
    }
    if (nextUserId && listeners.size > 0 && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
      // Supabase advises against awaiting additional SDK calls in the auth
      // callback. Start the fresh load after the callback has returned.
      setTimeout(() => { void hydrateFromCloud(); }, 0);
    }
  });
}

export function setExpensesQueryClient(client: QueryClient) {
  expenseQueryClient = client;
}

function invalidateExpenseConsumers() {
  if (!expenseQueryClient) return;
  void Promise.all([
    expenseQueryClient.invalidateQueries({ queryKey: queryKeys.expenseManagement.all }),
    expenseQueryClient.invalidateQueries({ queryKey: queryKeys.workOrderFinancials.all }),
    expenseQueryClient.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all }),
    expenseQueryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
    expenseQueryClient.invalidateQueries({ queryKey: queryKeys.reportCenter.all }),
  ]);
}

function notify() { listeners.forEach((l) => { try { l(); } catch {} }); }

function markCacheChanged() {
  cacheRevision += 1;
}

function persistLocal() {}

function rowToRecord(r: any): ExpenseRecord {
  const meta = (r.meta || {}) as Record<string, any>;
  const photo = Array.isArray(r.attachments) && r.attachments[0]?.url ? r.attachments[0].url : (meta.photo ?? null);
  return normalizeExpenseAccountingFields({
    id: r.id,
    voucherNumber: r.voucher_number,
    date: r.date,
    amount: Number(r.amount || 0),
    expenseType: (r.expense_type || meta.expenseType || "unassigned") as ExpenseAccountingType,
    costCenter: r.cost_center || meta.costCenter || undefined,
    subtotal: Number(r.subtotal ?? meta.subtotal ?? r.amount ?? 0),
    vatAmount: Number(r.vat_amount ?? meta.vatAmount ?? 0),
    total: Number(r.total ?? meta.total ?? r.amount ?? 0),
    isVatApplicable: r.is_vat_applicable ?? meta.isVatApplicable ?? true,
    categoryId: r.category_id || "",
    categoryName: r.category_name || undefined,
    departmentId: r.department_id || undefined,
    expenseCategoryId: r.expense_category_id || undefined,
    subcategoryId: r.subcategory_id || undefined,
    cashboxId: r.cashbox_id || "",
    cashboxName: r.cashbox_name || undefined,
    paymentMethod: (r.payment_method || "cash") as PaymentMethod,
    beneficiary: r.beneficiary || undefined,
    description: r.description || undefined,
    photo,
    // Keep both identities returned by the database. The classification
    // trigger intentionally rewrites linked_work_order_id to the current
    // visible order number, while work_order_id remains the canonical UUID.
    // Collapsing both into one property caused a valid saved voucher to look
    // detached when a screen only had the other identity available.
    canonicalWorkOrderId: r.work_order_id || undefined,
    linkedWorkOrderId: r.linked_work_order_id || r.work_order_id || undefined,
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
    supplierTaxNumber: r.supplier_tax_number || meta.supplierTaxNumber,
    supplierInvoiceNumber: r.supplier_invoice_number || meta.supplierInvoiceNumber,
    supplierId: r.supplier_id || meta.supplierId,
    supplierName: meta.supplierName || r.beneficiary || undefined,
    partId: meta.partId,
    partName: meta.partName,
    partNumber: meta.partNumber,
    partQty: meta.partQty,
    unitBuyPrice: meta.unitBuyPrice,
    unitSellPrice: meta.unitSellPrice,
    requiredPartId: meta.requiredPartId,
    sourceWorkOrderId: meta.sourceWorkOrderId || r.work_order_id || undefined,
    sourceClaimId: meta.sourceClaimId,
    convertedFromRequiredPart: meta.convertedFromRequiredPart,
    duplicateBatchId: meta.duplicateBatchId,
    duplicateOverrideReason: meta.duplicateOverrideReason,
    documentSha256: r.document_sha256 || meta.documentSha256,
    archivedAt: meta.archivedAt,
    deletedAt: meta.deletedAt || r.deleted_at || undefined,
    deleteReason: meta.deleteReason,
    createdAt: r.created_at || new Date().toISOString(),
  });
}

function recordToRow(e: ExpenseRecord, tenantId: string) {
  e = normalizeExpenseAccountingFields(e);
  const meta: Record<string, any> = {};
  meta.expenseType = e.expenseType || "unassigned";
  meta.costCenter = e.costCenter || "unassigned";
  meta.subtotal = e.subtotal ?? e.amount;
  meta.vatAmount = e.vatAmount ?? 0;
  meta.total = e.total ?? e.amount;
  meta.isVatApplicable = e.isVatApplicable ?? true;
  if (e.reference !== undefined) meta.reference = e.reference;
  if (e.edited !== undefined) meta.edited = e.edited;
  if (e.refunded !== undefined) meta.refunded = e.refunded;
  if (e.refundedAt !== undefined) meta.refundedAt = e.refundedAt;
  if (e.supplierTaxNumber) meta.supplierTaxNumber = e.supplierTaxNumber;
  if (e.supplierInvoiceNumber) meta.supplierInvoiceNumber = e.supplierInvoiceNumber;
  if (e.supplierId) meta.supplierId = e.supplierId;
  if (e.supplierName) meta.supplierName = e.supplierName;
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
  if (e.duplicateBatchId) meta.duplicateBatchId = e.duplicateBatchId;
  if (e.duplicateOverrideReason) meta.duplicateOverrideReason = e.duplicateOverrideReason;
  if (e.documentSha256) meta.documentSha256 = e.documentSha256;
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
    department_id: e.departmentId || null,
    expense_category_id: e.expenseCategoryId || null,
    subcategory_id: e.subcategoryId || null,
    cashbox_id: e.cashboxId || null,
    cashbox_name: e.cashboxName || null,
    payment_method: e.paymentMethod || "cash",
    expense_type: e.expenseType || "unassigned",
    expense_scope: e.linkedWorkOrderId || e.sourceWorkOrderId ? "work_order" : "operating",
    work_order_channel: e.claimId || e.sourceClaimId ? "insurance" : (e.linkedWorkOrderId || e.sourceWorkOrderId ? "cash" : null),
    cost_center: e.costCenter || "unassigned",
    subtotal: Number(e.subtotal ?? e.amount ?? 0),
    vat_amount: Number(e.vatAmount ?? 0),
    total: Number(e.total ?? e.amount ?? 0),
    is_vat_applicable: e.isVatApplicable ?? true,
    supplier_tax_number: e.supplierTaxNumber || null,
    supplier_invoice_number: e.supplierInvoiceNumber || null,
    document_sha256: e.documentSha256 || null,
    supplier_id: e.supplierId && isUuid(e.supplierId) ? e.supplierId : null,
    beneficiary: e.beneficiary || null,
    description: e.description || null,
    // Keep both relations during the compatibility period. New writes must
    // populate the canonical FK so management/report RPCs and work-order
    // screens read the same expense row immediately.
    work_order_id: e.canonicalWorkOrderId && isUuid(e.canonicalWorkOrderId)
      ? e.canonicalWorkOrderId
      : (e.linkedWorkOrderId && isUuid(e.linkedWorkOrderId) ? e.linkedWorkOrderId : null),
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

function stripExpenseAccountingColumns(row: Record<string, any>) {
  const {
    expense_type,
    cost_center,
    subtotal,
    vat_amount,
    total,
    is_vat_applicable,
    supplier_tax_number,
    supplier_invoice_number,
    document_sha256,
    supplier_id,
    department_id,
    expense_category_id,
    subcategory_id,
    expense_scope,
    work_order_channel,
    ...legacy
  } = row;
  return legacy;
}

function isMissingAccountingColumnError(error: any): boolean {
  const msg = String(error?.message || error?.details || "");
  return /expense_type|expense_scope|work_order_channel|cost_center|vat_amount|is_vat_applicable|supplier_tax_number|supplier_invoice_number|document_sha256|supplier_id|department_id|expense_category_id|subcategory_id|subtotal|total/.test(msg)
    && /column|schema|cache/i.test(msg);
}

async function hydrateFromCloud() {
  ensureExpenseStoreSessionWatcher();
  if (hydrationPromise) return hydrationPromise;
  const requestId = ++hydrationRequest;
  const revisionAtStart = cacheRevision;
  hydrationPromise = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const requestedUserId = sessionData.session?.user?.id ?? null;
      if (!requestedUserId) {
        if (expenseSessionUserId !== null || cache.length > 0) clearExpenseSessionCache(null);
        hydrated = true;
        notify();
        return;
      }
      if (expenseSessionUserId && expenseSessionUserId !== requestedUserId) {
        clearExpenseSessionCache(requestedUserId);
      } else {
        expenseSessionUserId = requestedUserId;
      }
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("tenant_not_found");
      expenseTenantId = tenantId;
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("date", { ascending: false });
      if (error) throw error;
      const { data: currentSessionData } = await supabase.auth.getSession();
      const currentUserId = currentSessionData.session?.user?.id ?? null;
      if (
        requestId !== hydrationRequest ||
        currentUserId !== requestedUserId ||
        expenseSessionUserId !== requestedUserId ||
        expenseTenantId !== tenantId
      ) return;
      const cloud = (data || []).map(rowToRecord);
      if (revisionAtStart === cacheRevision) {
        cache = cloud.filter((expense) => !deletedExpenseIds.has(expense.id));
      } else {
        // Preserve saves/realtime changes that completed after this SELECT
        // started. An older snapshot must never hide a newly saved voucher.
        const merged = new Map(cloud.map((expense) => [expense.id, expense]));
        for (const expense of cache) merged.set(expense.id, expense);
        for (const deletedId of deletedExpenseIds) merged.delete(deletedId);
        cache = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
      }
      hydrated = true;
      persistLocal();
      notify();
    } catch (e) {
      if (!hydrated) notify();
    }
  })().finally(() => {
    if (requestId === hydrationRequest) hydrationPromise = null;
  });
  return hydrationPromise;
}

export type ExpenseRealtimePayload = {
  eventType?: string;
  new?: Record<string, any>;
  old?: Record<string, any>;
};

/** Applies the single, tenant-scoped central Realtime event to the legacy cache. */
export async function applyExpenseRealtimeChange(payload: ExpenseRealtimePayload): Promise<void> {
  ensureExpenseStoreSessionWatcher();
  const eventType = String(payload?.eventType || "").toUpperCase();
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
  if (!row) return;

  const tenantId = expenseTenantId || await getCurrentTenantId();
  if (!tenantId || (row.tenant_id && row.tenant_id !== tenantId)) return;
  expenseTenantId = tenantId;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    const rec = rowToRecord(row);
    if (rec.deletedAt || rec.archivedAt) {
      cache = cache.filter((expense) => expense.id !== rec.id);
      deletedExpenseIds.add(rec.id);
    } else {
      deletedExpenseIds.delete(rec.id);
      const index = cache.findIndex((expense) => expense.id === rec.id);
      if (index >= 0) cache[index] = rec;
      else cache.unshift(rec);
    }
  } else if (eventType === "DELETE") {
    const oldId = String(row.id || "").trim();
    if (!oldId) return;
    cache = cache.filter((expense) => expense.id !== oldId);
    deletedExpenseIds.add(oldId);
  } else {
    return;
  }

  markCacheChanged();
  persistLocal();
  notify();
  invalidateExpenseConsumers();
}

// ---------------- public store API (same shape as before) ----------------
export const expensesStore = {
  getAll(): ExpenseRecord[] {
    ensureExpenseStoreSessionWatcher();
    return cache;
  },
  getById(id: string): ExpenseRecord | undefined {
    ensureExpenseStoreSessionWatcher();
    return cache.find((e) => e.id === id);
  },
  async add(item: ExpenseRecord) {
    ensureExpenseStoreSessionWatcher();
    // DB id is uuid — normalize legacy "EXP-<ts>" ids to a real uuid so the row inserts.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id || "");
    if (!isUuid) {
      const newId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      item.id = newId; // mutate so caller keeps a valid reference
    }
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
    if (item.photo && !item.documentSha256) {
      const { sha256Text } = await import("@/lib/expenses/expenseDuplicateGuard");
      item.documentSha256 = await sha256Text(item.photo);
    }
    const row = recordToRow(item, tenantId);
    const duplicates = await checkExpenseDuplicates({
      supplier_id: row.supplier_id,
      supplier_tax_number: row.supplier_tax_number,
      beneficiary: row.beneficiary,
      supplier_invoice_number: row.supplier_invoice_number,
      date: row.date,
      total: row.total,
      work_order_id: row.work_order_id,
      linked_work_order_id: row.linked_work_order_id,
      description: row.description,
      duplicate_batch_id: item.duplicateBatchId,
      document_sha256: row.document_sha256,
    });
    if (duplicates.exact.length) throw new ExpenseExactDuplicateError(duplicates.exact);
    if (duplicates.potential.length && !item.duplicateOverrideReason) {
      throw new ExpensePotentialDuplicateError(duplicates.potential);
    }
    let { data, error } = await (supabase.from("expenses") as any)
      .upsert(row)
      .select("*")
      .single();
    if (error && isMissingAccountingColumnError(error)) {
      const retry = await (supabase.from("expenses") as any)
        .upsert(stripExpenseAccountingColumns(row as any))
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      const exactDuplicate = exactDuplicateErrorFromDatabase(error);
      if (exactDuplicate) throw exactDuplicate;
      throw new Error(duplicateExpenseMessage(error) || error.message || "تعذر حفظ المصروف");
    }
    if (!data?.id) throw new Error("تعذر تأكيد حفظ المصروف في Supabase");
    const saved = rowToRecord(data);
    deletedExpenseIds.delete(saved.id);
    cache = [saved, ...cache.filter((e) => e.id !== saved.id)];
    markCacheChanged();
    persistLocal();
    notify();
    invalidateExpenseConsumers();
    return saved;
  },
  async update(id: string, patch: Partial<ExpenseRecord>) {
    ensureExpenseStoreSessionWatcher();
    if (!isUuid(id)) throw new Error("expense_id غير صالح للحفظ في Supabase");
    const idx = cache.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("المصروف غير موجود في القائمة الحالية");
    const next = { ...cache[idx], ...patch };
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
    const row = recordToRow(next, tenantId);
    const duplicates = await checkExpenseDuplicates({
      supplier_id: row.supplier_id,
      supplier_tax_number: row.supplier_tax_number,
      beneficiary: row.beneficiary,
      supplier_invoice_number: row.supplier_invoice_number,
      date: row.date,
      total: row.total,
      work_order_id: row.work_order_id,
      linked_work_order_id: row.linked_work_order_id,
      description: row.description,
      duplicate_batch_id: next.duplicateBatchId,
      document_sha256: row.document_sha256,
    }, id);
    if (duplicates.exact.length) throw new ExpenseExactDuplicateError(duplicates.exact);
    if (duplicates.potential.length && !next.duplicateOverrideReason) {
      throw new ExpensePotentialDuplicateError(duplicates.potential);
    }
    // Remove tenant_id from update payload to avoid changing it.
    const { tenant_id, id: _id, ...updatable } = row as any;
    let { data, error } = await supabase
      .from("expenses")
      .update(updatable)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select("*")
      .single();
    if (error && isMissingAccountingColumnError(error)) {
      const retry = await (supabase.from("expenses") as any)
        .update(stripExpenseAccountingColumns(updatable))
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      const exactDuplicate = exactDuplicateErrorFromDatabase(error);
      if (exactDuplicate) throw exactDuplicate;
      throw new Error(duplicateExpenseMessage(error) || error.message || "تعذر تحديث المصروف");
    }
    if (!data?.id) throw new Error("تعذر تأكيد تحديث المصروف في Supabase");
    cache[idx] = rowToRecord(data);
    deletedExpenseIds.delete(id);
    markCacheChanged();
    persistLocal();
    notify();
    invalidateExpenseConsumers();
    return cache[idx];
  },
  async remove(id: string): Promise<ExpenseRecord | undefined> {
    ensureExpenseStoreSessionWatcher();
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
      deletedExpenseIds.add(id);
      markCacheChanged();
      persistLocal();
      notify();
      invalidateExpenseConsumers();
    } catch (e) {
      console.warn("[expensesStore.remove] failed", e);
      throw e;
    }
    return removed;
  },
  restore(item: ExpenseRecord) {
    ensureExpenseStoreSessionWatcher();
    if (cache.some((e) => e.id === item.id)) return;
    deletedExpenseIds.delete(item.id);
    cache = [item, ...cache];
    markCacheChanged();
    persistLocal();
    notify();
    invalidateExpenseConsumers();
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
    ensureExpenseStoreSessionWatcher();
    listeners.add(cb);
    if (!hydrated && !hydrationPromise) void hydrateFromCloud();
    return () => listeners.delete(cb);
  },
  isHydrated() {
    return hydrated;
  },
  refresh() {
    ensureExpenseStoreSessionWatcher();
    return hydrateFromCloud();
  },
};

export interface WorkOrderExpenseIdentity {
  id?: string | null;
  cloudId?: string | null;
  displayNumber?: string | null;
}

export function getWorkOrderExpenseReferences(workOrder: string | WorkOrderExpenseIdentity): string[] {
  const raw = typeof workOrder === "string"
    ? [workOrder]
    : [workOrder.cloudId, workOrder.id, workOrder.displayNumber];
  return Array.from(new Set(raw.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function expenseBelongsToWorkOrder(expense: ExpenseRecord, workOrder: string | WorkOrderExpenseIdentity): boolean {
  const refs = new Set(getWorkOrderExpenseReferences(workOrder));
  return [expense.canonicalWorkOrderId, expense.linkedWorkOrderId, expense.sourceWorkOrderId]
    .map((value) => String(value || "").trim())
    .some((value) => value.length > 0 && refs.has(value));
}

export function getExpensesForWorkOrder(workOrder: string | WorkOrderExpenseIdentity): ExpenseRecord[] {
  return expensesStore
    .getAll()
    .filter((expense) => expenseBelongsToWorkOrder(expense, workOrder) && !expense.deletedAt && !expense.archivedAt)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function getExpensesTotalForWorkOrder(workOrder: string | WorkOrderExpenseIdentity): number {
  return getExpensesForWorkOrder(workOrder).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function getExpensesForClaim(claimId: string): ExpenseRecord[] {
  return expensesStore
    .getAll()
    .filter((e) => (e.claimId === claimId || e.sourceClaimId === claimId) && !e.deletedAt && !e.archivedAt)
    .sort((a, b) => b.date.localeCompare(a.date));
}
