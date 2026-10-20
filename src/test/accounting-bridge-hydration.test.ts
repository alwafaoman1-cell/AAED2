import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hydrated: false,
  scopeVersion: 1,
  expenseListener: null as null | (() => void),
  resolveJournal: null as null | (() => void),
  postExpense: vi.fn(),
  refreshJournal: vi.fn(),
}));

vi.mock("@/lib/expensesStore", () => ({
  expensesStore: {
    isHydrated: () => state.hydrated,
    getAll: () => [{ id: "expense-1", voucherNumber: "PAY-1", date: "2026-10-19", amount: 5, categoryName: "Workshop", paymentMethod: "cash" }],
    subscribe: (listener: () => void) => { state.expenseListener = listener; return () => {}; },
    refresh: async () => {},
  },
}));
vi.mock("@/lib/salesAccounting", () => ({
  postExpense: (...args: unknown[]) => state.postExpense(...args),
  removeExpenseJournal: vi.fn(),
}));
vi.mock("@/lib/journalStore", () => ({
  journalStore: {
    refreshConfirmed: () => {
      state.refreshJournal();
      return new Promise<void>((resolve) => { state.resolveJournal = resolve; });
    },
    getAll: () => [],
  },
  removeJournalBySource: vi.fn(),
}));
vi.mock("@/lib/cloudSettings", () => ({
  getCloudSettingsScopeVersion: () => state.scopeVersion,
  subscribeCloudSettingsScopeChange: () => () => {},
}));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: async () => "tenant-1" }));
vi.mock("@/lib/workOrdersStore", () => ({ getWorkOrders: () => [], subscribeWorkOrders: () => () => {} }));
vi.mock("@/lib/vehiclesStore", () => ({ vehiclesStore: { getAll: () => [] }, archiveVehicleByPlate: vi.fn() }));

describe("accounting bridge startup", () => {
  beforeEach(() => {
    vi.resetModules();
    state.hydrated = false;
    state.scopeVersion = 1;
    state.expenseListener = null;
    state.resolveJournal = null;
    state.postExpense.mockClear();
    state.refreshJournal.mockClear();
  });

  it("does not post from an empty journal cache while cloud hydration is pending", async () => {
    const { startAccountingBridge } = await import("@/lib/accountingBridge");
    startAccountingBridge();
    await Promise.resolve();
    expect(state.postExpense).not.toHaveBeenCalled();
    expect(state.refreshJournal).not.toHaveBeenCalled();

    state.hydrated = true;
    state.expenseListener?.();
    await vi.waitFor(() => expect(state.refreshJournal).toHaveBeenCalledTimes(1));
    expect(state.postExpense).not.toHaveBeenCalled();

    state.resolveJournal?.();
    await vi.waitFor(() => expect(state.postExpense).toHaveBeenCalledTimes(1));
  });

  it("drops a stale reconciliation after the tenant scope changes", async () => {
    const { startAccountingBridge } = await import("@/lib/accountingBridge");
    startAccountingBridge();
    await Promise.resolve();
    state.hydrated = true;
    state.expenseListener?.();
    await vi.waitFor(() => expect(state.refreshJournal).toHaveBeenCalledTimes(1));

    state.scopeVersion += 1;
    state.resolveJournal?.();
    await Promise.resolve();
    expect(state.postExpense).not.toHaveBeenCalled();
  });
});
