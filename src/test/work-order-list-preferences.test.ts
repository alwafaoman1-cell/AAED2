import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_ORDER_FILTERS,
  WORK_ORDER_FILTER_STORAGE_KEY,
  WORK_ORDER_FILTER_TTL_MS,
  clearWorkOrderListFilters,
  loadWorkOrderListFilters,
  saveWorkOrderListFilters,
} from "@/lib/workOrderListPreferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("work order list preferences", () => {
  it("restores the complete saved filter view within the TTL", () => {
    const storage = memoryStorage();
    const filters = { ...DEFAULT_WORK_ORDER_FILTERS, ownershipFilter: "insurance", serviceFilter: "حادث" };
    saveWorkOrderListFilters(filters, storage, 1_000);
    expect(loadWorkOrderListFilters(storage, 2_000)).toEqual(filters);
  });

  it("expires stale filters instead of surprising the employee later", () => {
    const storage = memoryStorage();
    saveWorkOrderListFilters({ ...DEFAULT_WORK_ORDER_FILTERS, searchTerm: "old" }, storage, 1_000);
    expect(loadWorkOrderListFilters(storage, 1_000 + WORK_ORDER_FILTER_TTL_MS + 1)).toEqual(DEFAULT_WORK_ORDER_FILTERS);
    expect(storage.getItem(WORK_ORDER_FILTER_STORAGE_KEY)).toBeNull();
  });

  it("clears the saved view explicitly", () => {
    const storage = memoryStorage();
    saveWorkOrderListFilters({ ...DEFAULT_WORK_ORDER_FILTERS, statusFilter: "ready" }, storage, 1_000);
    clearWorkOrderListFilters(storage);
    expect(loadWorkOrderListFilters(storage, 2_000)).toEqual(DEFAULT_WORK_ORDER_FILTERS);
  });
});
