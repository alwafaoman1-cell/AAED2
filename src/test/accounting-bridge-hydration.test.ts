import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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

  it("never installs navigation-triggered posting or archive reconciliation, even after hydration", async () => {
    const { startAccountingBridge } = await import("@/lib/accountingBridge");
    startAccountingBridge();
    await Promise.resolve();
    expect(state.postExpense).not.toHaveBeenCalled();
    expect(state.refreshJournal).not.toHaveBeenCalled();

    state.hydrated = true;
    expect(state.expenseListener).toBeNull();
    state.expenseListener?.();
    await Promise.resolve();
    expect(state.refreshJournal).not.toHaveBeenCalled();
    expect(state.postExpense).not.toHaveBeenCalled();
  });

  it("remains read-only on repeated startup and tenant changes", async () => {
    const { startAccountingBridge } = await import("@/lib/accountingBridge");
    startAccountingBridge();
    await Promise.resolve();
    state.hydrated = true;
    startAccountingBridge();
    state.scopeVersion += 1;
    startAccountingBridge();
    await Promise.resolve();
    expect(state.postExpense).not.toHaveBeenCalled();
    expect(state.refreshJournal).not.toHaveBeenCalled();
    expect(state.expenseListener).toBeNull();
  });

  it("keeps layouts and the compatibility facade free of vehicle mutation subscriptions", () => {
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    const bridge = readFileSync("src/lib/accountingBridge.ts", "utf8");
    expect(layout).not.toContain("startAccountingBridge");
    expect(bridge).not.toMatch(/syncVehicleArchive|archiveVehicleByPlate|subscribeWorkOrders|vehiclesStore\.(update|remove)|postExpense\(/);
    const vehicles = readFileSync("src/lib/vehiclesStore.ts", "utf8");
    expect(vehicles).not.toContain("pushArchiveStateToCloud");
    expect(vehicles).not.toContain("_lastVehSnap");
    expect(vehicles).toContain("vehiclesStore.setMutationHandler");
  });
});
