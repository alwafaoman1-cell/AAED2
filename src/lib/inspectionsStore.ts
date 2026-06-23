import { supabase } from "@/integrations/supabase/client";

export interface InspectionRecord {
  id: string;
  workOrder: string;
  customer: string;
  vehicle: string;
  date: string;
  damageType: string;
  photos: number;
  status: string;
  kind?: "general" | "insurance";
  plate?: string;
  overallRating?: string;
  details?: Record<string, unknown>;
  aiAnalysis?: Record<string, unknown>;
}

export function normalizePlate(value?: string): string {
  return (value || "").replace(/[\s\-_]+/g, "").trim().toLowerCase();
}

let cache: InspectionRecord[] = [];
let started = false;
let tenantId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

async function getTenantId() {
  if (tenantId) return tenantId;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("profiles").select("tenant_id").eq("user_id", auth.user.id).maybeSingle();
  tenantId = data?.tenant_id || null;
  return tenantId;
}

function mapRow(row: any): InspectionRecord {
  return {
    id: row.inspection_code || row.id,
    workOrder: row.job_order?.order_number || "—",
    customer: row.customer_name || "",
    vehicle: row.vehicle_summary || "",
    date: (row.inspection_date || row.created_at || "").slice(0, 10),
    damageType: row.damage_type || "فحص عام",
    photos: Array.isArray(row.photos) ? row.photos.length : Number(row.photo_count || 0),
    status: row.status || "قيد الفحص",
    kind: row.inspection_kind || "general",
    plate: row.plate_number || "",
    overallRating: row.overall_rating || undefined,
    details: row.details || {},
    aiAnalysis: row.ai_analysis || undefined,
  };
}

async function refresh() {
  const currentTenant = await getTenantId();
  if (!currentTenant) return;
  const { data, error } = await (supabase.from("inspections") as any)
    .select("*,job_order:job_orders(order_number)")
    .eq("tenant_id", currentTenant)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.warn("[inspectionsStore] refresh failed", error);
    return;
  }
  cache = (data || []).map(mapRow);
  emit();
}

async function resolveJobOrderId(orderNumber: string) {
  if (!orderNumber || orderNumber === "—") return null;
  const currentTenant = await getTenantId();
  if (!currentTenant) return null;
  const { data } = await supabase.from("job_orders")
    .select("id")
    .eq("tenant_id", currentTenant)
    .eq("order_number", orderNumber)
    .maybeSingle();
  return data?.id || null;
}

async function saveToCloud(record: InspectionRecord) {
  const currentTenant = await getTenantId();
  if (!currentTenant) return;
  const jobOrderId = await resolveJobOrderId(record.workOrder);
  const { error } = await (supabase.from("inspections") as any).upsert({
    tenant_id: currentTenant,
    inspection_code: record.id,
    job_order_id: jobOrderId,
    customer_name: record.customer,
    vehicle_summary: record.vehicle,
    plate_number: record.plate || null,
    inspection_date: record.date || new Date().toISOString().slice(0, 10),
    damage_type: record.damageType || null,
    photo_count: record.photos || 0,
    status: record.status || "قيد الفحص",
    inspection_kind: record.kind || "general",
    overall_rating: record.overallRating || null,
    details: record.details || {},
    ai_analysis: record.aiAnalysis || null,
  }, { onConflict: "tenant_id,inspection_code" });
  if (error) console.warn("[inspectionsStore] save failed", error);
}

async function removeFromCloud(id: string) {
  const currentTenant = await getTenantId();
  if (!currentTenant) return;
  const { error } = await (supabase.from("inspections") as any)
    .delete()
    .eq("tenant_id", currentTenant)
    .eq("inspection_code", id);
  if (error) console.warn("[inspectionsStore] delete failed", error);
}

function ensureStarted() {
  if (started) return;
  started = true;
  void refresh();
  void getTenantId().then((currentTenant) => {
    if (!currentTenant) return;
    supabase
      .channel(`inspections:${currentTenant}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "inspections",
        filter: `tenant_id=eq.${currentTenant}`,
      }, () => void refresh())
      .subscribe();
  });
}

export function findInspectionByPlate(plate: string, kind: "general" | "insurance" = "general"): InspectionRecord | undefined {
  const normalized = normalizePlate(plate);
  if (!normalized) return undefined;
  return inspectionsStore.getAll().find((inspection) =>
    (inspection.kind || "general") === kind
    && normalizePlate(inspection.plate || inspection.vehicle) === normalized
  );
}

export const inspectionsStore = {
  getAll() {
    ensureStarted();
    return [...cache];
  },
  getById(id: string) {
    ensureStarted();
    return cache.find((record) => record.id === id);
  },
  add(record: InspectionRecord) {
    cache = [record, ...cache.filter((item) => item.id !== record.id)];
    emit();
    void saveToCloud(record);
  },
  update(id: string, patch: Partial<InspectionRecord>) {
    const current = cache.find((record) => record.id === id);
    if (!current) return;
    const updated = { ...current, ...patch, id };
    cache = cache.map((record) => record.id === id ? updated : record);
    emit();
    void saveToCloud(updated);
  },
  remove(id: string) {
    const current = cache.find((record) => record.id === id);
    if (!current) return undefined;
    cache = cache.filter((record) => record.id !== id);
    emit();
    void removeFromCloud(id);
    return current;
  },
  restore(record: InspectionRecord) {
    this.add(record);
  },
  subscribe(listener: () => void) {
    ensureStarted();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  refresh,
};
