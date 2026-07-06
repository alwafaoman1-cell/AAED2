import { createStore } from "./createStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { customersStore } from "@/lib/customersStore";
import { ensureVehicleForCustomer, normalizeVehiclePlate, normalizeVin } from "@/lib/vehicleIdentity";
import { isUuid } from "@/lib/uuid";

export interface VehiclePhotoPair {
  id: string;
  workOrderId?: string;
  date: string;
  beforeUrl: string;
  afterUrl: string;
  caption?: string;
}

export interface Vehicle {
  id: string; // plate as id
  cloudId?: string;
  customerId?: string;
  plate: string;
  type: string;
  vin: string;
  owner: string;
  ownerPhone?: string;
  year?: string;
  color?: string;
  mileage?: string;
  coverImageUrl?: string;
  thumbnailUrl?: string;
  visits: number;
  lastVisit: string;
  totalSpent: number;
  notes?: string;
  /** Before/After photo pairs collected during repairs */
  photoPairs?: VehiclePhotoPair[];
  /** Public share settings (for /v/:plate page) */
  publicShareEnabled?: boolean;
  publicShareHideSensitive?: boolean;
  /** كلمة مرور لحماية الرابط العام — فارغة = استخدم رقم هاتف المالك تلقائياً */
  publicSharePassword?: string;
  /** أرشفة السيارة (تنتقل تلقائياً عند إغلاق/تسليم آخر أمر عمل) */
  archived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
}

/** أرشفة سيارة بشكل تلقائي مع سبب */
export function archiveVehicleByPlate(plate: string, reason = "إغلاق ملف السيارة") {
  const all = vehiclesStore.getAll();
  const v = all.find((x) => x.plate === plate || x.id === plate);
  if (!v || v.archived) return;
  vehiclesStore.update(v.id, {
    archived: true,
    archivedAt: new Date().toISOString(),
    archivedReason: reason,
  });
}

/** إعادة سيارة من الأرشيف إلى القائمة الفعّالة */
export function unarchiveVehicle(id: string) {
  vehiclesStore.update(id, { archived: false, archivedAt: undefined, archivedReason: undefined });
}

export const vehiclesStore = createStore<Vehicle>({
  key: "alwafa_vehicles_v2",
  storage: false,
  seed: [
    {
      id: "أ ب ج 1234", plate: "أ ب ج 1234", type: "تويوتا كامري 2023", vin: "1HGBH41JXMN109186",
      owner: "أحمد محمد", ownerPhone: "0551234567", year: "2023", color: "أبيض", mileage: "45,000",
      visits: 3, lastVisit: "2024-03-25", totalSpent: 22500,
      photoPairs: [
        {
          id: "PP-1",
          workOrderId: "WO-2024-001",
          date: "2024-03-25",
          beforeUrl: "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=900&q=80",
          afterUrl: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900&q=80",
          caption: "إصلاح الصدام الأمامي",
        },
      ],
    },
    {
      id: "ه و ز 5678", plate: "ه و ز 5678", type: "هوندا أكورد 2022", vin: "2HGBH41JXMN109187",
      owner: "خالد العتيبي", ownerPhone: "0559876543", year: "2022", color: "أسود", mileage: "62,000",
      visits: 1, lastVisit: "2024-03-26", totalSpent: 3200, photoPairs: [],
    },
    {
      id: "ط ي ك 9012", plate: "ط ي ك 9012", type: "نيسان باترول 2024", vin: "3HGBH41JXMN109188",
      owner: "سعد الحربي", ownerPhone: "0553456789", year: "2024", color: "فضي", mileage: "12,000",
      visits: 2, lastVisit: "2024-03-27", totalSpent: 8500, photoPairs: [],
    },
    {
      id: "ل م ن 3456", plate: "ل م ن 3456", type: "لكزس ES 2023", vin: "4HGBH41JXMN109189",
      owner: "فهد السبيعي", ownerPhone: "0557654321", year: "2023", color: "رمادي", mileage: "28,000",
      visits: 1, lastVisit: "2024-03-27", totalSpent: 2800, photoPairs: [],
    },
    {
      id: "س ع ف 7890", plate: "س ع ف 7890", type: "شيفروليه تاهو 2024", vin: "5HGBH41JXMN109190",
      owner: "محمد الشمري", ownerPhone: "0552345678", year: "2024", color: "أبيض لؤلؤي", mileage: "8,500",
      visits: 1, lastVisit: "2024-03-28", totalSpent: 28000, photoPairs: [],
    },
  ],
});

// ============================================================
// ☁️  Cloud sync layer — mirrors archive state with public.vehicles
// across devices and pulls in vehicles created by insurance flows.
// ============================================================
const normPlate = (p: string) => (p || "").trim().toLowerCase().replace(/\s+/g, " ");
const hasTemporaryOperationalId = (value: unknown) => /^(CUST|VEH|TEMP)-/i.test(String(value || "").trim());

let cloudBootstrapped = false;
let cloudFetchTimer: ReturnType<typeof setTimeout> | null = null;
let suppressCloudMutation = false;
// plate (normalized) → cloud row id
const KNOWN_CLOUD: Map<string, string> = new Map();

async function pushVehicleToCloud(v: Vehicle) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || !v.plate) return;
  const { extractPlateLetters, extractPlateDigits } = await import("@/lib/plateUtils");
  const plateLetters = extractPlateLetters(v.plate);
  const plateNumber = extractPlateDigits(v.plate);
  if (!plateNumber) return;

  let customerId: string | null = null;
  if (v.owner) {
    const { data: existing } = await supabase.from("customers").select("id")
      .eq("tenant_id", tenantId).ilike("name", v.owner.trim()).limit(1).maybeSingle();
    customerId = existing?.id || null;
    if (!customerId) {
      const { data: created, error } = await supabase.from("customers").insert({
        tenant_id: tenantId,
        name: v.owner.trim(),
        phone: v.ownerPhone || null,
      }).select("id").single();
      if (error) {
        console.warn("[vehiclesStore] customer create failed", error);
        return;
      }
      customerId = created.id;
    }
  }
  if (!customerId) return;

  const cloudId = KNOWN_CLOUD.get(normPlate(v.plate));
  const payload = {
    tenant_id: tenantId,
    customer_id: customerId,
    plate_letters: plateLetters || null,
    plate_number: plateNumber,
    plate_country: "OM",
    brand: v.type.split(" ")[0] || "غير محدد",
    model: v.type.split(" ").slice(1).join(" ") || "غير محدد",
    year: v.year ? Number(v.year) || null : null,
    color: v.color || null,
    mileage: v.mileage ? Number(String(v.mileage).replace(/\D/g, "")) || null : null,
    vin: v.vin || null,
    vin_number: v.vin || null,
    vehicle_cover_image_url: v.coverImageUrl || null,
    vehicle_thumbnail_url: v.thumbnailUrl || null,
    archived: !!v.archived,
    archived_at: v.archivedAt || null,
    archived_reason: v.archivedReason || null,
  };
  const query = cloudId
    ? (supabase.from("vehicles") as any).update(payload).eq("id", cloudId)
    : (supabase.from("vehicles") as any).upsert(payload, { onConflict: "tenant_id,plate_letters,plate_number,plate_country" });
  const { error } = await query;
  if (error) console.warn("[vehiclesStore] cloud write failed", error);
}

vehiclesStore.setMutationHandler((event) => {
  if (suppressCloudMutation) return;
  if (event.type === "remove") {
    const cloudId = KNOWN_CLOUD.get(normPlate(event.item.plate));
    if (cloudId) {
      void supabase.auth.getUser().then(({ data }) =>
        supabase.from("vehicles").update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_reason: "Soft delete vehicle",
          deleted_at: new Date().toISOString(),
          deleted_by: data.user?.id || null,
        } as any).eq("id", cloudId)
      );
    }
    return;
  }
  void saveVehicleToCloud(event.item, { updateCache: false }).catch((error) => {
    console.warn("[vehiclesStore] cloud write failed", error);
  });
});

export async function refreshVehiclesFromCloud(): Promise<void> {
  return fetchVehiclesFromCloud();
}

function buildFullPlate(r: any) {
  return [r.plate_letters, r.plate_number].filter(Boolean).join(" ").trim();
}

function rowToVehicle(r: any): Vehicle {
  const fullPlate = buildFullPlate(r);
  return {
    id: fullPlate || r.id,
    cloudId: r.id,
    customerId: r.customer_id || undefined,
    plate: fullPlate,
    type: [r.brand, r.model].filter(Boolean).join(" ") || "—",
    vin: r.vin_number || r.vin || "",
    owner: r.customers?.name || "",
    ownerPhone: r.customers?.phone || undefined,
    year: r.year ? String(r.year) : undefined,
    color: r.color || undefined,
    mileage: r.mileage ? String(r.mileage) : undefined,
    coverImageUrl: r.vehicle_cover_image_url || undefined,
    thumbnailUrl: r.vehicle_thumbnail_url || undefined,
    visits: 0,
    lastVisit: "",
    totalSpent: 0,
    archived: !!r.archived,
    archivedAt: r.archived_at || undefined,
    archivedReason: r.archived_reason || undefined,
  };
}

async function readVehicleById(tenantId: string, id: string): Promise<Vehicle> {
  const { data, error } = await (supabase.from("vehicles") as any)
    .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,mileage,vin,vin_number,vehicle_cover_image_url,vehicle_thumbnail_url,archived,archived_at,archived_reason,customers(name,phone)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || !isUuid(data.id)) throw new Error("تعذر تأكيد حفظ المركبة في Supabase");
  return rowToVehicle(data);
}

function putVehicleInCache(saved: Vehicle, previousIds: string[] = []) {
  suppressCloudMutation = true;
  try {
    const previousKeys = new Set(previousIds.filter(Boolean).map(normPlate));
    const existing = vehiclesStore.getAll().find((v) =>
      v.cloudId === saved.cloudId ||
      v.id === saved.id ||
      normPlate(v.plate) === normPlate(saved.plate) ||
      previousKeys.has(normPlate(v.id)) ||
      previousKeys.has(normPlate(v.plate)),
    );
    if (existing) {
      if (existing.id !== saved.id) vehiclesStore.remove(existing.id);
      else vehiclesStore.update(existing.id, saved);
    }
    if (!vehiclesStore.getAll().some((v) => v.id === saved.id)) vehiclesStore.add(saved);
  } finally {
    suppressCloudMutation = false;
  }
}

export async function saveVehicleToCloud(
  vehicle: Vehicle,
  options: {
    customerId?: string | null;
    previousPlate?: string | null;
    updateCache?: boolean;
    allowOwnershipConflict?: boolean;
  } = {},
): Promise<Vehicle> {
  if (hasTemporaryOperationalId(vehicle.id) || hasTemporaryOperationalId(vehicle.cloudId) || hasTemporaryOperationalId(vehicle.customerId) || hasTemporaryOperationalId(options.customerId)) {
    throw new Error("معرف مؤقت غير صالح لحفظ المركبة في Supabase");
  }
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  if (!vehicle.plate?.trim()) throw new Error("رقم اللوحة مطلوب قبل حفظ المركبة");
  if (!vehicle.owner?.trim() && !options.customerId) throw new Error("العميل مطلوب قبل حفظ المركبة");

  const customer = options.customerId && isUuid(options.customerId)
    ? { id: options.customerId, name: vehicle.owner || "", phone: vehicle.ownerPhone || "" }
    : await customersStore.ensureCloudCustomer({
        id: vehicle.customerId,
        name: vehicle.owner.trim(),
        phone: vehicle.ownerPhone || "",
      });
  if (!customer?.id || !isUuid(customer.id)) throw new Error("customer_id غير صالح لحفظ المركبة");

  const plate = normalizeVehiclePlate({ plate: vehicle.plate });
  const vin = normalizeVin(vehicle.vin);
  const [brand, ...modelParts] = (vehicle.type || "").trim().split(/\s+/).filter(Boolean);
  let targetId =
    (vehicle.cloudId && isUuid(vehicle.cloudId) ? vehicle.cloudId : null) ||
    (isUuid(vehicle.id) ? vehicle.id : null) ||
    KNOWN_CLOUD.get(normPlate(options.previousPlate || "")) ||
    KNOWN_CLOUD.get(normPlate(vehicle.plate));

  if (!targetId) {
    const resolved = await ensureVehicleForCustomer({
      customerId: customer.id,
      plate: vehicle.plate,
      vin,
      make: brand || vehicle.type || null,
      model: modelParts.join(" ") || null,
      year: vehicle.year || null,
      color: vehicle.color || null,
      allowVinCandidate: true,
    });
    if (resolved.ownershipConflict && !options.allowOwnershipConflict) {
      const owner = resolved.existing?.customer_name || "عميل آخر";
      throw new Error(`هذه المركبة مسجلة مسبقًا ومرتبطة بـ ${owner}. اختر المركبة الموجودة أو غيّر قرار الربط بوضوح.`);
    }
    targetId = resolved.vehicleId;
  }

  if (!targetId || !isUuid(targetId)) throw new Error("vehicle_id غير صالح");
  const { data: existingRow, error: existingError } = await supabase
    .from("vehicles")
    .select("id,customer_id")
    .eq("tenant_id", tenantId)
    .eq("id", targetId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingRow?.customer_id && existingRow.customer_id !== customer.id && !options.allowOwnershipConflict) {
    throw new Error("هذه المركبة مرتبطة بعميل آخر. اختر المركبة الموجودة أو أنشئ مركبة مختلفة.");
  }

  const payload = {
    customer_id: customer.id,
    plate_letters: plate.letters || null,
    plate_number: plate.digits || null,
    plate_country: plate.country || "OM",
    brand: brand || vehicle.type || null,
    model: modelParts.join(" ") || null,
    year: vehicle.year ? Number(vehicle.year) || null : null,
    color: vehicle.color || null,
    mileage: vehicle.mileage ? Number(String(vehicle.mileage).replace(/\D/g, "")) || null : null,
    vin: vin || null,
    vin_number: vin || null,
    vehicle_cover_image_url: vehicle.coverImageUrl || null,
    vehicle_thumbnail_url: vehicle.thumbnailUrl || null,
    archived: !!vehicle.archived,
    archived_at: vehicle.archivedAt || null,
    archived_reason: vehicle.archivedReason || null,
  };

  const { data, error } = await supabase
    .from("vehicles")
    .update(payload as any)
    .eq("tenant_id", tenantId)
    .eq("id", targetId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("تعذر حفظ المركبة في Supabase");

  const saved = await readVehicleById(tenantId, data.id);
  KNOWN_CLOUD.set(normPlate(saved.plate), data.id);
  if (options.updateCache !== false) {
    putVehicleInCache(saved, [vehicle.id, vehicle.plate, options.previousPlate || ""].filter(Boolean));
  }
  return saved;
}

export async function deleteVehicleFromCloud(vehicle: Vehicle, reason = "Soft delete vehicle"): Promise<Vehicle> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذر تحديد الورشة الحالية");
  const cloudId =
    (vehicle.cloudId && isUuid(vehicle.cloudId) ? vehicle.cloudId : null) ||
    (isUuid(vehicle.id) ? vehicle.id : null) ||
    KNOWN_CLOUD.get(normPlate(vehicle.plate));
  if (!cloudId || !isUuid(cloudId)) throw new Error("تعذر تحديد vehicle_id للحذف");
  const deletedAt = new Date().toISOString();
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("vehicles")
    .update({
      archived: true,
      archived_at: deletedAt,
      archived_reason: reason,
      deleted_at: deletedAt,
      deleted_by: userData.user?.id || null,
    } as any)
    .eq("tenant_id", tenantId)
    .eq("id", cloudId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("لم يتم حذف المركبة في Supabase");
  suppressCloudMutation = true;
  try {
    vehiclesStore.remove(vehicle.id);
  } finally {
    suppressCloudMutation = false;
  }
  KNOWN_CLOUD.delete(normPlate(vehicle.plate));
  return vehicle;
}

async function fetchVehiclesFromCloud(): Promise<void> {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return;
    const { data: rows, error } = await supabase
      .from("vehicles")
      .select("id,plate_number,plate_letters,plate_country,brand,model,year,color,mileage,vin,vin_number,vehicle_cover_image_url,vehicle_thumbnail_url,archived,archived_at,archived_reason,customer_id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .limit(5000);
    if (error || !rows) return;

    const custIds = Array.from(new Set(rows.map((r: any) => r.customer_id).filter(Boolean)));
    const custMap = new Map<string, { name: string; phone?: string }>();
    if (custIds.length) {
      const { data: cs } = await supabase
        .from("customers").select("id,name,phone").in("id", custIds);
      (cs || []).forEach((c: any) => custMap.set(c.id, { name: c.name, phone: c.phone || undefined }));
    }

    // Build canonical display plate from split fields
    const buildPlate = (r: any) => {
      const L = (r.plate_letters || "").trim();
      const D = (r.plate_number || "").trim();
      return [L, D].filter(Boolean).join(" ").trim();
    };

    KNOWN_CLOUD.clear();
    const local = vehiclesStore.getAll();
    const localByPlate = new Map(local.map((v) => [normPlate(v.plate), v]));

    suppressCloudMutation = true;
    for (const r of rows as any[]) {
      const fullPlate = buildPlate(r);
      const np = normPlate(fullPlate);
      if (!np) continue;
      KNOWN_CLOUD.set(np, r.id);
      const cust = r.customer_id ? custMap.get(r.customer_id) : undefined;
      const lo = localByPlate.get(np);
      const patch: Partial<Vehicle> = {
        cloudId: r.id,
        customerId: r.customer_id || undefined,
        owner: cust?.name || "",
        ownerPhone: cust?.phone,
        mileage: r.mileage ? String(r.mileage) : undefined,
        vin: r.vin_number || r.vin || "",
        archived: !!r.archived,
        archivedAt: r.archived_at || undefined,
        archivedReason: r.archived_reason || undefined,
        coverImageUrl: r.vehicle_cover_image_url || undefined,
        thumbnailUrl: r.vehicle_thumbnail_url || undefined,
      };
      if (lo) {
        if (
          lo.cloudId !== r.id ||
          lo.customerId !== r.customer_id ||
          !!lo.archived !== !!r.archived ||
          (lo.archivedAt || undefined) !== (r.archived_at || undefined) ||
          (lo.archivedReason || undefined) !== (r.archived_reason || undefined) ||
          (lo.coverImageUrl || undefined) !== (r.vehicle_cover_image_url || undefined) ||
          (lo.thumbnailUrl || undefined) !== (r.vehicle_thumbnail_url || undefined) ||
          lo.plate !== fullPlate
        ) {
          vehiclesStore.update(lo.id, { ...patch, plate: fullPlate });
        }
      } else {
        vehiclesStore.add({
          id: fullPlate || r.id,
          cloudId: r.id,
          customerId: r.customer_id || undefined,
          plate: fullPlate,
          type: [r.brand, r.model].filter(Boolean).join(" ") || "—",
          vin: r.vin_number || r.vin || "",
          owner: cust?.name || "",
          ownerPhone: cust?.phone,
          year: r.year ? String(r.year) : undefined,
          color: r.color || undefined,
          mileage: r.mileage ? String(r.mileage) : undefined,
          coverImageUrl: r.vehicle_cover_image_url || undefined,
          thumbnailUrl: r.vehicle_thumbnail_url || undefined,
          visits: 0,
          lastVisit: "",
          totalSpent: 0,
          ...patch,
        });
      }
    }
    suppressCloudMutation = false;
  } catch (e) {
    suppressCloudMutation = false;
    console.warn("[vehiclesStore] cloud fetch failed:", e);
  }
}

function scheduleVehiclesFetch(delay = 200) {
  if (cloudFetchTimer) clearTimeout(cloudFetchTimer);
  cloudFetchTimer = setTimeout(() => { cloudFetchTimer = null; fetchVehiclesFromCloud(); }, delay);
}

function ensureVehiclesCloudSync() {
  if (cloudBootstrapped) return;
  cloudBootstrapped = true;
  scheduleVehiclesFetch(0);
  try {
    supabase
      .channel(`vehicles_cloud_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => scheduleVehiclesFetch(200))
      .subscribe();
  } catch (e) {
    console.warn("[vehiclesStore] realtime subscribe failed:", e);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => scheduleVehiclesFetch(50));
    window.addEventListener("online", () => scheduleVehiclesFetch(50));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleVehiclesFetch(50);
    });
  }
}

// ---------- push archive state to cloud ----------
async function pushArchiveStateToCloud(v: Vehicle) {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return;
    const np = normPlate(v.plate);
    if (!np) return;
    const cloudId = KNOWN_CLOUD.get(np);
    const payload = {
      archived: !!v.archived,
      archived_at: v.archived ? (v.archivedAt || new Date().toISOString()) : null,
      archived_reason: v.archived ? (v.archivedReason || null) : null,
    };
    if (cloudId) {
      const { error } = await supabase.from("vehicles").update(payload).eq("id", cloudId);
      if (error) console.warn("[pushArchiveStateToCloud]", error);
    } else {
      // No matching cloud row — try by split plate within tenant.
      const { extractPlateLetters, extractPlateDigits } = await import("@/lib/plateUtils");
      const L = extractPlateLetters(v.plate);
      const D = extractPlateDigits(v.plate);
      const { error } = await supabase.from("vehicles")
        .update(payload).eq("tenant_id", tenantId)
        .eq("plate_letters", L).eq("plate_number", D);
      if (error) console.warn("[pushArchiveStateToCloud:byPlate]", error);
    }
  } catch (e) {
    console.warn("[pushArchiveStateToCloud] exception", e);
  }
}

// Diff listener — push archive changes only.
let _lastVehSnap = new Map(vehiclesStore.getAll().map((v) => [v.id, v]));
vehiclesStore.subscribe(() => {
  const current = vehiclesStore.getAll();
  const currMap = new Map(current.map((v) => [v.id, v]));
  for (const v of current) {
    const prev = _lastVehSnap.get(v.id);
    if (!prev) continue;
    if (!!prev.archived !== !!v.archived ||
        (prev.archivedAt || "") !== (v.archivedAt || "") ||
        (prev.archivedReason || "") !== (v.archivedReason || "")) {
      pushArchiveStateToCloud(v);
    }
  }
  _lastVehSnap = currMap;
});

if (typeof window !== "undefined") {
  setTimeout(() => ensureVehiclesCloudSync(), 800);
  let lastUid: string | null = null;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (uid !== lastUid) {
      lastUid = uid;
      KNOWN_CLOUD.clear();
      if (uid) scheduleVehiclesFetch(100);
    }
  });
}
