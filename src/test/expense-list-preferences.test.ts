import { describe, expect, it } from "vitest";
import {
  EXPENSE_FILTER_TTL_MS,
  clearExpenseListFilters,
  loadExpenseListFilters,
  saveExpenseListFilters,
} from "@/lib/expenses/expenseListPreferences";

const allowed = ["month", "supplier", "supplier_invoice_number", "scope"];

function storage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
    records,
  };
}

describe("expense list filter preferences", () => {
  it("saves only allowed filters and isolates users and tenants", () => {
    const store = storage();
    const filters = new URLSearchParams("month=2026-07&supplier=ACME&supplier_invoice_number=A-11&secret=not-saved");
    saveExpenseListFilters("tenant-a:user-1", filters, allowed, store, 1000);
    expect(loadExpenseListFilters("tenant-a:user-1", allowed, store, 1001)?.toString())
      .toBe("month=2026-07&supplier=ACME&supplier_invoice_number=A-11");
    expect(loadExpenseListFilters("tenant-a:user-2", allowed, store, 1001)).toBeNull();
    expect(loadExpenseListFilters("tenant-b:user-1", allowed, store, 1001)).toBeNull();
  });

  it("expires after 12 hours and clears explicitly", () => {
    const store = storage();
    saveExpenseListFilters("tenant:user", new URLSearchParams("scope=operating"), allowed, store, 1000);
    expect(loadExpenseListFilters("tenant:user", allowed, store, 1000 + EXPENSE_FILTER_TTL_MS)?.get("scope"))
      .toBe("operating");
    expect(loadExpenseListFilters("tenant:user", allowed, store, 1001 + EXPENSE_FILTER_TTL_MS)).toBeNull();
    saveExpenseListFilters("tenant:user", new URLSearchParams("scope=work_order"), allowed, store, 2000);
    clearExpenseListFilters("tenant:user", store);
    expect(loadExpenseListFilters("tenant:user", allowed, store, 2001)).toBeNull();
  });

  it("ignores corrupt, future-dated and unavailable storage", () => {
    const store = storage();
    store.setItem("expense_management_filters_v1:tenant:user", "bad json");
    expect(loadExpenseListFilters("tenant:user", allowed, store, 1000)).toBeNull();
    saveExpenseListFilters("tenant:user", new URLSearchParams("month=all"), allowed, store, 2000);
    expect(loadExpenseListFilters("tenant:user", allowed, store, 1000)).toBeNull();
    expect(loadExpenseListFilters("tenant:user", allowed, null, 1000)).toBeNull();
    expect(() => saveExpenseListFilters("tenant:user", new URLSearchParams(), allowed, null)).not.toThrow();
  });
});
