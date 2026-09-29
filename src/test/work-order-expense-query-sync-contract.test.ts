import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const store = readFileSync("src/lib/expensesStore.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const detail = readFileSync("src/pages/WorkOrderDetail.tsx", "utf8");

describe("work-order expense query synchronization", () => {
  it("uses the route-scoped central expense realtime subscription only", () => {
    const realtime = readFileSync("src/hooks/useRealtimeSync.ts", "utf8");
    expect(store).not.toContain('channel("expenses_store_sync")');
    expect(realtime).toContain('if (table === "expenses")');
    expect(realtime).toContain("applyExpenseRealtimeChange(payload)");
    expect(realtime).toContain("refreshWorkOrderActualCostFromExpenseChange(payload)");
  });

  it("does not hydrate or subscribe as an import side effect", () => {
    expect(store).not.toMatch(/if \(typeof window !== "undefined"\) \{\s*hydrateFromCloud\(\)/);
    expect(store).not.toContain("expenses_store_sync");
    expect(store).toContain("if (!hydrated && !hydrationPromise) void hydrateFromCloud()");
  });

  it("invalidates expense and financial query caches after expense changes", () => {
    expect(store).toContain("queryKeys.expenseManagement.all");
    expect(store).toContain("queryKeys.workOrderFinancials.all");
    expect(store).toContain("queryKeys.monthlyVehicleProfitability.all");
    expect(store).toContain("invalidateExpenseConsumers();");
  });

  it("connects the central expense store to the application QueryClient", () => {
    expect(app).toContain("setExpensesQueryClient(queryClient)");
  });

  it("fetches linked vouchers for one work order without relying only on the global cache", () => {
    expect(store).toContain("export async function fetchExpensesForWorkOrder");
    expect(store).toContain('load("work_order_id", [canonicalId])');
    expect(store).toContain('load("linked_work_order_id", refs)');
    expect(store).toContain('.eq("tenant_id", tenantId)');
    expect(store).toContain('.range(offset, offset + pageSize - 1)');
    expect(detail).toContain("fetchExpensesForWorkOrder(order!)");
    expect(detail).toContain("orderExpensesQuery.isError");
  });

  it("does not report a successful save if the database removed the work-order link", () => {
    expect(store).toContain("!expenseHasPersistedWorkOrderLink(saved, item)");
    expect(store).toContain("حُفظ سند الصرف");
  });
});
