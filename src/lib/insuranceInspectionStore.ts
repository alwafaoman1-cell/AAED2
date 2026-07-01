import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";
import type { InsuranceInspectionData } from "./insuranceInspectionPdf";

const KEY = "alwafa_insurance_inspections_v1";

type InspectionMap = Record<string, InsuranceInspectionData & { _savedAt?: string }>;
type Listener = () => void;

let cache: InspectionMap = {};
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

function persist(): "ok" | "failed" {
  void writeCloudSetting(KEY, cache).catch((error) => {
    console.warn("[insuranceInspectionStore] Supabase write failed", error);
  });
  notify();
  return "ok";
}

export const insuranceInspectionStore = {
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
    return cache[id];
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
