import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { subscribeCloudSettingsScopeChange } from "@/lib/cloudSettings";

export interface InspectionRecord {
  id: string;
  cloudId?: string;
  jobOrderId?: string | null;
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

export type InspectionSummary = Omit<InspectionRecord, "details" | "aiAnalysis">;

// Never include photos, details or AI output in a list/count request.
const SUMMARY_COLUMNS = "id,inspection_code,job_order_id,customer_name,vehicle_summary,inspection_date,created_at,damage_type,photo_count,status,inspection_kind,plate_number,overall_rating,job_order:job_orders(order_number)";
const DETAIL_COLUMNS = "*,job_order:job_orders(order_number)";
const PAGE_SIZE = 200;

export function normalizePlate(value?: string): string {
  return (value || "").replace(/[\s\-_]+/g, "").trim().toLowerCase();
}

export function formatDamageReportNumber(sequence: number): string {
  return `DR-${String(Math.max(1, Math.trunc(sequence || 1))).padStart(5, "0")}`;
}

export function parseDamageReportSequence(value?: string | null): number | null {
  const match = String(value || "").trim().match(/^DR-(\d{5})$/i);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
}

export function getNextDamageReportNumberFromRecords(records: Array<{ id?: string | null; inspection_code?: string | null; kind?: string | null; inspection_kind?: string | null }>): string {
  let maxSequence = 0;
  for (const record of records) {
    const sequence = parseDamageReportSequence(record.inspection_code || record.id);
    if (!sequence) continue;
    maxSequence = Math.max(maxSequence, sequence);
  }
  return formatDamageReportNumber(maxSequence + 1);
}

let cache: InspectionSummary[] = [];
const detailsCache = new Map<string, InspectionRecord>();
const detailRevisions = new Map<string, number>();
let started = false;
let generation = 0;
let activeTenant: string | null = null;
let pendingRefresh: Promise<void> | null = null;
let loadState: { loading: boolean; ready: boolean; error: string | null } = { loading: false, ready: false, error: null };
const listeners = new Set<() => void>();
subscribeCloudSettingsScopeChange(() => {
  generation += 1;
  cache = [];
  detailsCache.clear();
  detailRevisions.clear();
  started = false;
  activeTenant = null;
  pendingRefresh = null;
  loadState = { loading: false, ready: false, error: null };
  emit();
});

function emit() {
  listeners.forEach((listener) => listener());
}

function summaryOf(record: InspectionRecord): InspectionSummary {
  const { details: _details, aiAnalysis: _aiAnalysis, ...summary } = record;
  return summary;
}

function mapRow(row: any, includeDetails = false): InspectionRecord {
  return {
    id: row.inspection_code || row.id,
    cloudId: row.id,
    jobOrderId: row.job_order_id,
    workOrder: row.job_order?.order_number || "—",
    customer: row.customer_name || "",
    vehicle: row.vehicle_summary || "",
    date: (row.inspection_date || row.created_at || "").slice(0, 10),
    damageType: row.damage_type || "فحص عام",
    photos: Number(row.photo_count ?? (Array.isArray(row.photos) ? row.photos.length : 0)),
    status: row.status || "قيد الفحص",
    kind: row.inspection_kind || "general",
    plate: row.plate_number || "",
    overallRating: row.overall_rating || undefined,
    ...(includeDetails ? { details: row.details || {}, aiAnalysis: row.ai_analysis || undefined } : {}),
  };
}

function assertScope(expected: number) {
  if (generation !== expected) throw new Error("INSPECTION_SESSION_CHANGED");
}

async function context(expectedTenant?: string) {
  const scope = generation;
  const tenant = await getCurrentTenantId();
  assertScope(scope);
  if (!tenant || (expectedTenant && tenant !== expectedTenant)) throw new Error("INSPECTION_TENANT_UNAVAILABLE");
  activeTenant = tenant;
  return { tenant, scope };
}

// Exact counts plus a stable unique ordering detect truncation/capped responses.
// Do not publish partial pages as a complete list or return misleading zeroes.
async function readProjectedPages(makeQuery: () => any, scope: number): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    assertScope(scope);
    const { data, count, error } = await makeQuery().order("id", { ascending: true }).range(rows.length, rows.length + PAGE_SIZE - 1);
    assertScope(scope);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || (total !== undefined && count !== total)) {
      throw new Error("INSPECTION_INCOMPLETE_RESPONSE");
    }
    total = count;
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error("INSPECTION_INCOMPLETE_RESPONSE");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > count || (!data.length && rows.length < count)) throw new Error("INSPECTION_INCOMPLETE_RESPONSE");
  } while (rows.length < total!);
  return rows;
}

function refresh(): Promise<void> {
  if (pendingRefresh) return pendingRefresh;
  const scope = generation;
  started = true;
  loadState = { ...loadState, loading: true, error: null };
  const request = (async () => {
    try {
      const ctx = await context();
      const rows = await readProjectedPages(() => (supabase.from("inspections") as any)
        .select(SUMMARY_COLUMNS, { count: "exact" }).eq("tenant_id", ctx.tenant), ctx.scope);
      assertScope(scope);
      cache = rows.map((row) => mapRow(row)).sort((a, b) => b.date.localeCompare(a.date));
      // A summary refresh must not erase an opened report's full payload.
      const ids = new Set(cache.map((record) => record.id));
      for (const id of detailsCache.keys()) if (!ids.has(id)) detailsCache.delete(id);
      loadState = { loading: false, ready: true, error: null };
    } catch (error) {
      if (scope === generation) loadState = { ...loadState, loading: false, error: error instanceof Error ? error.message : String((error as any)?.message || error) };
      throw error;
    } finally {
      if (scope === generation) emit();
    }
  })();
  pendingRefresh = request;
  void request.finally(() => { if (pendingRefresh === request) pendingRefresh = null; }).catch(() => undefined);
  emit();
  return request;
}

/** Linked report cards need only summaries for this exact persisted work order. */
export async function fetchInspectionSummariesForOrder(tenantId: string, jobOrderId: string): Promise<InspectionSummary[]> {
  const ctx = await context(tenantId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobOrderId)) {
    throw new Error("INSPECTION_WORK_ORDER_ID_UNAVAILABLE");
  }
  const rows = await readProjectedPages(() => (supabase.from("inspections") as any)
    .select(SUMMARY_COLUMNS, { count: "exact" }).eq("tenant_id", ctx.tenant).eq("job_order_id", jobOrderId), ctx.scope);
  return rows.map((row) => mapRow(row)).sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchInspectionCountsForOrders(tenantId: string, orders: readonly { id: string; cloudId?: string }[]): Promise<Record<string, number>> {
  const ctx = await context(tenantId);
  const counts: Record<string, number> = {};
  const byCloudId = new Map<string, string[]>();
  for (const order of orders) {
    const cloudId = (order.cloudId || order.id).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cloudId)) {
      throw new Error("INSPECTION_WORK_ORDER_ID_UNAVAILABLE");
    }
    byCloudId.set(cloudId, [...(byCloudId.get(cloudId) || []), order.id]);
    counts[order.id] = 0;
  }
  const ids = [...byCloudId.keys()];
  // Bound the URL as well as the payload; never scan the tenant for list badges.
  for (let offset = 0; offset < ids.length; offset += 50) {
    const rows = await readProjectedPages(() => (supabase.from("inspections") as any)
      .select("id,job_order_id", { count: "exact" })
      .eq("tenant_id", ctx.tenant).in("job_order_id", ids.slice(offset, offset + 50)), ctx.scope);
    for (const row of rows) {
      const linked = byCloudId.get(row.job_order_id);
      if (!linked) throw new Error("INSPECTION_INCOMPLETE_RESPONSE");
      linked.forEach((id) => { counts[id] += 1; });
    }
  }
  assertScope(ctx.scope);
  return counts;
}

function publishDetail(record: InspectionRecord) {
  detailsCache.delete(record.id);
  detailsCache.set(record.id, record);
  // Only explicitly opened records are kept, not an unbounded image archive.
  if (detailsCache.size > 5) detailsCache.delete(detailsCache.keys().next().value!);
  cache = [summaryOf(record), ...cache.filter((item) => item.id !== record.id)];
  emit();
}

async function loadById(id: string): Promise<InspectionRecord | undefined> {
  const ctx = await context();
  const revision = detailRevisions.get(id);
  let query = (supabase.from("inspections") as any).select(DETAIL_COLUMNS).eq("tenant_id", ctx.tenant);
  const { data, error } = await query.eq("inspection_code", id).maybeSingle();
  assertScope(ctx.scope);
  if (error) throw error;
  // Legacy uncoded rows are addressed by their UUID, not by a report number.
  let row = data;
  if (!row && /^[0-9a-f-]{36}$/i.test(id)) {
    query = (supabase.from("inspections") as any).select(DETAIL_COLUMNS).eq("tenant_id", ctx.tenant);
    const result = await query.eq("id", id).maybeSingle();
    assertScope(ctx.scope);
    if (result.error) throw result.error;
    row = result.data;
  }
  if (detailRevisions.get(id) !== revision) throw new Error("INSPECTION_CHANGED_DURING_LOAD");
  if (!row) {
    detailsCache.delete(id);
    return undefined;
  }
  const record = mapRow(row, true);
  publishDetail(record);
  return record;
}

async function resolveJobOrderId(orderNumber: string, currentTenant: string) {
  if (!orderNumber || orderNumber === "—") return null;
  const { data, error } = await supabase.from("job_orders")
    .select("id")
    .eq("tenant_id", currentTenant)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("INSPECTION_WORK_ORDER_NOT_FOUND");
  return data.id;
}

async function saveToCloud(record: InspectionRecord, updateOnly = false): Promise<InspectionRecord> {
  const ctx = await context();
  const jobOrderId = record.jobOrderId !== undefined ? record.jobOrderId : await resolveJobOrderId(record.workOrder, ctx.tenant);
  assertScope(ctx.scope);
  const payload = {
    tenant_id: ctx.tenant,
    ...(updateOnly ? {} : { inspection_code: record.id }),
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
    // Omitted heavy fields are NOT empty fields. Never erase them from summaries.
    ...(record.details !== undefined ? { details: record.details } : {}),
    ...(record.aiAnalysis !== undefined ? { ai_analysis: record.aiAnalysis } : {}),
  };
  const table = supabase.from("inspections") as any;
  const query = updateOnly
    ? table.update(payload).eq("tenant_id", ctx.tenant).eq(record.cloudId ? "id" : "inspection_code", record.cloudId || record.id)
    : table.upsert(payload, { onConflict: "tenant_id,inspection_code" });
  const { data, error } = await query.select(DETAIL_COLUMNS).single();
  assertScope(ctx.scope);
  if (error) throw error;
  if (!data) throw new Error("INSPECTION_SAVE_NOT_CONFIRMED");
  const saved = mapRow(data, true);
  publishDetail(saved);
  return saved;
}

async function removeConfirmed(id: string): Promise<InspectionRecord> {
  const ctx = await context();
  const record = await loadById(id);
  assertScope(ctx.scope);
  if (!record) throw new Error("INSPECTION_NOT_FOUND");
  const { data, error } = await (supabase.from("inspections") as any)
    .delete()
    .eq("tenant_id", ctx.tenant)
    .eq(record.cloudId ? "id" : "inspection_code", record.cloudId || id).select("id");
  assertScope(ctx.scope);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) throw new Error("INSPECTION_DELETE_NOT_CONFIRMED");
  cache = cache.filter((item) => item.id !== record.id);
  detailsCache.delete(record.id);
  emit();
  return record;
}

async function updateConfirmed(id: string, patch: Partial<InspectionRecord>): Promise<InspectionRecord> {
  const scope = generation;
  const current = await loadById(id);
  assertScope(scope);
  if (!current) throw new Error("INSPECTION_NOT_FOUND");
  return saveToCloud({ ...current, ...patch, id,
    // Keep the confirmed FK even if an inaccessible/missing join has no label.
    // Resolve a new link only when the user actually changes the order number.
    jobOrderId: patch.workOrder !== undefined && patch.workOrder !== current.workOrder ? undefined : current.jobOrderId,
    details: { ...current.details, ...patch.details },
    aiAnalysis: patch.aiAnalysis ?? current.aiAnalysis,
  }, true);
}

function ensureStarted() {
  if (started) return;
  started = true;
  void refresh().catch((error) => console.warn("[inspectionsStore] refresh failed", error));
}

export function applyInspectionRealtimeChange(payload: {
  eventType?: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}) {
  const eventType = String(payload.eventType || "").toUpperCase();
  const next = payload.new || {};
  const previous = payload.old || {};
  const tenant = next.tenant_id || previous.tenant_id;
  if (!activeTenant || (tenant && tenant !== activeTenant)) return;
  const code = String((next as any).inspection_code || (previous as any).inspection_code || "");
  const rowId = String((next as any).id || (previous as any).id || "");
  for (const identity of new Set([code, rowId].filter(Boolean))) {
    detailRevisions.set(identity, (detailRevisions.get(identity) || 0) + 1);
  }

  if (eventType === "DELETE") {
    const before = cache.length;
    cache = cache.filter((record) => record.id !== code && record.id !== rowId && record.cloudId !== rowId);
    for (const [id, record] of detailsCache) if (id === code || id === rowId || record.cloudId === rowId) detailsCache.delete(id);
    if (cache.length !== before) emit();
    return;
  }
  if (!code && !rowId) return;
  // Realtime rows do not contain the joined order number. Keep the existing link
  // only if the foreign key did not change; a relink requires a summary refresh.
  const current = cache.find((record) => record.id === (code || rowId));
  const mapped = mapRow(next);
  if (current && next.job_order_id === previous.job_order_id) mapped.workOrder = current.workOrder;
  detailsCache.delete(mapped.id);
  cache = [summaryOf(mapped), ...cache.filter((record) => record.id !== mapped.id)];
  emit();
  if (started && (!current || next.job_order_id !== previous.job_order_id)) {
    void refresh().catch((error) => console.warn("[inspectionsStore] refresh failed", error));
  }
}

export function findInspectionByPlate(plate: string, kind: "general" | "insurance" = "general"): InspectionRecord | undefined {
  const normalized = normalizePlate(plate);
  if (!normalized) return undefined;
  return inspectionsStore.getAll().find((inspection) =>
    (inspection.kind || "general") === kind
    && normalizePlate(inspection.plate || inspection.vehicle) === normalized
  );
}

export async function getNextDamageReportNumber(): Promise<string> {
  const currentTenant = await getCurrentTenantId();
  if (!currentTenant) {
    return getNextDamageReportNumberFromRecords(cache);
  }
  const { data, error } = await (supabase.from("inspections") as any)
    .select("inspection_code,inspection_kind")
    .eq("tenant_id", currentTenant)
    // Five-character LIKE suffix excludes legacy six-digit timestamp codes.
    .like("inspection_code", "DR-_____")
    .order("inspection_code", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[inspectionsStore] damage report number lookup failed", error);
    return getNextDamageReportNumberFromRecords(cache);
  }
  return getNextDamageReportNumberFromRecords(data || []);
}

export const inspectionsStore = {
  getAll() {
    ensureStarted();
    return [...cache];
  },
  getById(id: string): InspectionRecord | undefined {
    return detailsCache.get(id) || [...detailsCache.values()].find((record) => record.cloudId === id)
      || cache.find((record) => record.id === id || record.cloudId === id);
  },
  loadById,
  getLoadState() { return loadState; },
  add(record: InspectionRecord) {
    publishDetail(record);
    void saveToCloud(record).catch((error) => console.warn("[inspectionsStore] save failed", error));
  },
  update(id: string, patch: Partial<InspectionRecord>) {
    // Legacy form callers remain synchronous; the confirmed path hydrates before
    // merging so a summary-only edit can never replace details with an empty object.
    void updateConfirmed(id, patch).catch((error) => console.warn("[inspectionsStore] save failed", error));
  },
  updateConfirmed,
  remove: removeConfirmed,
  restore(record: InspectionRecord) {
    this.add(record);
  },
  subscribe(listener: () => void, options: { loadSummaries?: boolean } = {}) {
    listeners.add(listener);
    if (options.loadSummaries !== false) ensureStarted();
    return () => { listeners.delete(listener); };
  },
  refresh,
};
