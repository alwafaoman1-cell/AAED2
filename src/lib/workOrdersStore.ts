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
  trackingExpiresAt?: string;
  archivedAt?: string;
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
  closingReview?: {
    status: string;
    finalCostSource: "Actual Expenses" | "Estimated Costs" | "Manual Final Cost";
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

let cache: WorkOrder[] = [];
const listeners = new Set<() => void>();

function load(): WorkOrder[] {
  return cache;
}

function persist() {
  listeners.forEach(l => l());
}

export function getWorkOrders(): WorkOrder[] {
  // الأحدث أولاً: حسب entryDate ثم الـ id (بصفته يبدأ بالسنة WO-YYYY-####)
  return [...load()].sort((a, b) => {
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
  let found = list.find(o => o.id === raw);
  if (found) return found;
  // 2) Case-insensitive id / displayNumber match
  const lower = raw.toLowerCase();
  found = list.find(o => o.id?.toLowerCase() === lower || o.displayNumber?.toLowerCase() === lower);
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
    list[idx] = { ...list[idx], ...patch };
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
  list[idx] = { ...list[idx], partsNeeded: [...(list[idx].partsNeeded || []), newPart] };
  persist();
  return newPart;
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
}

export function removeNeededPartFromOrder(orderId: string, partId: string) {
  const list = load();
  const idx = list.findIndex(o => o.id === orderId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], partsNeeded: (list[idx].partsNeeded || []).filter(p => p.id !== partId) };
  persist();
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
export async function refreshWorkOrdersFromCloud(): Promise<void> {
  ensureCloudSync();
  await fetchFromCloud();
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


function cloudStatusToLocal(s: string | null | undefined): string {
  switch (s) {
    case "delivered": return "تم التسليم";
    case "completed": return "جاهز للتسليم";
    case "in_progress": return "تحت الإصلاح";
    case "waiting_parts": return "بانتظار قطع الغيار";
    case "inspection": return "تحت الفحص";
    case "received":
    default: return "تحت الفحص";
  }
}
function localStatusToCloud(s: string | undefined): string {
  const n = (s || "").trim();
  if (["مغلق", "تم التسليم"].includes(n)) return "delivered";
  if (["جاهز للتسليم", "ضبط الجودة"].includes(n)) return "completed";
  if (["تحت الإصلاح"].includes(n)) return "in_progress";
  if (["بانتظار قطع الغيار", "بانتظار الموافقة"].includes(n)) return "waiting_parts";
  if (["تحت الفحص"].includes(n)) return "inspection";
  return "received";
}

type CloudRow = any;
function mapCloudRow(
  r: CloudRow,
  custMap: Map<string, { name: string; phone?: string | null }>,
  vehMap: Map<string, { plate?: string | null; brand?: string | null; model?: string | null; year?: number | null; vin?: string | null; color?: string | null }>,
): WorkOrder {
  const c = r.customer_id ? custMap.get(r.customer_id) : undefined;
  const v = r.vehicle_id ? vehMap.get(r.vehicle_id) : undefined;
  return {
    id: r.order_number || r.id,
    cloudId: r.id,
    displayNumber: r.order_number || undefined,
    workOrderType: r.work_order_type || (r.claim_id ? "insurance" : "general_customer"),
    claimId: r.claim_id || undefined,
    trackingToken: r.tracking_token || undefined,
    trackingExpiresAt: r.tracking_expires_at || undefined,
    archivedAt: r.archived_at || undefined,
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
    totalCost: Number(r.final_total ?? r.subtotal ?? 0),
    description: r.description || undefined,
    diagnosis: r.diagnosis || r.diagnosis_notes || undefined,
    laborCost: Number(r.labor_cost ?? 0),
    partsCost: Number(r.parts_cost ?? 0),
    photos: Array.isArray(r.photos) ? r.photos : [],
    partsNeeded: Array.isArray(r.parts_needed) ? r.parts_needed : [],
    workItems: Array.isArray(r.work_items) ? r.work_items : [],
    extraExpenses: Array.isArray(r.metadata?.extraExpenses) ? r.metadata.extraExpenses : [],
    linkedExpenseVoucherIds: Array.isArray(r.metadata?.linkedExpenseVoucherIds) ? r.metadata.linkedExpenseVoucherIds : [],
    depositApplied: Number(r.metadata?.depositApplied || 0),
    closingReview: r.metadata?.closingReview || undefined,
    trackPassword: r.metadata?.trackPassword || undefined,
    mileage: r.metadata?.mileage || undefined,
    odometerKm: r.odometer_km ?? undefined,
    fuelLevelPct: r.fuel_level_pct ?? undefined,
    receptionNotes: r.reception_notes || undefined,
    receptionDamageMarkers: Array.isArray(r.reception_damage_markers) ? r.reception_damage_markers : [],
    receptionSignatureDataUrl: r.reception_signature_data_url || undefined,
    vehicleBelongings: r.vehicle_belongings || undefined,
    receivedAt: r.received_at || undefined,
  };
}

let cloudBootstrapped = false;
let cloudFetchTimer: ReturnType<typeof setTimeout> | null = null;
const KNOWN_CLOUD_NUMBERS = new Set<string>();

async function fetchFromCloud(): Promise<void> {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return;

    const [{ data: rows }, { data: custs }, { data: vehs }] = await Promise.all([
      supabase.from("job_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
      supabase.from("customers").select("id,name,phone").eq("tenant_id", tenantId).limit(10000),
      supabase.from("vehicles").select("id,plate_number,plate_letters,brand,model,year,vin_number,color").eq("tenant_id", tenantId).limit(10000),
    ]);
    if (!rows) return;


    const custMap = new Map<string, any>();
    (custs || []).forEach((c: any) => custMap.set(c.id, { name: c.name, phone: c.phone }));
    const vehMap = new Map<string, any>();
    (vehs || []).forEach((v: any) => vehMap.set(v.id, {
      plate: [v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim(),
      brand: v.brand, model: v.model, year: v.year, vin: v.vin_number, color: v.color,
    }));

    const cloudOrders: WorkOrder[] = rows.map((r) => mapCloudRow(r, custMap, vehMap));
    KNOWN_CLOUD_NUMBERS.clear();
    cloudOrders.forEach((o) => KNOWN_CLOUD_NUMBERS.add(o.id));

    cache = cloudOrders;
    listeners.forEach((l) => l());

    // Kick off background migration of legacy base64 photos to Storage (non-blocking).
    setTimeout(() => migrateLegacyPhotosInBackground(cache), 1000);
  } catch (e) {
    console.warn("[workOrdersStore] cloud fetch failed:", e);
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
        // Update local cache + push to cloud so all devices get the URLs.
        updateWorkOrder(o.id, { photos: migrated });
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
  // pull again when tab regains focus / regains connectivity
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => scheduleCloudFetch(50));
    window.addEventListener("online", () => scheduleCloudFetch(50));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleCloudFetch(50);
    });
  }
}

// Kick off cloud sync as soon as this module is imported (after auth bootstraps).
if (typeof window !== "undefined") {
  setTimeout(() => ensureCloudSync(), 800);

  // 🔑 When the auth user changes (login / logout / account switch on the same
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
  const n = (name || "").trim();
  if (!n) return null;
  const { data: existing } = await supabase
    .from("customers").select("id").eq("tenant_id", tenantId).ilike("name", n).limit(1).maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await supabase
    .from("customers").insert({ tenant_id: tenantId, name: n, phone: phone || null }).select("id").maybeSingle();
  if (error) { console.warn("[ensureCustomer]", error); return null; }
  return created?.id || null;
}

async function ensureVehicle(tenantId: string, customerId: string, o: WorkOrder): Promise<string | null> {
  if (o.vehicleId) return o.vehicleId;
  try {
    const { ensureVehicleForCustomer } = await import("@/lib/vehicleIdentity");
    const resolved = await ensureVehicleForCustomer({
      customerId,
      plate: o.plate,
      vin: o.vin,
      make: o.vehicleType,
      model: o.model,
      year: o.year,
      color: o.color,
    });
    if (resolved.ownershipConflict) {
      console.warn("[ensureVehicle] existing vehicle belongs to another customer; using existing id without auto-transfer", resolved.vehicleId);
    }
    return resolved.vehicleId;
  } catch (e) {
    console.warn("[ensureVehicle:identity]", e);
    return null;
  }
  return null;
}

async function pushOrderToCloud(o: WorkOrder) {
  try {
    if (KNOWN_CLOUD_NUMBERS.has(o.id)) return; // already on cloud
    const ctx = await tenantContext(); if (!ctx) return;
    const custId = await ensureCustomer(ctx.tenantId, o.customer, o.phone); if (!custId) return;
    const vehId = await ensureVehicle(ctx.tenantId, custId, o); if (!vehId) return;
    const { error } = await (supabase.from("job_orders") as any).insert({
      tenant_id: ctx.tenantId,
      customer_id: custId,
      vehicle_id: vehId,
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
      claim_id: o.claimId || null,
      work_order_type: o.claimId ? "insurance" : (o.workOrderType || "general_customer"),
      archived_at: o.archivedAt || null,
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
      metadata: {
        extraExpenses: o.extraExpenses || [],
        linkedExpenseVoucherIds: o.linkedExpenseVoucherIds || [],
        depositApplied: o.depositApplied || 0,
        closingReview: o.closingReview || null,
        trackPassword: o.trackPassword || null,
        mileage: o.mileage || null,
      } as any,
    });
    if (error) console.warn("[pushOrderToCloud]", error);
    else KNOWN_CLOUD_NUMBERS.add(o.id);
  } catch (e) { console.warn("[pushOrderToCloud] exception", e); }
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
    if (patch.status !== undefined) updates.status = localStatusToCloud(patch.status) as any;
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
      const current = getWorkOrderById(orderNumber);
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
    const { error } = await supabase.from("job_orders")
      .update(updates).eq("tenant_id", ctx.tenantId).eq("order_number", orderNumber);
    if (error) console.warn("[pushPatchToCloud]", error);
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
    const { error } = await supabase.from("job_orders")
      .update({ archived_at: new Date().toISOString() } as any).eq("tenant_id", ctx.tenantId).eq("order_number", orderNumber);
    if (error) console.warn("[pushDeleteToCloud]", error);
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
