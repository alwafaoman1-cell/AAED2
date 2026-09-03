import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const store = readFileSync("src/lib/expensesStore.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("work-order expense query synchronization", () => {
  it("uses the existing central expense realtime subscription", () => {
    expect(store.match(/channel\("expenses_store_sync"\)/g)).toHaveLength(1);
    expect(store.match(/table:\s*"expenses"/g)).toHaveLength(1);
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
});
