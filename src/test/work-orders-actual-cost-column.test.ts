import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWorkOrderActualCostMap } from "@/lib/workOrderActualCosts";

describe("work orders actual cost column", () => {
  it("uses active linked expense totals including VAT and counts each voucher once", () => {
    const costs = buildWorkOrderActualCostMap([
      { id: "11111111-1111-4111-8111-111111111111", order_number: "WO-00050" },
    ], [
      { id: "e1", work_order_id: "11111111-1111-4111-8111-111111111111", linked_work_order_id: "WO-00050", amount: 28.8, total: 30.24, status: "active" },
      { id: "e1", linked_work_order_id: "WO-00050", amount: 28.8, total: 30.24, status: "active" },
      { id: "e2", linked_work_order_id: "WO-00050", amount: 10, total: 10.5, status: "cancelled" },
    ]);
    expect(costs.get("11111111-1111-4111-8111-111111111111")).toBe(30.24);
  });

  it("does not treat labor charges or estimated parts fields as actual cost", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/WorkOrders.tsx"), "utf8");
    expect(page).toContain("actualWorkOrderCost(order)");
    expect(page).toContain("سندات الصرف الفعلية المرتبطة شامل الضريبة");
    expect(page).not.toContain("order.totalCost.toLocaleString");
  });

  it("refreshes the list cost when an expense changes through realtime", () => {
    const realtime = readFileSync(resolve(process.cwd(), "src/hooks/useRealtimeSync.ts"), "utf8");
    expect(realtime).toContain('tables: ["job_orders", "expenses"]');
    expect(realtime).toContain('table === "expenses" && realtimeScope.scope === "work_orders_list"');
    expect(realtime).toContain("refreshWorkOrdersFromCloud()");
  });
});
