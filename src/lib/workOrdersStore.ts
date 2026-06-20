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
  /** رقم عرض احترافي للأمر (مثل WO-2026-00012). إن لم يُحدّد يُستخدم id كرقم. */
  displayNumber?: string;
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
  vehicleBelongings?: Record<string, boolean | string>;
  receivedAt?: string;
  /** بنود الأعمال المطلوبة من العميل (تظهر له في رابط التوقيع) */
  workItems?: WorkItem[];
  /** معرّف العميل الفعلي في customersStore (مرجع موحّد). */
  customerId?: string;
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

const STORAGE_KEY = "alwafa_work_orders";

const seed: WorkOrder[] = [
  { id: "WO-2024-001", customer: "أحمد محمد", phone: "0551234567", plate: "أ ب ج 1234", vehicleType: "تويوتا", model: "كامري", year: "2023", vin: "1HGBH41JXMN109186", color: "أبيض", mileage: "45,000", insurance: "ظفار للتأمين", claimNumber: "CLM-001", entryDate: "2024-03-25", technician: "عبدالله الغامدي", serviceType: "حادث", status: "تحت الإصلاح", totalCost: 1550, laborCost: 600, partsCost: 950, diagnosis: "تلف الصدام الأمامي والمصابيح" },
  { id: "WO-2024-002", customer: "خالد العتيبي", phone: "0559876543", plate: "ه و ز 5678", vehicleType: "هوندا", model: "أكورد", year: "2022", vin: "2HGBH41JXMN109187", color: "أسود", mileage: "62,000", insurance: "الأهلية للتأمين", claimNumber: "CLM-002", entryDate: "2024-03-26", technician: "يوسف القحطاني", serviceType: "صيانة", status: "بانتظار الموافقة", totalCost: 320, laborCost: 120, partsCost: 200, diagnosis: "صيانة دورية شاملة" },
  { id: "WO-2024-003", customer: "سعد الحربي", phone: "0553456789", plate: "ط ي ك 9012", vehicleType: "نيسان", model: "باترول", year: "2024", vin: "3HGBH41JXMN109188", color: "فضي", mileage: "12,000", insurance: "-", claimNumber: "-", entryDate: "2024-03-27", technician: "ماجد الدوسري", serviceType: "فحص", status: "جاهز للتسليم", totalCost: 50, laborCost: 50, partsCost: 0, diagnosis: "فحص قبل الشراء" },
  { id: "WO-2024-004", customer: "فهد السبيعي", phone: "0557654321", plate: "ل م ن 3456", vehicleType: "لكزس", model: "ES", year: "2023", vin: "4HGBH41JXMN109189", color: "رمادي", mileage: "28,000", insurance: "ميثاق للتأمين", claimNumber: "CLM-003", entryDate: "2024-03-27", technician: "عبدالله الغامدي", serviceType: "كهرباء", status: "تحت الفحص", totalCost: 280, laborCost: 180, partsCost: 100, diagnosis: "خلل في النظام الكهربائي" },
  { id: "WO-2024-005", customer: "محمد الشمري", phone: "0552345678", plate: "س ع ف 7890", vehicleType: "شيفروليه", model: "تاهو", year: "2024", vin: "5HGBH41JXMN109190", color: "أبيض لؤلؤي", mileage: "8,500", insurance: "الأمانة للتأمين", claimNumber: "CLM-004", entryDate: "2024-03-28", technician: "يوسف القحطاني", serviceType: "حادث", status: "تحت الإصلاح", totalCost: 2800, laborCost: 1100, partsCost: 1700, diagnosis: "تصادم جانبي - تلف باب وقاعدة" },
];

let cache: WorkOrder[] | null = null;
const listeners = new Set<() => void>();

function load(): WorkOrder[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw);
      return cache!;
    }
  } catch {}
  cache = [...seed];
  persist();
  return cache;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {}
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
// ☁️  Cloud sync layer — keeps localStorage cache fresh from
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
    displayNumber: r.order_number || undefined,
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

    // Merge: cloud takes precedence by id; keep local-only items (not yet synced) afterwards.
    const local = load();
    const cloudIds = new Set(cloudOrders.map((o) => o.id));
    const localOnly = local.filter((o) => !cloudIds.has(o.id));
    // Preserve local-only fields (extraExpenses, mileage, deposit) by merging onto cloud rows.
    // IMPORTANT: cloud is the source of truth for `photos` and `partsNeeded` so all devices
    // see the same data. Local-only photos (data: URLs from offline uploads) are kept ONLY
    // when the cloud row has no photos yet — they will be migrated to Storage shortly after.
    const localById = new Map(local.map((o) => [o.id, o]));
    const merged = cloudOrders.map((co) => {
      const lo = localById.get(co.id);
      if (!lo) return co;
      const cloudPhotos = Array.isArray(co.photos) ? co.photos : [];
      const localPhotos = Array.isArray(lo.photos) ? lo.photos : [];
      return {
        ...co,
        photos: cloudPhotos.length ? cloudPhotos : localPhotos,
        partsNeeded: co.partsNeeded?.length ? co.partsNeeded : lo.partsNeeded,
        extraExpenses: lo.extraExpenses,
        mileage: lo.mileage || co.mileage,
        trackPassword: lo.trackPassword,
        depositApplied: lo.depositApplied,
        linkedExpenseVoucherIds: lo.linkedExpenseVoucherIds,
      };
    });
    cache = [...merged, ...localOnly];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch {}
    listeners.forEach((l) => l());

    // Kick off background migration of legacy base64 photos to Storage (non-blocking).
    setTimeout(() => migrateLegacyPhotosInBackground(cache!), 1000);
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
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
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
  const plate = (o.plate || "").trim();
  const { extractPlateLetters, extractPlateDigits } = await import("@/lib/plateUtils");
  const L = extractPlateLetters(plate);
  const D = extractPlateDigits(plate);
  // Split-plate lookup via RPC (matches uniqueness rules)
  if (L && D) {
    try {
      const { data: hits } = await (supabase as any).rpc("find_vehicle_by_plate", {
        p_letters: L, p_digits: D, p_country: "OM",
      });
      const row = (hits as any[])?.[0];
      if (row?.id) return row.id;
    } catch (e) { console.warn("[ensureVeh:rpc]", e); }
  }
  const { data: created, error } = await supabase
    .from("vehicles").insert({
      tenant_id: tenantId,
      customer_id: customerId,
      plate_number: D || `UNK${Date.now()}`,
      plate_letters: L,
      plate_country: "OM",
      brand: o.vehicleType || "غير محدد",
      model: o.model || "غير محدد",
      year: o.year ? Number(o.year) || null : null,
      color: o.color || null,
      vin_number: o.vin || null,
    }).select("id").maybeSingle();
  if (error) {
    console.warn("[ensureVeh:insert]", error);
    // UNIQUE conflict → try one more lookup
    if (L && D) {
      const { data: hits } = await (supabase as any).rpc("find_vehicle_by_plate", { p_letters: L, p_digits: D, p_country: "OM" });
      const row = (hits as any[])?.[0];
      if (row?.id) return row.id;
    }
    return null;
  }
  return created?.id || null;
}

async function pushOrderToCloud(o: WorkOrder) {
  try {
    if (KNOWN_CLOUD_NUMBERS.has(o.id)) return; // already on cloud
    const ctx = await tenantContext(); if (!ctx) return;
    const custId = await ensureCustomer(ctx.tenantId, o.customer, o.phone); if (!custId) return;
    const vehId = await ensureVehicle(ctx.tenantId, custId, o); if (!vehId) return;
    const { error } = await supabase.from("job_orders").insert({
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
      notes: o.description || null,
      parts_needed: (o.partsNeeded || []) as any,
      work_items: (o.workItems || []) as any,
      photos: (o.photos || []) as any,
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
      .delete().eq("tenant_id", ctx.tenantId).eq("order_number", orderNumber);
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

