// Stores the full Al-Madina-style insurance inspection payload (incl. annotated images)
// keyed by report id, so the dedicated report page can rebuild the exact PDF view.
import type { InsuranceInspectionData } from "./insuranceInspectionPdf";

const KEY = "alwafa_insurance_inspections_v1";

type Map = Record<string, InsuranceInspectionData & { _savedAt?: string }>;

function read(): Map {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Map; } catch { return {}; }
}

/** Try to persist; returns true if write succeeded, false on quota / other errors. */
function tryWrite(m: Map): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
    return true;
  } catch (e) {
    console.warn("[insuranceInspectionStore] localStorage write failed:", e);
    return false;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() { listeners.forEach(l => { try { l(); } catch { /* ignore */ } }); }

// Cross-tab sync via storage event
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === KEY) notify(); });
}

/** Strip heavy data-URL fields so a quota-bound write can still preserve the text data. */
function stripHeavy(d: InsuranceInspectionData & { _savedAt?: string }) {
  return { ...d, annotatedImages: [], annotatedImageDataUrl: undefined, photos: [] };
}

export const insuranceInspectionStore = {
  /**
   * Saves the full inspection payload.
   * Returns:
   *  - "ok"         — full payload (incl. images) persisted
   *  - "trimmed"    — quota hit; images dropped but text/sections/meta saved
   *  - "failed"     — nothing could be persisted
   */
  save(id: string, data: InsuranceInspectionData): "ok" | "trimmed" | "failed" {
    const m = read();
    const stamped = { ...data, _savedAt: new Date().toISOString() };
    m[id] = stamped;
    if (tryWrite(m)) { notify(); return "ok"; }

    // Quota exceeded — retry with images stripped so at least the data survives.
    m[id] = stripHeavy(stamped);
    if (tryWrite(m)) {
      notify();
      console.warn(`[insuranceInspectionStore] Quota exceeded — saved ${id} without images.`);
      return "trimmed";
    }

    // Last resort: drop the new record entirely so we don't corrupt other reports.
    delete m[id];
    tryWrite(m);
    return "failed";
  },
  get(id: string): (InsuranceInspectionData & { _savedAt?: string }) | undefined {
    return read()[id];
  },
  remove(id: string) {
    const m = read();
    delete m[id];
    tryWrite(m);
    notify();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
