import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateVatFromSubtotal } from "@/lib/accounting/core";

describe("accounting core contract", () => {
  it("keeps OMR decimals and calculates VAT from subtotal only", () => {
    expect(calculateVatFromSubtotal(100)).toEqual({ subtotal: 100, vat: 5, total: 105 });
    expect(calculateVatFromSubtotal(3.5)).toEqual({ subtotal: 3.5, vat: 0.175, total: 3.675 });
  });

  it("uses actual expenses before estimated costs and does not add both", () => {
    const core = readFileSync(resolve(process.cwd(), "src/lib/accounting/core.ts"), "utf8");
    expect(core).toContain("actualSparePartsCost > 0 ? actualSparePartsCost : estimatedSparePartsCost");
    expect(core).toContain("actualLabourCost > 0 ? actualLabourCost : estimatedLabourCost");
    expect(core).not.toContain("actualSparePartsCost + estimatedSparePartsCost");
    expect(core).not.toContain("actualLabourCost + estimatedLabourCost");
  });

  it("wires reports and executive dashboard to the accounting core", () => {
    const report = readFileSync(resolve(process.cwd(), "src/pages/reports/WorkOrdersStatement.tsx"), "utf8");
    const dashboard = readFileSync(resolve(process.cwd(), "src/pages/dashboard/ExecutiveDashboard.tsx"), "utf8");
    expect(report).toContain("@/lib/accounting/core");
    expect(report).toContain("تقرير تكلفة وربحية أوامر العمل");
    expect(dashboard).toContain("@/lib/accounting/core");
    expect(dashboard).toContain("Data Quality");
  });

  it("adds non-destructive accounting views and RPCs", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260626110000_accounting_core_views.sql"), "utf8");
    expect(migration).toContain("accounting_work_order_profit_view");
    expect(migration).toContain("accounting_claims_summary_view");
    expect(migration).toContain("accounting_dashboard_summary_rpc");
    expect(migration).toContain("accounting_reports_summary_rpc");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
  });
});
