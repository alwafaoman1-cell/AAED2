export const WORK_ORDER_FILTER_STORAGE_KEY = "work_orders_filter_view_v2";
export const WORK_ORDER_FILTER_TTL_MS = 12 * 60 * 60 * 1000;

export type WorkOrderPartsFilter = "all" | "needed" | "none";
export type WorkOrderAgeFilter = "all" | "under_7" | "7_29" | "30_plus";

export interface WorkOrderListFilters {
  searchTerm: string;
  statusFilter: string;
  ownershipFilter: string;
  technicianFilter: string;
  serviceFilter: string;
  insuranceFilter: string;
  partsFilter: WorkOrderPartsFilter;
  ageFilter: WorkOrderAgeFilter;
  entryFrom: string;
  entryTo: string;
  archiveFilter: string;
}

export const DEFAULT_WORK_ORDER_FILTERS: WorkOrderListFilters = {
  searchTerm: "",
  statusFilter: "all",
  ownershipFilter: "all",
  technicianFilter: "all",
  serviceFilter: "all",
  insuranceFilter: "all",
  partsFilter: "all",
  ageFilter: "all",
  entryFrom: "",
  entryTo: "",
  archiveFilter: "all",
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PersistedWorkOrderFilterView {
  savedAt: number;
  filters: Partial<WorkOrderListFilters>;
}

function browserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadWorkOrderListFilters(
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): WorkOrderListFilters {
  if (!storage) return { ...DEFAULT_WORK_ORDER_FILTERS };
  try {
    const raw = storage.getItem(WORK_ORDER_FILTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WORK_ORDER_FILTERS };
    const saved = JSON.parse(raw) as PersistedWorkOrderFilterView;
    if (!saved || typeof saved.savedAt !== "number" || now - saved.savedAt > WORK_ORDER_FILTER_TTL_MS) {
      storage.removeItem(WORK_ORDER_FILTER_STORAGE_KEY);
      return { ...DEFAULT_WORK_ORDER_FILTERS };
    }
    return { ...DEFAULT_WORK_ORDER_FILTERS, ...(saved.filters || {}) };
  } catch {
    storage.removeItem(WORK_ORDER_FILTER_STORAGE_KEY);
    return { ...DEFAULT_WORK_ORDER_FILTERS };
  }
}

export function saveWorkOrderListFilters(
  filters: WorkOrderListFilters,
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  storage.setItem(WORK_ORDER_FILTER_STORAGE_KEY, JSON.stringify({ savedAt: now, filters }));
}

export function clearWorkOrderListFilters(storage: StorageLike | null = browserStorage()): void {
  storage?.removeItem(WORK_ORDER_FILTER_STORAGE_KEY);
}
