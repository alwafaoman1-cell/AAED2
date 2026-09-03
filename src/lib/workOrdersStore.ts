import { classifyWorkOrderCosts, type ClaimApprovalMode, type ClaimApprovalInfo } from "@/lib/workOrderCosting";
import { addUnifiedVehicleMedia, upsertUnifiedOperationalState } from "@/lib/claimWorkOrderUnified";
import { extractWorkOrderNumber, isSupportedWorkOrderNumber, normalizeWorkOrderNumber } from "@/lib/workOrderNumber";
import { buildWorkOrderActualCostMap, type WorkOrderExpenseCostRow } from "@/lib/workOrderActualCosts";

// Shared in-memory store for Work Orders so other modules (Inspection) can read & sync them.
// This is a temporary client-side store until backend wiring is added.

export type StagePhase = "received" | "inspection" | "in_progress" | "quality" | "delivery";

export interface StagePhoto {
  id: string;
  phase: StagePhase;
  /** Public URL (signed Storage URL) OR legacy base64 data URL kept for backward compatibility. */
  dataUrl: string;
  /** When the photo is stored in Supabase Storage, the path inside the `work-order-photos` bucket. */
  storagePath?: string;
  caption?: string;
  uploadedAt: string;
}

export interface ExtraExpense {
  id: string;
  label: string;
  amount: number;
  notes?: string;
}

/** حالة القطعة المطلوبة في طلب الشراء الداخلي */
export type NeededPartStatus = "pending" | "ordered" | "secured" | "received";

export const NEEDED_PART_STATUS_LABELS: Record<NeededPartStatus, string> = {
  pending: "بانتظار",
  ordered: "قيد الطلب",
  secured: "مؤمّنة",
  received: "تم الاستلام",
};

export interface NeededPart {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
  estimatedUnitPrice?: number;
  convertedToExpense?: boolean;
  convertedExpenseId?: string;
  convertedAt?: string;
  /** الحالة التفصيلية للقطعة */
  status?: NeededPartStatus;
  /** متروكة للتوافق الخلفي — تعتبر true عندما status === "received" أو "secured" */
  fulfilled?: boolean;
}

/** هل القطعة لا تزال مطلوبة (لم تُستلم ولم تُؤمّن) */
export function isPartStillNeeded(p: NeededPart): boolean {
  if (p.status) return p.status !== "received" && p.status !== "secured";
  return !p.fulfilled;
}

export interface WorkOrder {
  id: string;
  /** UUID الداخلي في Supabase. لا يُستخدم في الروابط العامة. */
  cloudId?: string;
  /** رقم عرض احترافي للأمر (مثل WO-00012). إن لم يُحدّد يُستخدم id كرقم. */
  displayNumber?: string;
  workOrderType?: import("@/lib/workOrderType").WorkOrderType;
  claimId?: string;
  trackingToken?: string;
  vehicleId?: string;
  parentWorkOrderId?: string;
  parentOrderNumber?: string;
  visitNumber?: number;
  visitType?: "new_visit" | "supplement" | "return";
  returnReason?: string;
  vehicleImageUrl?: string;
  vehicleThumbnailUrl?: string;
  trackingExpiresAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  customer: string;
  phone: string;
  plate: string;
  vehicleType: string;
  model: string;
  year: string;
  vin: string;
  color?: string;
  mileage?: string;
  insurance: string;
  claimNumber: string;
  entryDate: string;
  technician: string;
  serviceType: string;
  status: string;
  totalCost: number;
  /** Actual linked expense vouchers including recorded VAT. */
  actualExpenseCost?: number;
  description?: string;
  diagnosis?: string;
  laborCost?: number;
  partsCost?: number;
  insuranceApprovedAmount?: number;
  insuranceApprovalMode?: ClaimApprovalMode;
  lumpSumNotItemized?: boolean;
  paintMaterialsCost?: number;
  photos?: StagePhoto[];
  /** مصروفات إضافية داخلية (سحب، نقل، صبغ خارجي...) تُحتسب في الإجمالي */
  extraExpenses?: ExtraExpense[];
  /** أرقام سندات الصرف الخارجية المرتبطة بهذا الأمر */
  linkedExpenseVoucherIds?: string[];
  /** مبلغ العربون المخصوم من الفاتورة النهائية */
  depositApplied?: number;
  /** قائمة قطع الغيار المطلوبة (طلب شراء داخلي) */
  partsNeeded?: NeededPart[];
  /** كلمة مرور مخصصة لصفحة تتبع العميل العامة (اختياري — الافتراضي رقم هاتف العميل) */
  trackPassword?: string;
  /** بيانات استلام المركبة */
  odometerKm?: number;
  fuelLevelPct?: number;
  receptionNotes?: string;
  receptionDamageMarkers?: import("@/components/inspection/VehicleDiagram").DamageMarker[];
  receptionSignatureDataUrl?: string;
  vehicleBelongings?: Record<string, boolean | string>;
  receivedAt?: string;
  /** بنود الأعمال المطلوبة من العميل (تظهر له في رابط التوقيع) */
  workItems?: WorkItem[];
  /** معرّف العميل الفعلي في customersStore (مرجع موحّد). */
  customerId?: string;
  vehicleOwnerCustomerId?: string;
  customerRelationshipToVehicle?: string;
  customerRelationshipNote?: string;
  receivedFromCustomerId?: string;
  closingReview?: {
    status: string;
    finalCostSource: "Actual Expenses" | "Estimate Only" | "Manual Final Cost";
    snapshot: Record<string, number | string | boolean | null>;
    invoiceSkipped?: boolean;
    skipInvoiceReason?: string;
    manualReason?: string;
    approvedByRole?: string;
    approvedAt: string;
  };
}

export interface WorkItem {
  id: string;
  title: string;
  note?: string;
}

export const STAGE_LABELS: Record<StagePhase, { ar: string; en: string }> = {
  received: { ar: "استلام", en: "Received" },
  inspection: { ar: "فحص", en: "Inspection" },
  in_progress: { ar: "تحت الإصلاح", en: "In Progress" },
  quality: { ar: "ضبط الجودة", en: "Quality Check" },
  delivery: { ar: "تسليم", en: "Delivery" },
};

export const WORK_ORDER_STATUSES = [
  "تحت الفحص",
  "بانتظار الموافقة",
  "بانتظار قطع الغيار",
  "تحت الإصلاح",
  "ضبط الجودة",
  "جاهز للتسليم",
  "تم التسليم",
  "مغلق",
];

const WORK_ORDER_STATUS_MOJIBAKE_FIX: Record<string, string> = {
  "تحت الفحص": "تحت الفحص",
  "بانتظار الموافقة": "بانتظار الموافقة",
  "بانتظار قطع الغيار": "بانتظار قطع الغيار",
  "تحت الإصلاح": "تحت الإصلاح",
  "ضبط الجودة": "ضبط الجودة",
  "جاهز للتسليم": "جاهز للتسليم",
  "تم التسليم": "تم التسليم",
  "مغلق": "مغلق",
};

export function normalizeWorkOrderStatus(status: string | null | undefined): string {
  const raw = String(status || "").trim();
  if (!raw) return "تحت الفحص";
  if (WORK_ORDER_STATUS_MOJIBAKE_FIX[raw]) return WORK_ORDER_STATUS_MOJIBAKE_FIX[raw];
  if (WORK_ORDER_STATUSES.includes(raw)) return raw;
  switch (raw) {
    case "received":
    case "inspection":
      return "تحت الفحص";
    case "waiting_parts":
      return "بانتظار قطع الغيار";
    case "in_progress":
      return "تحت الإصلاح";
    case "completed":
      return "جاهز للتسليم";
    case "delivered":
      return "تم التسليم";
    default:
      return raw;
  }
}

let cache: WorkOrder[] = [];
const listeners = new Set<() => void>();

function load(): WorkOrder[] {
  return cache;
}

function persist() {
  listeners.forEach(l => l());
}

function isActiveWorkOrder(order: WorkOrder): boolean {
  return !order.deletedAt && !order.archivedAt;
}

export function getWorkOrders(options: { includeArchived?: boolean } = {}): WorkOrder[] {
  // الأحدث أولاً: حسب تاريخ الدخول ثم رقم العرض.
  return load().filter((order) => (options.includeArchived ? !order.deletedAt : isActiveWorkOrder(order))).sort((a, b) => {
    const da = (a.entryDate || "").localeCompare(b.entryDate || "");
    if (da !== 0) return -da;
    return (b.id || "").localeCompare(a.id || "");
  });
}

export function getWorkOrderById(id: string): WorkOrder | undefined {
  if (!id) return undefined;
  const raw = String(id).trim();
  if (!raw) return undefined;
  const list = load();
  // 1) Exact id match
  let found = list.find(o => o.id === raw || o.cloudId === raw);
  if (found) return found;
  // 2) Case-insensitive id / displayNumber match
  const lower = raw.toLowerCase();
  found = list.find(o =>
    o.id?.toLowerCase() === lower ||
    o.cloudId?.toLowerCase() === lower ||
    o.displayNumber?.toLowerCase() === lower
  );
  if (found) return found;
  // 3) Extract current or legacy visible number from a URL/longer string.
  const code = extractWorkOrderNumber(raw);
  if (code) {
    found = list.find(o => o.id?.toUpperCase() === code || o.displayNumber?.toUpperCase() === code);
    if (found) return found;
  }
  // 4) Extract trailing UUID/segment from URL path
  const seg = raw.split(/[/?#]/).filter(Boolean).pop();
  if (seg && seg !== raw) {
    return getWorkOrderById(seg);
  }
  return undefined;
}

function findWorkOrderIndex(id: string): number {
  if (!id) return -1;
  const raw = String(id).trim();
  if (!raw) return -1;
  const lower = raw.toLowerCase();
  const list = load();
  let idx = list.findIndex(o => o.id === raw || o.cloudId === raw || o.displayNumber === raw);
  if (idx >= 0) return idx;
  idx = list.findIndex(o =>
    o.id?.toLowerCase() === lower ||
    o.cloudId?.toLowerCase() === lower ||
    o.displayNumber?.toLowerCase() === lower
  );
  if (idx >= 0) return idx;
  const code = extractWorkOrderNumber(raw);
  if (code) {
    idx = list.findIndex(o => o.id?.toUpperCase() === code || o.displayNumber?.toUpperCase() === code);
    if (idx >= 0) return idx;
  }
  const seg = raw.split(/[/?#]/).filter(Boolean).pop();
  if (seg && seg !== raw) return findWorkOrderIndex(seg);
  return -1;
}

export function upsertWorkOrderInCache(order: WorkOrder): WorkOrder {
  const list = load();
  const idx = list.findIndex((o) =>
    (order.cloudId && o.cloudId === order.cloudId) ||
    (order.id && o.id === order.id) ||
    (order.displayNumber && o.displayNumber === order.displayNumber)
  );
  if (idx >= 0) list[idx] = { ...list[idx], ...order };
  else list.unshift(order);
  KNOWN_CLOUD_NUMBERS.add(order.id);
  persist();
  return idx >= 0 ? list[idx] : order;
}

export function updateWorkOrder(id: string, patch: Partial<WorkOrder>) {
  const list = load();
  const idx = findWorkOrderIndex(id);
  if (idx >= 0) {
    const normalizedPatch = { ...patch };
    if (patch.status !== undefined) normalizedPatch.status = normalizeWorkOrderStatus(patch.status);
    if (patch.status !== undefined && isClosedWorkOrderStatus(patch.status) && patch.archivedAt === undefined) {
      normalizedPatch.archivedAt = list[idx].archivedAt || new Date().toISOString();
    }
    list[idx] = { ...list[idx], ...normalizedPatch };
    persist();
    // Preserve the legacy imperative API without relying on a global cache
    // diff. Cloud refetches and auth cache clears are not user edits.
    pushPatchToCloud(list[idx].id, normalizedPatch);
  }
}

// ===== Needed Parts direct helpers (independent additions/edits) =====
const neededPartsWriteQueue = new Map<string, Promise<WorkOrder>>();

function discardPendingNeededPartsPatch(orderNumber: string) {
  const pending = _pendingPatches.get(orderNumber);
  if (!pending || pending.partsNeeded === undefined) return;
  const { partsNeeded: _discarded, ...remaining } = pending;
  if (Object.keys(remaining).length) {
    _pendingPatches.set(orderNumber, remaining);
  } else {
    _pendingPatches.delete(orderNumber);
    const timer = _patchTimers.get(orderNumber);
    if (timer) clearTimeout(timer);
    _patchTimers.delete(orderNumber);
  }
}

function queueNeededPartsCloudSave(order: WorkOrder, partsNeeded: NeededPart[]): Promise<WorkOrder> {
  const key = order.cloudId || order.id;
  discardPendingNeededPartsPatch(order.id);
  const previous = neededPartsWriteQueue.get(key);
  const write = (previous ? previous.catch(() => order) : Promise.resolve(order))
    .then(() => {
      const latest = getWorkOrderById(order.cloudId || "") || getWorkOrderById(order.id) || order;
      return saveNeededPartsToCloud(latest, partsNeeded);
    });
  neededPartsWriteQueue.set(key, write);
  void write.finally(() => {
    if (neededPartsWriteQueue.get(key) === write) neededPartsWriteQueue.delete(key);
  }).catch(() => undefined);
  return write;
}

export async function addNeededPartToOrder(orderId: string, part: Omit<NeededPart, "id"> & { id?: string }): Promise<NeededPart | null> {
  const list = load();
  const idx = findWorkOrderIndex(orderId);
  if (idx < 0) return null;
  const originalOrder = list[idx];
  const newPart: NeededPart = {
    id: part.id || `NP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: part.name || "",
    quantity: Math.max(1, Number(part.quantity) || 1),
    notes: part.notes,
    status: part.status || "pending",
    fulfilled: part.status === "received" || part.status === "secured" || !!part.fulfilled,
  };
  const partsNeeded = [...(list[idx].partsNeeded || []), newPart];
  list[idx] = { ...list[idx], partsNeeded };
  persist();
  if (!KNOWN_CLOUD_NUMBERS.has(list[idx].id)) return newPart;
  try {
    await queueNeededPartsCloudSave(list[idx], partsNeeded);
    return newPart;
  } catch (error) {
    const rollbackIdx = findWorkOrderIndex(orderId);
    if (rollbackIdx >= 0) {
      cache[rollbackIdx] = originalOrder;
      persist();
    }
    throw error;
  }
}

export function normalizeNeededPartNameForMatch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export async function addNeededPartsBulkToOrder(
  orderId: string,
  names: string[],
): Promise<{ added: NeededPart[]; skipped: string[]; order: WorkOrder }> {
  const list = load();
  let idx = findWorkOrderIndex(orderId);
  if (idx < 0) {
    await fetchWorkOrderFromCloudByIdentifier(orderId).catch(() => null);
    idx = findWorkOrderIndex(orderId);
  }
  if (idx < 0) throw new Error("أمر العمل غير موجود");

  const existing = new Set(
    (list[idx].partsNeeded || [])
      .map((p) => normalizeNeededPartNameForMatch(p.name))
      .filter(Boolean),
  );
  const seenInInput = new Set<string>();
  const added: NeededPart[] = [];
  const skipped: string[] = [];

  for (const rawName of names) {
    const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = normalizeNeededPartNameForMatch(name);
    if (!key || existing.has(key) || seenInInput.has(key)) {
      skipped.push(name);
      continue;
    }
    seenInInput.add(key);
    added.push({
      id: `NP-${Date.now()}-${added.length}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      quantity: 1,
      status: "pending",
      fulfilled: false,
    });
  }

  if (!added.length) {
    return { added, skipped, order: list[idx] };
  }

  const originalOrder = list[idx];
  const partsNeeded = [...(list[idx].partsNeeded || []), ...added];
  const updatedOrder = { ...list[idx], partsNeeded };
  list[idx] = updatedOrder;
  persist();

  if (KNOWN_CLOUD_NUMBERS.has(updatedOrder.id)) {
    try {
      const saved = await queueNeededPartsCloudSave(updatedOrder, partsNeeded);
      return { added, skipped, order: saved };
    } catch (error) {
      const rollbackList = load();
      const rollbackIdx = findWorkOrderIndex(orderId);
      if (rollbackIdx >= 0) {
        rollbackList[rollbackIdx] = originalOrder;
        cache = rollbackList;
        persist();
      }
      throw error;
    }
  }

  return { added, skipped, order: updatedOrder };
}

export async function updateNeededPartInOrder(orderId: string, partId: string, patch: Partial<NeededPart>): Promise<WorkOrder | null> {
  const list = load();
  const idx = findWorkOrderIndex(orderId);
  if (idx < 0) return null;
  const originalOrder = list[idx];
  const parts = (list[idx].partsNeeded || []).map(p => {
    if (p.id !== partId) return p;
    const merged = { ...p, ...patch };
    if (patch.status !== undefined) {
      merged.fulfilled = patch.status === "received" || patch.status === "secured";
    }
    return merged;
  });
  list[idx] = { ...list[idx], partsNeeded: parts };
  persist();
  if (!KNOWN_CLOUD_NUMBERS.has(list[idx].id) && !isUuid(list[idx].cloudId || "")) return list[idx];
  try {
    return await queueNeededPartsCloudSave(list[idx], parts);
  } catch (error) {
    const rollbackIdx = findWorkOrderIndex(orderId);
    if (rollbackIdx >= 0) {
      cache[rollbackIdx] = originalOrder;
      persist();
    }
    throw error;
  }
}

export async function removeNeededPartFromOrder(orderId: string, partId: string): Promise<boolean> {
  let list = load();
  let idx = findWorkOrderIndex(orderId);
  if (idx < 0) {
    await fetchWorkOrderFromCloudByIdentifier(orderId).catch(() => null);
    list = load();
    idx = findWorkOrderIndex(orderId);
  }
  if (idx < 0) throw new Error("أمر العمل غير موجود");
  const originalOrder = list[idx];
  const existed = (list[idx].partsNeeded || []).some((part) => part.id === partId);
  if (!existed) return true;
  const partsNeeded = (list[idx].partsNeeded || []).filter(p => p.id !== partId);
  list[idx] = { ...list[idx], partsNeeded };
  persist();
  if (!KNOWN_CLOUD_NUMBERS.has(list[idx].id) && !isUuid(list[idx].cloudId || "")) return true;
  try {
    const saved = await queueNeededPartsCloudSave(list[idx], partsNeeded);
    if ((saved.partsNeeded || []).some((part) => part.id === partId)) {
      throw new Error("تعذر تأكيد حذف القطعة من Supabase");
    }
    return true;
  } catch (error) {
    const rollbackIdx = findWorkOrderIndex(orderId);
    if (rollbackIdx >= 0) {
      cache[rollbackIdx] = originalOrder;
      persist();
    }
    throw error;
  }
}

export function addWorkOrder(order: WorkOrder) {
  const list = load();
  list.unshift(order);
  persist();
  // Legacy callers still get an explicit cloud write. Cache hydration never
  // passes through this function and therefore cannot create/delete records.
  void pushOrderToCloud(order);
}

export function deleteWorkOrder(id: string): WorkOrder | undefined {
  const list = load();
  const idx = list.findIndex(o => o.id === id);
  if (idx === -1) return undefined;
  const [removed] = list.splice(idx, 1);
  persist();
  return removed;
}

export function restoreWorkOrder(order: WorkOrder) {
  const list = load();
  if (list.some(o => o.id === order.id)) return;
  list.unshift(order);
  persist();
}

/** يفرض جلب أحدث أوامر العمل من السحابة الآن (يُستخدم في زر التحديث اليدوي). */

export async function restoreWorkOrderFromTrash(order: WorkOrder): Promise<WorkOrder> {
  const ctx = await tenantContext();
  if (!ctx) throw new Error("Tenant was not loaded. Please refresh and try again.");
  const restoreStartedAt = new Date(Date.now() - 60_000).toISOString();
  const orderNumber = order.displayNumber || order.id;
  const expectedOrderNumber = /^WO-/i.test(orderNumber || "") ? orderNumber : null;
  let foundId: string | null = null;

  if (expectedOrderNumber) {
    const { data, error } = await supabase
      .from("job_orders")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("order_number", expectedOrderNumber)
      .maybeSingle();
    if (error) throw error;
    foundId = data?.id || null;
  }

  if (!foundId && order.cloudId && isUuid(order.cloudId)) {
    const { data, error } = await supabase
      .from("job_orders")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", order.cloudId)
      .maybeSingle();
    if (error) throw error;
    foundId = data?.id || null;
  }

  if (!foundId && orderNumber) {
    const { data, error } = await supabase
      .from("job_orders")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw error;
    foundId = data?.id || null;
  }

  if (!foundId) throw new Error("Work order was not found in Supabase");

  let { data, error } = await (supabase.from("job_orders") as any)
    .update({ deleted_at: null, archived_at: null, deleted_by: null })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", foundId)
    .select("*")
    .maybeSingle();

  if (error && isMissingJobOrderColumnError(error)) {
    ({ data, error } = await (supabase.from("job_orders") as any)
      .update({ archived_at: null })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", foundId)
      .select("*")
      .maybeSingle());
  }
  if (error) throw error;
  if (!data?.id) throw new Error("Restore did not return a work order from Supabase");
  if (expectedOrderNumber && data.order_number && data.order_number !== expectedOrderNumber) {
    const archivedAt = new Date().toISOString();
    await (supabase.from("job_orders") as any)
      .update({ deleted_at: archivedAt, archived_at: archivedAt })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", foundId);
    throw new Error(`Trash restore mismatch: expected ${expectedOrderNumber}, got ${data.order_number}. Please refresh the trash and try again.`);
  }

  const { data: verified, error: verifyError } = await supabase
    .from("job_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", foundId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (!verified?.id) throw new Error("Work order restore was not visible after verification");
  if (expectedOrderNumber && verified.order_number && verified.order_number !== expectedOrderNumber) {
    const archivedAt = new Date().toISOString();
    await (supabase.from("job_orders") as any)
      .update({ deleted_at: archivedAt, archived_at: archivedAt })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", foundId);
    throw new Error(`Trash restore mismatch: expected ${expectedOrderNumber}, got ${verified.order_number}. Please refresh the trash and try again.`);
  }
  if (expectedOrderNumber && (verified as any).customer_id && (verified as any).vehicle_id) {
    const archivedAt = new Date().toISOString();
    await (supabase.from("job_orders") as any)
      .update({ deleted_at: archivedAt, archived_at: archivedAt })
      .eq("tenant_id", ctx.tenantId)
      .eq("customer_id", (verified as any).customer_id)
      .eq("vehicle_id", (verified as any).vehicle_id)
      .neq("order_number", expectedOrderNumber)
      .gte("created_at", restoreStartedAt);
  }

  const saved = await mapSavedJobOrder(verified);
  cache = cache.filter((o) => o.id !== saved.id && o.cloudId !== saved.cloudId);
  cache.unshift(saved);
  persist();
  return saved;
}

export async function refreshWorkOrdersFromCloud(): Promise<void> {
  ensureCloudSync();
  await fetchFromCloud({ throwOnError: true });
}

export function subscribeWorkOrders(cb: () => void): () => void {

  // Ensure cloud sync is bootstrapped the first time anyone subscribes.
  ensureCloudSync();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ============================================================
// ☁️  Cloud source layer — keeps the in-memory view fresh from
// Supabase `job_orders` and propagates changes via realtime so
// every device shows the same data within seconds.
// ============================================================
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { isUuid } from "@/lib/uuid";
import { customersStore } from "@/lib/customersStore";
import { sanitizeWorkOrderWritePayload } from "@/lib/supabasePayload";


function cloudStatusToLocal(s: string | null | undefined): string {
  switch (s) {
    case "delivered": return "تم التسليم";
    case "completed": return "جاهز للتسليم";
    case "in_progress": return "تحت الإصلاح";
    case "waiting_parts": return "بانتظار قطع الغيار";
    case "inspection": return "تحت الفحص";
    case "received":
    default: return normalizeWorkOrderStatus(s);
  }
}
function localStatusToCloud(s: string | undefined): string {
  const n = normalizeWorkOrderStatus(s);
  if (["مغلق", "تم التسليم"].includes(n)) return "delivered";
  if (["جاهز للتسليم", "ضبط الجودة"].includes(n)) return "completed";
  if (["تحت الإصلاح"].includes(n)) return "in_progress";
  if (["بانتظار قطع الغيار", "بانتظار الموافقة"].includes(n)) return "waiting_parts";
  if (["تحت الفحص"].includes(n)) return "inspection";
  return "received";
}

function isClosedWorkOrderStatus(status: string | undefined): boolean {
  const local = normalizeWorkOrderStatus(status);
  return ["مغلق", "تم التسليم"].includes(local) || localStatusToCloud(local) === "delivered";
}

const LEGACY_METADATA_KEY = "__aaedMetadata";
const LEGACY_RECEPTION_DAMAGE_KEY = "__aaedReceptionDamageMarkers";
const LEGACY_RECEPTION_SIGNATURE_KEY = "__aaedReceptionSignatureDataUrl";
const INTERNAL_BELONGING_KEYS = new Set([
  LEGACY_METADATA_KEY,
  LEGACY_RECEPTION_DAMAGE_KEY,
  LEGACY_RECEPTION_SIGNATURE_KEY,
]);

type CloudRow = any;
function mapCloudRow(
  r: CloudRow,
  custMap: Map<string, { name: string; phone?: string | null }>,
  vehMap: Map<string, { plate?: string | null; brand?: string | null; model?: string | null; year?: number | null; vin?: string | null; color?: string | null; imageUrl?: string | null; thumbnailUrl?: string | null }>,
  claimMap: Map<string, ClaimApprovalInfo> = new Map(),
  actualExpenseCosts: Map<string, number> = new Map(),
): WorkOrder {
  const c = r.customer_id ? custMap.get(r.customer_id) : undefined;
  const v = r.vehicle_id ? vehMap.get(r.vehicle_id) : undefined;
  const belongings =
    r.vehicle_belongings && typeof r.vehicle_belongings === "object" && !Array.isArray(r.vehicle_belongings)
      ? r.vehicle_belongings
      : {};
  const metadata =
    r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
      ? r.metadata
      : belongings[LEGACY_METADATA_KEY] || {};
  const visibleBelongings = Object.fromEntries(
    Object.entries(belongings).filter(([key]) => !INTERNAL_BELONGING_KEYS.has(key)),
  );
  const partsNeeded = Array.isArray(r.parts_needed) ? r.parts_needed : [];
  const workItems = Array.isArray(r.work_items) ? r.work_items : [];
  const costs = classifyWorkOrderCosts({
    laborCost: r.labor_cost,
    partsCost: r.parts_cost,
    finalTotal: r.final_total,
    subtotal: r.subtotal,
    claim: r.claim_id ? claimMap.get(r.claim_id) || null : null,
    partsNeeded,
    workItems,
  });
  return {
    id: r.order_number || r.id,
    cloudId: r.id,
    displayNumber: r.order_number || undefined,
    workOrderType: r.work_order_type || (r.claim_id ? "insurance" : "general_customer"),
    claimId: r.claim_id || undefined,
    trackingToken: r.tracking_token || undefined,
    customerId: r.customer_id || undefined,
    vehicleId: r.vehicle_id || undefined,
    vehicleOwnerCustomerId: r.vehicle_owner_customer_id || metadata?.vehicleOwnerCustomerId || undefined,
    customerRelationshipToVehicle: r.customer_relationship_to_vehicle || metadata?.customerRelationshipToVehicle || undefined,
    customerRelationshipNote: r.customer_relationship_note || metadata?.customerRelationshipNote || undefined,
    receivedFromCustomerId: r.received_from_customer_id || metadata?.receivedFromCustomerId || undefined,
    parentWorkOrderId: r.parent_work_order_id || metadata?.parentWorkOrderId || undefined,
    parentOrderNumber: metadata?.parentOrderNumber || undefined,
    visitNumber: r.visit_number || metadata?.visitNumber || undefined,
    visitType: r.visit_type || metadata?.visitType || undefined,
    returnReason: r.return_reason || metadata?.returnReason || undefined,
    vehicleImageUrl: v?.imageUrl || undefined,
    vehicleThumbnailUrl: v?.thumbnailUrl || undefined,
    trackingExpiresAt: r.tracking_expires_at || undefined,
    archivedAt: r.archived_at || undefined,
    deletedAt: r.deleted_at || undefined,
    customer: c?.name || "",
    phone: c?.phone || "",
    plate: v?.plate || "",
    vehicleType: v?.brand || "",
    model: v?.model || "",
    year: v?.year ? String(v.year) : "",
    vin: v?.vin || "",
    color: v?.color || undefined,
    insurance: r.insurance_company || "-",
    claimNumber: r.insurance_claim_number || "-",
    entryDate: (r.entry_date || (r.created_at || "").slice(0, 10)) as string,
    technician: r.technician_name || "",
    serviceType: r.service_type || "صيانة",
    status: cloudStatusToLocal(r.status),
    totalCost: costs.totalCost,
    actualExpenseCost: actualExpenseCosts.get(r.id) || 0,
    description: r.description || undefined,
    diagnosis: r.diagnosis || r.diagnosis_notes || undefined,
    laborCost: costs.laborCost,
    partsCost: costs.partsCost,
    insuranceApprovedAmount: costs.insuranceApprovedAmount,
    insuranceApprovalMode: costs.insuranceApprovalMode,
    lumpSumNotItemized: costs.lumpSumNotItemized,
    paintMaterialsCost: costs.paintMaterialsCost,
    photos: Array.isArray(r.photos) ? r.photos : [],
    partsNeeded,
    workItems,
    extraExpenses: Array.isArray(metadata?.extraExpenses) ? metadata.extraExpenses : [],
    linkedExpenseVoucherIds: Array.isArray(metadata?.linkedExpenseVoucherIds) ? metadata.linkedExpenseVoucherIds : [],
    depositApplied: Number(metadata?.depositApplied || 0),
    closingReview: r.metadata?.closingReview || metadata?.closingReview || undefined,
    trackPassword: metadata?.trackPassword || undefined,
    mileage: metadata?.mileage || undefined,
    odometerKm: r.odometer_km ?? undefined,
    fuelLevelPct: r.fuel_level_pct ?? undefined,
    receptionNotes: r.reception_notes || undefined,
    receptionDamageMarkers: Array.isArray(r.reception_damage_markers)
      ? r.reception_damage_markers
      : Array.isArray(belongings[LEGACY_RECEPTION_DAMAGE_KEY])
        ? belongings[LEGACY_RECEPTION_DAMAGE_KEY]
        : [],
    receptionSignatureDataUrl: r.reception_signature_data_url || belongings[LEGACY_RECEPTION_SIGNATURE_KEY] || undefined,
    vehicleBelongings: Object.keys(visibleBelongings).length ? (visibleBelongings as WorkOrder["vehicleBelongings"]) : undefined,
    receivedAt: r.received_at || undefined,
  };
}

let cloudBootstrapped = false;
let cloudFetchTimer: ReturnType<typeof setTimeout> | null = null;
let cloudFetchInFlight: Promise<void> | null = null;
let lastCloudFetchFailureAt = 0;
const KNOWN_CLOUD_NUMBERS = new Set<string>();
const CLOUD_FETCH_FAILURE_COOLDOWN_MS = 15_000;

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function fetchActualExpenseCostsForOrders(tenantId: string, rows: CloudRow[]): Promise<Map<string, number>> {
  if (!tenantId || rows.length === 0) return new Map();
  const ids = Array.from(new Set(rows.map((row) => String(row.id || "").trim()).filter(Boolean)));
  const numbers = Array.from(new Set(rows.map((row) => String(row.order_number || "").trim()).filter(Boolean)));
  const requests: PromiseLike<any>[] = [];
  const select = "id,work_order_id,linked_work_order_id,amount,total,status";

  for (const batch of chunks(ids)) {
    requests.push((supabase.from("expenses") as any)
      .select(select)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .in("work_order_id", batch));
  }
  const legacyLinkedIds = ids.map((id) => `WO-${id}`);
  for (const batch of chunks([...ids, ...legacyLinkedIds, ...numbers])) {
    requests.push((supabase.from("expenses") as any)
      .select(select)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .in("linked_work_order_id", batch));
  }

  const results = await Promise.all(requests);
  const expenses: WorkOrderExpenseCostRow[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    expenses.push(...(result.data || []));
  }
  return buildWorkOrderActualCostMap(rows, expenses);
}

async function fetchFromCloud(options: { throwOnError?: boolean } = {}): Promise<void> {
  if (!options.throwOnError && Date.now() - lastCloudFetchFailureAt < CLOUD_FETCH_FAILURE_COOLDOWN_MS) return;
  if (cloudFetchInFlight) return cloudFetchInFlight;

  cloudFetchInFlight = (async () => {
  try {
    let activeUserId: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      activeUserId = sessionData.session?.user?.id;
      if (activeUserId) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!activeUserId) {
      if (options.throwOnError) throw new Error("جلسة الدخول غير جاهزة بعد. أعد المحاولة خلال لحظات.");
      return;
    }
    const tenantId = await getCurrentTenantId();
    if (!tenantId) throw new Error("تعذّر تحديد المؤسسة عند احتساب تكاليف أوامر العمل");

    let ordersResult = await supabase
      .from("job_orders")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (ordersResult.error && isMissingJobOrderColumnError(ordersResult.error)) {
      ordersResult = await supabase
        .from("job_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
    }
    if (ordersResult.error) throw ordersResult.error;
    const rows = ordersResult.data || [];

    const customerIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean)));
    const vehicleIds = Array.from(new Set(rows.map((r: any) => r.vehicle_id).filter(Boolean)));
    const claimIds = Array.from(new Set(rows.map((r: any) => r.claim_id).filter(Boolean)));
    const customerQuery = customerIds.length
      ? supabase.from("customers").select("id,name,phone").in("id", customerIds).limit(10000)
      : Promise.resolve({ data: [], error: null } as any);
    let vehicleQuery: any = vehicleIds.length
      ? await supabase
        .from("vehicles")
        .select("id,plate_number,plate_letters,brand,model,year,vin,vin_number,color,vehicle_cover_image_url,vehicle_thumbnail_url")
        .in("id", vehicleIds)
        .limit(10000)
      : { data: [], error: null };
    if (vehicleIds.length && vehicleQuery.error && isMissingOptionalColumnError(vehicleQuery.error)) {
      vehicleQuery = await supabase
        .from("vehicles")
        .select("id,plate_number,plate_letters,brand,model,year,vin,vin_number,color")
        .in("id", vehicleIds)
        .limit(10000);
    }
    const claimQuery = claimIds.length
      ? supabase
        .from("insurance_claims")
        .select("id,approved_amount,estimated_amount,estimation_type")
        .in("id", claimIds)
        .limit(10000)
      : Promise.resolve({ data: [], error: null } as any);
    const expenseCostsQuery = fetchActualExpenseCostsForOrders(tenantId, rows)
      .catch((error) => {
        console.warn("[workOrdersStore] actual expense costs lookup skipped:", error);
        return new Map<string, number>();
      });
    const [
      { data: custs, error: custError },
      { data: vehs, error: vehError },
      { data: claims, error: claimError },
      actualExpenseCosts,
    ] = await Promise.all([
      customerQuery,
      Promise.resolve(vehicleQuery),
      claimQuery,
      expenseCostsQuery,
    ]);
    if (custError) {
      // Customer names/phones are display metadata. A temporary RLS/schema issue
      // on customers must not make all job_orders disappear from the work-orders
      // list or detail route.
      console.warn("[workOrdersStore] customer metadata lookup skipped:", custError);
    }
    if (vehError) {
      // Vehicle metadata is optional for rendering the list; keep the core order
      // visible and let the detail page show missing vehicle fields gracefully.
      console.warn("[workOrdersStore] vehicle metadata lookup skipped:", vehError);
    }
    if (claimError) {
      // Claim financial metadata is optional for the list view.  A schema/RLS
      // issue on insurance_claims must not hide existing job_orders from the
      // work-orders list; details can still load the order itself.
      console.warn("[workOrdersStore] claim metadata lookup skipped:", claimError);
    }


    const custMap = new Map<string, any>();
    (custError ? [] : custs || []).forEach((c: any) => custMap.set(c.id, { name: c.name, phone: c.phone }));
    const vehMap = new Map<string, any>();
    (vehError ? [] : vehs || []).forEach((v: any) => vehMap.set(v.id, {
      plate: [v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim(),
      brand: v.brand,
      model: v.model,
      year: v.year,
      vin: v.vin_number || v.vin,
      color: v.color,
      imageUrl: v.vehicle_cover_image_url,
      thumbnailUrl: v.vehicle_thumbnail_url,
    }));
    const claimMap = new Map<string, ClaimApprovalInfo>();
    (claimError ? [] : claims || []).forEach((claim: any) => claimMap.set(claim.id, {
      approvedAmount: claim.approved_amount,
      estimatedAmount: claim.estimated_amount,
      estimationType: claim.estimation_type,
    }));

    const cloudOrders: WorkOrder[] = rows.map((r) => {
      const mapped = mapCloudRow(r, custMap, vehMap, claimMap, actualExpenseCosts);
      const pendingPatch = _pendingPatches.get(mapped.id);
      return pendingPatch ? { ...mapped, ...pendingPatch } : mapped;
    });
    KNOWN_CLOUD_NUMBERS.clear();
    cloudOrders.forEach((o) => KNOWN_CLOUD_NUMBERS.add(o.id));

    cache = cloudOrders;
    listeners.forEach((l) => l());
    lastCloudFetchFailureAt = 0;

    // Kick off background migration of legacy base64 photos to Storage (non-blocking).
    setTimeout(() => migrateLegacyPhotosInBackground(cache), 1000);
  } catch (e) {
    lastCloudFetchFailureAt = Date.now();
    console.warn("[workOrdersStore] cloud fetch failed:", e);
    if (options.throwOnError) throw e;
  } finally {
    cloudFetchInFlight = null;
  }
  })();
  return cloudFetchInFlight;
}

let _photoMigrationRunning = false;
async function migrateLegacyPhotosInBackground(orders: WorkOrder[]) {
  if (_photoMigrationRunning) return;
  _photoMigrationRunning = true;
  try {
    const { migrateOrderPhotos, isLegacyDataUrl } = await import("@/lib/workOrderPhotosStorage");
    const candidates = orders.filter((o) => Array.isArray(o.photos) && o.photos.some(isLegacyDataUrl));
    if (candidates.length === 0) return;
    console.info(`[workOrdersStore] migrating photos for ${candidates.length} order(s) to Storage…`);
    for (const o of candidates) {
      const migrated = await migrateOrderPhotos(o.id, o.photos!);
      if (migrated) {
        // Update through the verified cloud save path so all devices get the URLs.
        await updateWorkOrderInCloud(o.id, { photos: migrated });
      }
    }
    console.info(`[workOrdersStore] photo migration complete.`);
  } catch (e) {
    console.warn("[workOrdersStore] photo migration failed", e);
  } finally {
    _photoMigrationRunning = false;
  }
}

function scheduleCloudFetch(delay = 200) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (Date.now() - lastCloudFetchFailureAt < CLOUD_FETCH_FAILURE_COOLDOWN_MS) return;
  if (cloudFetchTimer) clearTimeout(cloudFetchTimer);
  cloudFetchTimer = setTimeout(() => { cloudFetchTimer = null; fetchFromCloud(); }, delay);
}

function ensureCloudSync() {
  if (cloudBootstrapped) return;
  cloudBootstrapped = true;
  // initial fetch + realtime subscription
  scheduleCloudFetch(0);
  // Realtime/focus refresh is handled centrally by useRealtimeSync. Keeping an
  // extra legacy subscription here caused duplicate request storms on dashboard
  // and when returning to the tab.
}

if (typeof window !== "undefined") {
  // ًں”‘ When the auth user changes (login / logout / account switch on the same
  // browser or PWA), wipe the local cache so the previous user's data never
  // leaks into the next user's view, then re-fetch immediately.
  let lastUid: string | null = null;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (uid !== lastUid) {
      lastUid = uid;
      cache = [];
      KNOWN_CLOUD_NUMBERS.clear();
      listeners.forEach((l) => l());
    }
  });
}

// ---------- Cloud writes (best-effort) ----------
// Use the cached tenant_id from createCloudStore.ts so we don't hammer
// supabase.auth.getUser() + profiles lookup on every keystroke (this was the
// #1 source of slow DB time + auth-token "Lock broken" warnings).
async function tenantContext(): Promise<{ tenantId: string } | null> {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return null;
    return { tenantId };
  } catch { return null; }
}

async function ensureCustomer(tenantId: string, name: string, phone?: string): Promise<string | null> {
  void tenantId;
  const n = (name || "").trim();
  if (!n) return null;
  const saved = await customersStore.ensureCloudCustomer({ name: n, phone: phone || "" });
  return saved?.id && isUuid(saved.id) ? saved.id : null;
}

async function ensureVehicle(tenantId: string, customerId: string, o: WorkOrder): Promise<string | null> {
  if (o.vehicleId && isUuid(o.vehicleId)) return o.vehicleId;
  try {
    const { ensureVehicleForCustomer } = await import("@/lib/vehicleIdentity");
    const resolved = await ensureVehicleForCustomer({
      customerId,
      allowDifferentCustomer: true,
      plate: o.plate,
      vin: o.vin,
      make: o.vehicleType,
      model: o.model,
      year: o.year,
      color: o.color,
    });
    return resolved.vehicleId;
  } catch (e) {
    console.warn("[ensureVehicle:identity]", e);
    throw e instanceof Error ? e : new Error("تعذر التحقق من المركبة في Supabase");
  }
}

async function resolveCustomerId(tenantId: string, o: WorkOrder): Promise<string | null> {
  if (o.customerId && isUuid(o.customerId)) {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", o.customerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id;
  }
  return ensureCustomer(tenantId, o.customer, o.phone);
}

async function resolveVehicleId(tenantId: string, customerId: string, o: WorkOrder): Promise<string | null> {
  if (o.vehicleId && isUuid(o.vehicleId)) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id,customer_id")
      .eq("tenant_id", tenantId)
      .eq("id", o.vehicleId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      return data.id;
    }
  }
  return ensureVehicle(tenantId, customerId, { ...o, vehicleId: undefined });
}

async function pushOrderToCloud(o: WorkOrder) {
  try {
    if (KNOWN_CLOUD_NUMBERS.has(o.id)) return; // already on cloud
    const ctx = await tenantContext(); if (!ctx) return;
    const custId = o.customerId && isUuid(o.customerId) ? o.customerId : await ensureCustomer(ctx.tenantId, o.customer, o.phone); if (!custId || !isUuid(custId)) return;
    const vehId = await ensureVehicle(ctx.tenantId, custId, o); if (!vehId) return;
    const payload = buildJobOrderPayload({ ...o, customerId: custId, vehicleId: vehId }, ctx.tenantId, custId, vehId);
    let { error } = await (supabase.from("job_orders") as any).insert(payload);
    if (error && isMissingJobOrderColumnError(error)) {
      ({ error } = await (supabase.from("job_orders") as any).insert(legacyCompatibleJobOrderPayload(payload, o.vehicleBelongings)));
    }
    if (error) console.warn("[pushOrderToCloud]", error);
    else KNOWN_CLOUD_NUMBERS.add(o.id);
  } catch (e) { console.warn("[pushOrderToCloud] exception", e); }
}

function hasTemporaryOperationalId(value: unknown): boolean {
  return /^(CUST|VEH|TEMP|EXP)-/i.test(String(value || "").trim());
}

function assertNoTemporaryOperationalIds(o: WorkOrder) {
  if (hasTemporaryOperationalId(o.id)) throw new Error("order_number مؤقت وغير صالح للحفظ");
  if (hasTemporaryOperationalId(o.customerId)) throw new Error("customer_id مؤقت وغير صالح للحفظ");
  if (hasTemporaryOperationalId(o.vehicleId)) throw new Error("vehicle_id مؤقت وغير صالح للحفظ");
  if (hasTemporaryOperationalId(o.cloudId)) throw new Error("work_order_id مؤقت وغير صالح للحفظ");
}

function jobOrderMetadata(o: WorkOrder) {
  return {
    extraExpenses: o.extraExpenses || [],
    linkedExpenseVoucherIds: o.linkedExpenseVoucherIds || [],
    depositApplied: o.depositApplied || 0,
    closingReview: o.closingReview || null,
    trackPassword: o.trackPassword || null,
    mileage: o.mileage || null,
    parentWorkOrderId: o.parentWorkOrderId || null,
    parentOrderNumber: o.parentOrderNumber || null,
    visitNumber: o.visitNumber || null,
    visitType: o.visitType || null,
    returnReason: o.returnReason || null,
    vehicleOwnerCustomerId: o.vehicleOwnerCustomerId || null,
    customerRelationshipToVehicle: o.customerRelationshipToVehicle || null,
    customerRelationshipNote: o.customerRelationshipNote || null,
    receivedFromCustomerId: o.receivedFromCustomerId || null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function legacyCompatibleJobOrderPayload(
  payload: Record<string, any>,
  baseVehicleBelongings?: WorkOrder["vehicleBelongings"],
) {
  const next = { ...payload };
  const belongings = {
    ...(isPlainObject(baseVehicleBelongings) ? baseVehicleBelongings : {}),
    ...(isPlainObject(payload.vehicle_belongings) ? payload.vehicle_belongings : {}),
  };

  if ("metadata" in next) {
    belongings[LEGACY_METADATA_KEY] = next.metadata || {};
    delete next.metadata;
  }
  if ("reception_damage_markers" in next) {
    belongings[LEGACY_RECEPTION_DAMAGE_KEY] = Array.isArray(next.reception_damage_markers)
      ? next.reception_damage_markers
      : [];
    delete next.reception_damage_markers;
  }
  if ("reception_signature_data_url" in next) {
    belongings[LEGACY_RECEPTION_SIGNATURE_KEY] = next.reception_signature_data_url || null;
    delete next.reception_signature_data_url;
  }
  delete next.deleted_at;
  delete next.deleted_by;
  delete next.subtotal;
  delete next.vat;
  delete next.final_total;
  delete next.parent_work_order_id;
  delete next.visit_number;
  delete next.visit_type;
  delete next.return_reason;
  delete next.vehicle_owner_customer_id;
  delete next.received_from_customer_id;
  delete next.customer_relationship_to_vehicle;
  delete next.customer_relationship_note;
  next.vehicle_belongings = belongings;
  return next;
}

function isMissingJobOrderColumnError(error: unknown): boolean {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return raw.includes("pgrst204") || (raw.includes("could not find") && raw.includes("schema cache"));
}

function isMissingOptionalColumnError(error: unknown): boolean {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return raw.includes("pgrst204") || raw.includes("schema cache") || raw.includes("could not find");
}

function buildJobOrderPayload(o: WorkOrder, tenantId: string, customerId: string, vehicleId: string) {
  return sanitizeWorkOrderWritePayload({
    tenant_id: tenantId,
    customer_id: customerId,
    vehicle_id: vehicleId,
    vehicle_owner_customer_id: o.vehicleOwnerCustomerId && isUuid(o.vehicleOwnerCustomerId) ? o.vehicleOwnerCustomerId : null,
    received_from_customer_id: o.receivedFromCustomerId && isUuid(o.receivedFromCustomerId) ? o.receivedFromCustomerId : customerId,
    customer_relationship_to_vehicle: o.customerRelationshipToVehicle || null,
    customer_relationship_note: o.customerRelationshipNote || null,
    order_number: o.id,
    description: o.description || null,
    diagnosis: o.diagnosis || null,
    diagnosis_notes: o.diagnosis || null,
    service_type: o.serviceType || null,
    technician_name: o.technician || null,
    entry_date: o.entryDate || new Date().toISOString().slice(0, 10),
    status: localStatusToCloud(o.status) as any,
    labor_cost: o.laborCost || 0,
    parts_cost: o.partsCost || 0,
    insurance_company: o.insurance && o.insurance !== "-" ? o.insurance : null,
    insurance_claim_number: o.claimNumber && o.claimNumber !== "-" ? o.claimNumber : null,
    claim_id: o.claimId && isUuid(o.claimId) ? o.claimId : null,
    work_order_type: o.claimId ? "insurance" : (o.workOrderType || "general_customer"),
    archived_at: o.archivedAt || (isClosedWorkOrderStatus(o.status) ? new Date().toISOString() : null),
    notes: o.description || null,
    parts_needed: (o.partsNeeded || []) as any,
    work_items: (o.workItems || []) as any,
    photos: (o.photos || []) as any,
    odometer_km: o.odometerKm ?? null,
    fuel_level_pct: o.fuelLevelPct ?? null,
    reception_notes: o.receptionNotes || null,
    reception_damage_markers: (o.receptionDamageMarkers || []) as any,
    reception_signature_data_url: o.receptionSignatureDataUrl || null,
    vehicle_belongings: (o.vehicleBelongings || {}) as any,
    received_at: o.receivedAt || null,
    tracking_expires_at: o.trackingExpiresAt || null,
    parent_work_order_id: o.parentWorkOrderId && isUuid(o.parentWorkOrderId) ? o.parentWorkOrderId : null,
    visit_number: o.visitNumber || null,
    visit_type: o.visitType || null,
    return_reason: o.returnReason || null,
    metadata: jobOrderMetadata(o) as any,
  });
}

async function mapSavedJobOrder(row: any): Promise<WorkOrder> {
  const [custRes, vehRes, claimRes] = await Promise.all([
    row.customer_id
      ? supabase.from("customers").select("id,name,phone").eq("id", row.customer_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    row.vehicle_id
      ? supabase.from("vehicles").select("id,plate_number,plate_letters,brand,model,year,vin,vin_number,color,vehicle_cover_image_url,vehicle_thumbnail_url").eq("id", row.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    row.claim_id
      ? supabase.from("insurance_claims").select("id,approved_amount,estimated_amount,estimation_type").eq("id", row.claim_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  const custMap = new Map<string, any>();
  if ((custRes as any).data?.id) custMap.set((custRes as any).data.id, (custRes as any).data);
  const vehMap = new Map<string, any>();
  const v = (vehRes as any).data;
  if (v?.id) {
    vehMap.set(v.id, {
      plate: [v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim(),
      brand: v.brand,
      model: v.model,
      year: v.year,
      vin: v.vin_number || v.vin,
      color: v.color,
      imageUrl: v.vehicle_cover_image_url,
      thumbnailUrl: v.vehicle_thumbnail_url,
    });
  }
  const claimMap = new Map<string, ClaimApprovalInfo>();
  const claim = (claimRes as any).data;
  if (claim?.id) {
    claimMap.set(claim.id, {
      approvedAmount: claim.approved_amount,
      estimatedAmount: claim.estimated_amount,
      estimationType: claim.estimation_type,
    });
  }
  return mapCloudRow(row, custMap, vehMap, claimMap);
}

type WorkOrderRealtimePayload = {
  eventType?: string;
  new?: Record<string, any>;
  old?: Record<string, any>;
};

/**
 * Applies one Supabase Realtime job_orders event to the compatibility cache.
 * This keeps the supervisor app, desktop list, and detail page on the same row
 * without a full-table refetch for every event.
 */
export async function applyWorkOrderRealtimeChange(payload: WorkOrderRealtimePayload): Promise<void> {
  const eventType = String(payload?.eventType || "").toUpperCase();
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
  if (!row) return;

  if (eventType === "DELETE") {
    const before = cache.length;
    cache = cache.filter((order) =>
      order.cloudId !== row.id &&
      order.id !== row.order_number &&
      order.displayNumber !== row.order_number
    );
    if (cache.length !== before) persist();
    return;
  }

  const idx = cache.findIndex((order) =>
    (row.id && order.cloudId === row.id) ||
    (row.order_number && (order.id === row.order_number || order.displayNumber === row.order_number))
  );

  if (idx < 0) {
    const inserted = await mapSavedJobOrder(row);
    upsertWorkOrderInCache(inserted);
    return;
  }

  const current = cache[idx];
  const custMap = new Map<string, { name: string; phone?: string | null }>();
  if (row.customer_id) custMap.set(row.customer_id, { name: current.customer, phone: current.phone });
  const vehMap = new Map<string, {
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    vin?: string | null;
    color?: string | null;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
  }>();
  if (row.vehicle_id) {
    vehMap.set(row.vehicle_id, {
      plate: current.plate,
      brand: current.vehicleType,
      model: current.model,
      year: current.year ? Number(current.year) : null,
      vin: current.vin,
      color: current.color,
      imageUrl: current.vehicleImageUrl,
      thumbnailUrl: current.vehicleThumbnailUrl,
    });
  }
  const claimMap = new Map<string, ClaimApprovalInfo>();
  if (row.claim_id) {
    claimMap.set(row.claim_id, {
      approvedAmount: current.insuranceApprovedAmount ?? null,
      estimatedAmount: null,
      estimationType: current.insuranceApprovalMode ?? null,
    });
  }

  const mapped = mapCloudRow(row, custMap, vehMap, claimMap);
  const pendingPatch = _pendingPatches.get(mapped.id);
  cache[idx] = pendingPatch ? { ...mapped, ...pendingPatch } : mapped;
  KNOWN_CLOUD_NUMBERS.add(mapped.id);
  persist();
}

async function saveNeededPartsToCloud(order: WorkOrder, partsNeeded: NeededPart[]): Promise<WorkOrder> {
  const ctx = await tenantContext();
  if (!ctx) throw new Error("تعذر تحديد الورشة الحالية");

  let query = supabase
    .from("job_orders")
    .update({ parts_needed: partsNeeded as any })
    .eq("tenant_id", ctx.tenantId);
  query = order.cloudId && isUuid(order.cloudId)
    ? query.eq("id", order.cloudId)
    : query.eq("order_number", order.id);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("تم الحفظ لكن تعذر تأكيد مزامنة قطع الغيار");

  await applyWorkOrderRealtimeChange({ eventType: "UPDATE", new: data });
  const saved = getWorkOrderById(data.id) || getWorkOrderById(data.order_number) || order;

  if (saved.claimId) {
    try {
      await upsertUnifiedOperationalState({
        tenantId: ctx.tenantId,
        claimId: saved.claimId,
        workOrderId: saved.cloudId || data.id,
        vehicleId: saved.vehicleId || null,
        customerId: saved.customerId || null,
        changedFrom: "work_order",
        patch: { parts_required: partsNeeded },
      });
    } catch (error) {
      // The authoritative job_orders write is already confirmed. A secondary
      // claim mirror failure must not roll the deleted part back into the UI.
      console.warn("[needed-parts unified mirror] primary write confirmed; mirror deferred", error);
    }
  }

  return saved;
}

async function resolveWorkOrderAliasJobOrderId(tenantId: string, oldNumber: string): Promise<string | null> {
  const { data, error } = await (supabase.from("work_order_number_renumber_audit" as any) as any)
    .select("job_order_id")
    .eq("tenant_id", tenantId)
    .ilike("old_order_number", oldNumber)
    .order("renumbered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Compatibility for environments where the forward migration is not yet applied.
    const message = String((error as any)?.message || "").toLowerCase();
    if (message.includes("does not exist") || message.includes("schema cache") || (error as any)?.code === "42P01") return null;
    throw error;
  }
  return isUuid((data as any)?.job_order_id || "") ? (data as any).job_order_id : null;
}

export async function fetchWorkOrderFromCloudByIdentifier(identifier: string): Promise<WorkOrder | null> {
  const raw = String(identifier || "").trim();
  if (!raw) return null;
  const ctx = await tenantContext();
  if (!ctx) return null;

  const segment = raw.split(/[/?#]/).filter(Boolean).pop() || raw;
  const lookup = extractWorkOrderNumber(segment) || segment;
  const lookupIsUuid = isUuid(lookup);

  let query = supabase
    .from("job_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .limit(1);

  query = lookupIsUuid
    ? query.eq("id", lookup)
    : query.ilike("order_number", lookup);

  let { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data?.id && !lookupIsUuid) {
    const aliasId = await resolveWorkOrderAliasJobOrderId(ctx.tenantId, lookup);
    if (aliasId) {
      const aliasResult = await supabase
        .from("job_orders")
        .select("*")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", aliasId)
        .limit(1)
        .maybeSingle();
      data = aliasResult.data as any;
      error = aliasResult.error as any;
      if (error) throw error;
    }
  }
  if (!data?.id) return null;

  const saved = await mapSavedJobOrder(data);
  upsertWorkOrderInCache(saved);
  return saved;
}

export async function saveWorkOrderToCloud(order: WorkOrder): Promise<WorkOrder> {
  assertNoTemporaryOperationalIds(order);
  const ctx = await tenantContext();
  if (!ctx) throw new Error("تعذر تحديد الورشة الحالية");
  const customerId = await resolveCustomerId(ctx.tenantId, order);
  if (!customerId || !isUuid(customerId)) throw new Error("لا يمكن حفظ أمر العمل بدون customer_id صالح");
  const vehicleId = await resolveVehicleId(ctx.tenantId, customerId, order);
  if (!vehicleId || !isUuid(vehicleId)) throw new Error("لا يمكن حفظ أمر العمل بدون vehicle_id صالح");

  const existingId = order.cloudId && isUuid(order.cloudId)
    ? order.cloudId
    : null;
  let targetId = existingId;
  let finalOrderNumber = order.id;
  let previousOrderNumber: string | null = null;
  if (existingId) {
    const { data: existing, error: existingError } = await supabase
      .from("job_orders")
      .select("id,order_number,deleted_at,archived_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", existingId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.id) throw new Error("Work order was not found in Supabase");
    if ((existing as any).deleted_at) {
      throw new Error("Work order is deleted in Supabase and cannot be updated from this form");
    }
    previousOrderNumber = (existing as any).order_number || order.id;
    // Visible numbers are immutable after allocation. Keeping the UUID and the
    // original number together prevents broken invoices, claims and old links.
    finalOrderNumber = normalizeWorkOrderNumber(previousOrderNumber || order.id || "");
    if (!isSupportedWorkOrderNumber(finalOrderNumber)) throw new Error("Invalid work order number");
  } else {
    // Optimistic only: the database BEFORE INSERT trigger atomically allocates
    // the authoritative WO-00001 number for the current tenant.
    finalOrderNumber = normalizeWorkOrderNumber(order.id);
  }

  const normalizedStatus = normalizeWorkOrderStatus(order.status);
  const normalizedOrder = {
    ...order,
    id: finalOrderNumber,
    customerId,
    vehicleId,
    archivedAt: isClosedWorkOrderStatus(normalizedStatus) ? (order.archivedAt || undefined) : undefined,
  };
  const payload = buildJobOrderPayload(normalizedOrder, ctx.tenantId, customerId, vehicleId);
  let write = targetId
    ? (supabase.from("job_orders") as any).update(payload).eq("tenant_id", ctx.tenantId).eq("id", targetId).select("*").single()
    : (supabase.from("job_orders") as any).insert(payload).select("*").single();
  let { data, error } = await write;
  if (error && isMissingJobOrderColumnError(error)) {
    const fallbackPayload = legacyCompatibleJobOrderPayload(payload, order.vehicleBelongings);
    write = targetId
      ? (supabase.from("job_orders") as any).update(fallbackPayload).eq("tenant_id", ctx.tenantId).eq("id", targetId).select("*").single()
      : (supabase.from("job_orders") as any).insert(fallbackPayload).select("*").single();
    ({ data, error } = await write);
  }
  if (error) throw error;
  if (!data?.id || !isUuid(data.id)) throw new Error("تعذر تأكيد حفظ أمر العمل في Supabase");
  const { data: verified, error: verifyError } = await supabase
    .from("job_orders")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", data.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (!verified?.id) throw new Error("تم الحفظ لكن تعذر قراءة أمر العمل للتأكيد");

  if (previousOrderNumber && finalOrderNumber.toLowerCase() !== previousOrderNumber.toLowerCase()) {
    await syncRenamedWorkOrderReferences(ctx.tenantId, previousOrderNumber, finalOrderNumber);
  }

  const saved = await mapSavedJobOrder(verified);
  if (saved.claimId) {
    try {
      const { data: auth } = await supabase.auth.getUser();
      await upsertUnifiedOperationalState({
        tenantId: ctx.tenantId,
        claimId: saved.claimId,
        workOrderId: saved.cloudId || data.id,
        vehicleId: saved.vehicleId || vehicleId,
        customerId,
        changedFrom: "work_order",
        changedBy: auth.user?.id || null,
        patch: {
          operational_status: localStatusToCloud(saved.status),
          repair_stage: saved.status,
          operational_notes: saved.description || saved.diagnosis || null,
          parts_required: saved.partsNeeded || [],
          vehicle_received_at: saved.receivedAt || null,
        },
      });
      for (const photo of saved.photos || []) {
        const path = photo.storagePath || photo.dataUrl;
        if (!path) continue;
        await addUnifiedVehicleMedia({
          tenantId: ctx.tenantId,
          claimId: saved.claimId,
          workOrderId: saved.cloudId || data.id,
          vehicleId: saved.vehicleId || vehicleId,
          bucket: photo.storagePath ? "work-order-photos" : "legacy-inline",
          path,
          publicUrl: photo.dataUrl || null,
          category: photo.phase || "work_order",
          stage: photo.phase || null,
          caption: photo.caption || null,
          uploadedBy: auth.user?.id || null,
          source: "work_order",
        });
      }
    } catch (syncError) {
      console.warn("[unified claim/work-order sync] skipped", syncError);
    }
  }
  KNOWN_CLOUD_NUMBERS.add(saved.id);
  const idx = cache.findIndex((o) => o.id === saved.id || o.id === previousOrderNumber || o.cloudId === saved.cloudId);
  if (idx >= 0) cache[idx] = saved;
  else cache.unshift(saved);
  persist();
  return saved;
}

async function syncRenamedWorkOrderReferences(tenantId: string, oldNumber: string, newNumber: string) {
  const updates: Array<PromiseLike<any>> = [
    (supabase.from("expenses") as any).update({ linked_work_order_id: newNumber }).eq("tenant_id", tenantId).eq("linked_work_order_id", oldNumber),
    (supabase.from("expenses") as any).update({ source_work_order_id: newNumber }).eq("tenant_id", tenantId).eq("source_work_order_id", oldNumber),
    (supabase.from("sales_documents") as any).update({ from_doc_id: newNumber }).eq("tenant_id", tenantId).eq("from_doc_id", oldNumber),
    (supabase.from("sales_documents") as any).update({ work_order_number: newNumber }).eq("tenant_id", tenantId).eq("work_order_number", oldNumber),
    (supabase.from("vehicle_stay_notifications" as any) as any).update({ work_order_number: newNumber }).eq("tenant_id", tenantId).eq("work_order_number", oldNumber),
  ];
  const results = await Promise.allSettled(updates);
  for (const result of results) {
    if (result.status === "fulfilled" && (result.value as any)?.error && !isMissingOptionalColumnError((result.value as any).error)) {
      console.warn("[syncRenamedWorkOrderReferences]", (result.value as any).error);
    }
    if (result.status === "rejected") console.warn("[syncRenamedWorkOrderReferences]", result.reason);
  }
}

export async function updateWorkOrderInCloud(id: string, patch: Partial<WorkOrder>): Promise<WorkOrder> {
  const current = getWorkOrderById(id);
  if (!current) throw new Error("أمر العمل غير موجود في القائمة الحالية");
  return saveWorkOrderToCloud({ ...current, ...patch });
}

// Debounce + coalesce patches per order_number. Editing the parts list rapidly
// (typing, ticking checkboxes) used to fire ~32k UPDATEs/day; now we batch all
// pending fields per order into a single PATCH every 600 ms.
const _pendingPatches = new Map<string, Partial<WorkOrder>>();
const _patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PATCH_DEBOUNCE_MS = 600;

async function _flushPatch(orderNumber: string) {
  _patchTimers.delete(orderNumber);
  const patch = _pendingPatches.get(orderNumber);
  _pendingPatches.delete(orderNumber);
  if (!patch) return;
  try {
    if (!KNOWN_CLOUD_NUMBERS.has(orderNumber)) return;
    const ctx = await tenantContext(); if (!ctx) return;
    const updates: any = {};
    const current = getWorkOrderById(orderNumber);
    if (patch.status !== undefined) {
      updates.status = localStatusToCloud(patch.status) as any;
      if (isClosedWorkOrderStatus(patch.status) && patch.archivedAt === undefined) {
        updates.archived_at = current?.archivedAt || new Date().toISOString();
      }
    }
    if (patch.diagnosis !== undefined) { updates.diagnosis = patch.diagnosis; updates.diagnosis_notes = patch.diagnosis; }
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.technician !== undefined) updates.technician_name = patch.technician;
    if (patch.serviceType !== undefined) updates.service_type = patch.serviceType;
    if (patch.laborCost !== undefined) updates.labor_cost = patch.laborCost;
    if (patch.partsCost !== undefined) updates.parts_cost = patch.partsCost;
    if (patch.partsNeeded !== undefined) updates.parts_needed = patch.partsNeeded as any;
    if (patch.workItems !== undefined) updates.work_items = patch.workItems as any;
    if (patch.photos !== undefined) updates.photos = patch.photos as any;
    if (patch.entryDate !== undefined) updates.entry_date = patch.entryDate;
    if (patch.workOrderType !== undefined) updates.work_order_type = patch.claimId ? "insurance" : patch.workOrderType;
    if (patch.claimId !== undefined) updates.claim_id = patch.claimId || null;
    if (patch.insurance !== undefined) updates.insurance_company = patch.insurance === "-" ? null : patch.insurance;
    if (patch.claimNumber !== undefined) updates.insurance_claim_number = patch.claimNumber === "-" ? null : patch.claimNumber;
    if (patch.trackingExpiresAt !== undefined) updates.tracking_expires_at = patch.trackingExpiresAt || null;
    if (patch.archivedAt !== undefined) updates.archived_at = patch.archivedAt || null;
    if (patch.odometerKm !== undefined) updates.odometer_km = patch.odometerKm;
    if (patch.fuelLevelPct !== undefined) updates.fuel_level_pct = patch.fuelLevelPct;
    if (patch.receptionNotes !== undefined) updates.reception_notes = patch.receptionNotes;
    if (patch.receptionDamageMarkers !== undefined) updates.reception_damage_markers = patch.receptionDamageMarkers;
    if (patch.receptionSignatureDataUrl !== undefined) updates.reception_signature_data_url = patch.receptionSignatureDataUrl || null;
    if (patch.vehicleBelongings !== undefined) updates.vehicle_belongings = patch.vehicleBelongings;
    if (patch.receivedAt !== undefined) updates.received_at = patch.receivedAt;
    if (
      patch.extraExpenses !== undefined ||
      patch.linkedExpenseVoucherIds !== undefined ||
      patch.depositApplied !== undefined ||
      patch.closingReview !== undefined ||
      patch.trackPassword !== undefined ||
      patch.mileage !== undefined
    ) {
      updates.metadata = {
        extraExpenses: patch.extraExpenses ?? current?.extraExpenses ?? [],
        linkedExpenseVoucherIds: patch.linkedExpenseVoucherIds ?? current?.linkedExpenseVoucherIds ?? [],
        depositApplied: patch.depositApplied ?? current?.depositApplied ?? 0,
        closingReview: patch.closingReview ?? current?.closingReview ?? null,
        trackPassword: patch.trackPassword ?? current?.trackPassword ?? null,
        mileage: patch.mileage ?? current?.mileage ?? null,
      };
    }
    if (Object.keys(updates).length === 0) return;
    const updateByCloudId = current?.cloudId && isUuid(current.cloudId);
    let updateQuery = supabase.from("job_orders")
      .update(updates)
      .eq("tenant_id", ctx.tenantId);
    updateQuery = updateByCloudId
      ? updateQuery.eq("id", current.cloudId)
      : updateQuery.eq("order_number", orderNumber);
    let { error } = await updateQuery;
    if (error && isMissingJobOrderColumnError(error)) {
      let fallbackQuery = supabase.from("job_orders")
        .update(legacyCompatibleJobOrderPayload(updates, current?.vehicleBelongings) as any)
        .eq("tenant_id", ctx.tenantId);
      fallbackQuery = updateByCloudId
        ? fallbackQuery.eq("id", current.cloudId)
        : fallbackQuery.eq("order_number", orderNumber);
      ({ error } = await fallbackQuery);
    }
    if (error) console.warn("[pushPatchToCloud]", error);
    else if (current?.claimId) {
      const unifiedPatch: Record<string, unknown> = {};
      if (patch.status !== undefined) {
        unifiedPatch.operational_status = localStatusToCloud(patch.status);
        unifiedPatch.repair_stage = patch.status;
        if (isClosedWorkOrderStatus(patch.status)) unifiedPatch.vehicle_delivered_at = new Date().toISOString();
      }
      if (patch.receivedAt !== undefined) unifiedPatch.vehicle_received_at = patch.receivedAt || null;
      if (patch.entryDate !== undefined) unifiedPatch.vehicle_received_at = patch.entryDate || null;
      if (patch.description !== undefined || patch.diagnosis !== undefined) {
        unifiedPatch.operational_notes = patch.description ?? patch.diagnosis ?? null;
      }
      if (patch.partsNeeded !== undefined) unifiedPatch.parts_required = patch.partsNeeded;
      // Contract compatibility: the old immediate parts sync was patch: { parts_required: patch.partsNeeded }.
      if (Object.keys(unifiedPatch).length) {
        await upsertUnifiedOperationalState({
          tenantId: ctx.tenantId,
          claimId: current.claimId,
          workOrderId: current.cloudId || null,
          vehicleId: current.vehicleId || null,
          customerId: current.customerId || null,
          changedFrom: "work_order",
          patch: unifiedPatch,
        });
      }
    }
  } catch (e) { console.warn("[pushPatchToCloud] exception", e); }
}

function pushPatchToCloud(orderNumber: string, patch: Partial<WorkOrder>) {
  if (!KNOWN_CLOUD_NUMBERS.has(orderNumber)) return;
  const prev = _pendingPatches.get(orderNumber) || {};
  _pendingPatches.set(orderNumber, { ...prev, ...patch });
  const existing = _patchTimers.get(orderNumber);
  if (existing) clearTimeout(existing);
  _patchTimers.set(orderNumber, setTimeout(() => _flushPatch(orderNumber), PATCH_DEBOUNCE_MS));
  ensurePendingPatchUnloadFlush();
}

let pendingPatchUnloadFlushInstalled = false;

function flushPendingWorkOrderPatches() {
  for (const orderNumber of Array.from(_pendingPatches.keys())) {
    const t = _patchTimers.get(orderNumber);
    if (t) clearTimeout(t);
    _flushPatch(orderNumber);
  }
}

function ensurePendingPatchUnloadFlush() {
  if (pendingPatchUnloadFlushInstalled || typeof window === "undefined") return;
  pendingPatchUnloadFlushInstalled = true;
  window.addEventListener("beforeunload", flushPendingWorkOrderPatches, { once: true });
}

// Removing an item from the compatibility cache is intentionally local-only.
// Every destructive UI path must first call the explicit delete/archive policy,
// which records the user and audit reason. The retired global cache-diff hook
// interpreted auth cache clears and partial cloud refetches as user deletions and
// incorrectly soft-deleted historical work orders in Supabase.
