import { classifyWorkOrderCosts, type ClaimApprovalMode, type ClaimApprovalInfo } from "@/lib/workOrderCosting";
import { addUnifiedVehicleMedia, upsertUnifiedOperationalState } from "@/lib/claimWorkOrderUnified";

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
  /** رقم عرض احترافي للأمر (مثل WO-2026-00012). إن لم يُحدّد يُستخدم id كرقم. */
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
  // الأحدث أولاً: حسب entryDate ثم الـ id (بصفته يبدأ بالسنة WO-YYYY-####)
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
  // 3) Extract WO-YYYY-NNN pattern from a URL or longer string
  const m = raw.match(/WO-\d{4}-\d+/i);
  if (m) {
    const code = m[0].toUpperCase();
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

export function updateWorkOrder(id: string, patch: Partial<WorkOrder>) {
  const list = load();
  const idx = list.findIndex(o => o.id === id);
  if (idx >= 0) {
    const normalizedPatch = { ...patch };
    if (patch.status !== undefined) normalizedPatch.status = normalizeWorkOrderStatus(patch.status);
    if (patch.status !== undefined && isClosedWorkOrderStatus(patch.status) && patch.archivedAt === undefined) {
      normalizedPatch.archivedAt = list[idx].archivedAt || new Date().toISOString();
    }
    list[idx] = { ...list[idx], ...normalizedPatch };
    persist();
  }
}

// ===== Needed Parts direct helpers (independent additions/edits) =====
export function addNeededPartToOrder(orderId: string, part: Omit<NeededPart, "id"> & { id?: string }): NeededPart | null {
  const list = load();
  const idx = list.findIndex(o => o.id === orderId);
  if (idx < 0) return null;
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
  pushPatchToCloudNow(list[idx].id, { partsNeeded });
  return newPart;
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
  const idx = list.findIndex(o => o.id === orderId);
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
      const saved = await saveWorkOrderToCloud(updatedOrder);
      return { added, skipped, order: saved };
    } catch (error) {
      const rollbackList = load();
      const rollbackIdx = rollbackList.findIndex(o => o.id === orderId);
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

export function updateNeededPartInOrder(orderId: string, partId: string, patch: Partial<NeededPart>) {
  const list = load();
  const idx = list.findIndex(o => o.id === orderId);
  if (idx < 0) return;
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
  pushPatchToCloudNow(list[idx].id, { partsNeeded: parts });
}

export function removeNeededPartFromOrder(orderId: string, partId: string) {
  const list = load();
  const idx = list.findIndex(o => o.id === orderId);
  if (idx < 0) return;
  const partsNeeded = (list[idx].partsNeeded || []).filter(p => p.id !== partId);
  list[idx] = { ...list[idx], partsNeeded };
  persist();
  pushPatchToCloudNow(list[idx].id, { partsNeeded });
}

export function addWorkOrder(order: WorkOrder) {
  const list = load();
  list.unshift(order);
  persist();
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
const KNOWN_CLOUD_NUMBERS = new Set<string>();

function parseWorkOrderNumber(value: string) {
  const m = String(value || "").trim().match(/^([A-Z]+)-(\d{4})-(\d+)$/i);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), year: m[2], sequence: Number(m[3]), padding: m[3].length };
}

async function allocateVisibleOrderNumber(tenantId: string, requested: string): Promise<string> {
  const parsed = parseWorkOrderNumber(requested);
  if (!parsed) return requested;
  const { data, error } = await supabase
    .from("job_orders")
    .select("order_number")
    .eq("tenant_id", tenantId)
    .ilike("order_number", `${parsed.prefix}-${parsed.year}-%`)
    .limit(10000);
  if (error) throw error;

  const used = new Set<string>();
  let max = 0;
  for (const row of (data || []) as Array<{ order_number: string | null }>) {
    const n = String(row.order_number || "").trim().toUpperCase();
    const p = parseWorkOrderNumber(n);
    if (!p || p.prefix !== parsed.prefix || p.year !== parsed.year) continue;
    used.add(n);
    if (Number.isFinite(p.sequence) && p.sequence > max) max = p.sequence;
  }

  const normalizedRequested = requested.trim().toUpperCase();
  if (!used.has(normalizedRequested)) return requested;

  let next = Math.max(max + 1, parsed.sequence + 1);
  let candidate = `${parsed.prefix}-${parsed.year}-${String(next).padStart(parsed.padding, "0")}`;
  while (used.has(candidate)) {
    next += 1;
    candidate = `${parsed.prefix}-${parsed.year}-${String(next).padStart(parsed.padding, "0")}`;
  }
  return candidate;
}

async function fetchFromCloud(options: { throwOnError?: boolean } = {}): Promise<void> {
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

    let ordersResult = await supabase
      .from("job_orders")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (ordersResult.error && isMissingJobOrderColumnError(ordersResult.error)) {
      ordersResult = await supabase
        .from("job_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
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
    const [
      { data: custs, error: custError },
      { data: vehs, error: vehError },
      { data: claims, error: claimError },
    ] = await Promise.all([
      customerQuery,
      Promise.resolve(vehicleQuery),
      claimQuery,
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
      const mapped = mapCloudRow(r, custMap, vehMap, claimMap);
      const pendingPatch = _pendingPatches.get(mapped.id);
      return pendingPatch ? { ...mapped, ...pendingPatch } : mapped;
    });
    KNOWN_CLOUD_NUMBERS.clear();
    cloudOrders.forEach((o) => KNOWN_CLOUD_NUMBERS.add(o.id));

    cache = cloudOrders;
    listeners.forEach((l) => l());

    // Kick off background migration of legacy base64 photos to Storage (non-blocking).
    setTimeout(() => migrateLegacyPhotosInBackground(cache), 1000);
  } catch (e) {
    console.warn("[workOrdersStore] cloud fetch failed:", e);
    if (options.throwOnError) throw e;
  }
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
  if (cloudFetchTimer) clearTimeout(cloudFetchTimer);
  cloudFetchTimer = setTimeout(() => { cloudFetchTimer = null; fetchFromCloud(); }, delay);
}

function ensureCloudSync() {
  if (cloudBootstrapped) return;
  cloudBootstrapped = true;
  // initial fetch + realtime subscription
  scheduleCloudFetch(0);
  try {
    supabase
      .channel(`work_orders_cloud_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, () => scheduleCloudFetch(150))
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => scheduleCloudFetch(400))
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => scheduleCloudFetch(400))
      .subscribe();
  } catch (e) {
    console.warn("[workOrdersStore] realtime subscribe failed:", e);
  }
  // Focus/visibility refresh is handled by React Query and page-scoped
  // realtime. Keeping legacy store listeners here caused request storms when
  // returning to the tab.
}

// Kick off cloud sync as soon as this module is imported (after auth bootstraps).
if (typeof window !== "undefined") {
  setTimeout(() => ensureCloudSync(), 800);

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
      if (uid) scheduleCloudFetch(50);
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
    finalOrderNumber = String(order.id || previousOrderNumber || "").trim().toUpperCase();
    if (!/^WO-\d{4}-\d+$/i.test(finalOrderNumber)) {
      throw new Error("Work order number must use WO-YYYY-0001 format");
    }
    if (previousOrderNumber && finalOrderNumber.toLowerCase() !== previousOrderNumber.toLowerCase()) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from("job_orders")
        .select("id,order_number")
        .eq("tenant_id", ctx.tenantId)
        .ilike("order_number", finalOrderNumber)
        .neq("id", existingId)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if ((duplicate as any)?.id) throw new Error(`Work order number ${finalOrderNumber} already exists`);
    }
  } else {
    finalOrderNumber = await allocateVisibleOrderNumber(ctx.tenantId, order.id);
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
    let { error } = await supabase.from("job_orders")
      .update(updates).eq("tenant_id", ctx.tenantId).eq("order_number", orderNumber);
    if (error && isMissingJobOrderColumnError(error)) {
      ({ error } = await supabase.from("job_orders")
        .update(legacyCompatibleJobOrderPayload(updates, current?.vehicleBelongings) as any)
        .eq("tenant_id", ctx.tenantId)
        .eq("order_number", orderNumber));
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
}

function pushPatchToCloudNow(orderNumber: string, patch: Partial<WorkOrder>) {
  if (!KNOWN_CLOUD_NUMBERS.has(orderNumber)) return;
  const existing = _patchTimers.get(orderNumber);
  if (existing) {
    clearTimeout(existing);
    _patchTimers.delete(orderNumber);
  }
  const prev = _pendingPatches.get(orderNumber) || {};
  _pendingPatches.set(orderNumber, { ...prev, ...patch });
  void _flushPatch(orderNumber);
}

// Flush any pending patches on page unload so we don't lose the last edits.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    for (const orderNumber of Array.from(_pendingPatches.keys())) {
      const t = _patchTimers.get(orderNumber);
      if (t) clearTimeout(t);
      _flushPatch(orderNumber);
    }
  });
}

async function pushDeleteToCloud(orderNumber: string) {
  try {
    const ctx = await tenantContext(); if (!ctx) return;
    const archivedAt = new Date().toISOString();
    let { data, error } = await supabase.from("job_orders")
      .update({ archived_at: archivedAt, deleted_at: archivedAt, deleted_by: null } as any)
      .eq("tenant_id", ctx.tenantId)
      .eq("order_number", orderNumber)
      .select("id")
      .maybeSingle();
    if (error && isMissingJobOrderColumnError(error)) {
      ({ data, error } = await supabase.from("job_orders")
        .update({ archived_at: archivedAt } as any)
        .eq("tenant_id", ctx.tenantId)
        .eq("order_number", orderNumber)
        .select("id")
        .maybeSingle());
    }
    if (error) console.warn("[pushDeleteToCloud]", error);
    else if (!data?.id) console.warn("[pushDeleteToCloud] no affected row", { orderNumber });
    else KNOWN_CLOUD_NUMBERS.delete(orderNumber);
  } catch (e) { console.warn("[pushDeleteToCloud] exception", e); }
}

// Cloud-side hooks invoked from a diff listener below — keeps the public API surface unchanged.
function _afterAdd(o: WorkOrder) { pushOrderToCloud(o); }
function _afterUpdate(id: string, patch: Partial<WorkOrder>) { pushPatchToCloud(id, patch); }
function _afterDelete(id: string) { pushDeleteToCloud(id); }



// Patch the original implementations to call our cloud hooks.
// (Implementations above call persist() then return; we wrap by overwriting via Object.assign on module exports won't work in ESM —
// so we instead re-export wrapped versions below and consumers using the original names get the wrapped behavior because the original
// functions are defined as `function` declarations and we replace their bodies by hoisting interceptors here.)
//
// Approach: subscribe internally to changes and diff against last-known state.
let _lastSnapshot: Map<string, WorkOrder> = new Map(load().map((o) => [o.id, o]));
listeners.add(() => {
  const current = load();
  const currentMap = new Map(current.map((o) => [o.id, o]));
  // additions
  for (const o of current) {
    if (!_lastSnapshot.has(o.id)) _afterAdd(o);
  }
  // updates
  for (const o of current) {
    const prev = _lastSnapshot.get(o.id);
    if (prev && prev !== o) {
      const patch: Partial<WorkOrder> = {};
      (Object.keys(o) as (keyof WorkOrder)[]).forEach((k) => {
        if ((o as any)[k] !== (prev as any)[k]) (patch as any)[k] = (o as any)[k];
      });
      if (Object.keys(patch).length) _afterUpdate(o.id, patch);
    }
  }
  // deletions
  for (const id of _lastSnapshot.keys()) {
    if (!currentMap.has(id)) _afterDelete(id);
  }
  _lastSnapshot = currentMap;
});
