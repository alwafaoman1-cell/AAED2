import { readCloudSetting, subscribeCloudSetting, subscribeCloudSettingsScopeChange, writeCloudSetting } from "./cloudSettings";
import type { InsuranceInspectionData } from "./insuranceInspectionPdf";
import { inspectionsStore } from "./inspectionsStore";
import { getCurrentTenantId } from "./cloud/createCloudStore";
import { supabase } from "@/integrations/supabase/client";

const KEY = "alwafa_insurance_inspections_v1";

type InspectionMap = Record<string, InsuranceInspectionData & { _savedAt?: string }>;
type Listener = () => void;

let cache: InspectionMap = {};
let confirmedReports: InspectionMap = {};
let bootstrapped = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => {
    try { listener(); } catch {}
  });
}

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  subscribeCloudSettingsScopeChange(() => {
    cache = {};
    confirmedReports = {};
    notify();
  });
  void readCloudSetting<InspectionMap>(KEY, {}).then((rows) => {
    cache = rows || {};
    notify();
  }).catch(() => undefined);
  subscribeCloudSetting<InspectionMap>(KEY, (rows) => {
    cache = rows || {};
    notify();
  });
}

function stripHeavy(data: InsuranceInspectionData & { _savedAt?: string }) {
  return { ...data, annotatedImages: [], annotatedImageDataUrl: undefined, photos: [] };
}

function reportFromDetails(details: unknown): InsuranceInspectionData | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const report = (details as Record<string, unknown>).insuranceInspectionReport;
  return report && typeof report === "object" && !Array.isArray(report)
    && typeof (report as Record<string, unknown>).reportNo === "string"
    ? report as InsuranceInspectionData : undefined;
}

function persist(): "ok" | "failed" {
  void writeCloudSetting(KEY, cache).catch((error) => {
    console.warn("[insuranceInspectionStore] Supabase write failed", error);
  });
  notify();
  return "ok";
}

export const insuranceInspectionStore = {
  prime(id: string, data: InsuranceInspectionData) {
    confirmedReports = { ...confirmedReports, [id]: data };
    notify();
  },
  async load(id: string): Promise<InsuranceInspectionData | undefined> {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return undefined;
    const { data, error } = await supabase.from("inspections")
      .select("details")
      .eq("tenant_id", tenantId)
      .eq("inspection_code", id)
      .eq("inspection_kind", "insurance")
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    const current = reportFromDetails(data.details);
    if (current) {
      this.prime(id, current);
      return current;
    }
    const legacy = await readCloudSetting<InspectionMap>(KEY, {});
    return legacy[id];
  },
  save(id: string, data: InsuranceInspectionData): "ok" | "trimmed" | "failed" {
    bootstrap();
    const stamped = { ...data, _savedAt: new Date().toISOString() };
    cache = { ...cache, [id]: stamped };
    const result = persist();
    if (result === "ok") return "ok";
    cache = { ...cache, [id]: stripHeavy(stamped) };
    return persist() === "ok" ? "trimmed" : "failed";
  },
  get(id: string): (InsuranceInspectionData & { _savedAt?: string }) | undefined {
    bootstrap();
    const record = inspectionsStore.getById(id);
    return reportFromDetails(record?.details) || confirmedReports[id] || cache[id];
  },
  remove(id: string) {
    bootstrap();
    const next = { ...cache };
    delete next[id];
    cache = next;
    persist();
  },
  subscribe(fn: Listener): () => void {
    bootstrap();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
