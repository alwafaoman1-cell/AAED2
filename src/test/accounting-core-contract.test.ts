import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateVatFromSubtotal } from "@/lib/accounting/core";
import { calculateVatExclusive, roundOMR } from "@/lib/money";

describe("accounting core contract", () => {
  it("keeps OMR decimals and calculates VAT from subtotal only", () => {
    expect(calculateVatFromSubtotal(100)).toEqual({ subtotal: 100, vat: 5, total: 105 });
    expect(calculateVatFromSubtotal(3.5)).toEqual({ subtotal: 3.5, vat: 0.175, total: 3.675 });
    expect(calculateVatExclusive("1,200.000")).toEqual({ subtotalBeforeVat: 1200, vatAmount: 60, totalIncludingVat: 1260 });
    expect(roundOMR(100.0004)).toBe(100);
    const pdf = readFileSync(resolve(process.cwd(), "src/lib/pdfGenerator.ts"), "utf8");
    expect(pdf).toContain("toFixed(3)");
    expect(pdf).not.toContain("const vat = Math.round(subtotal");
    expect(pdf).toContain("const vat = Number((subtotal * (s.vatRate / 100)).toFixed(3))");
  });

  it("does not treat work order totalCost as accounting revenue", () => {
    const core = readFileSync(resolve(process.cwd(), "src/lib/accounting/core.ts"), "utf8");
    expect(core).not.toContain("fallbackRevenue");
    expect(core).not.toContain("revenue.revenueExVat ||");
    expect(core).not.toContain("order.totalCost)");
  });

  it("does not recognize insurance claim estimates or approvals as actual revenue", () => {
    const insuranceAccounting = readFileSync(resolve(process.cwd(), "src/lib/insuranceAccounting.ts"), "utf8");
    const reportsEngine = readFileSync(resolve(process.cwd(), "src/lib/reportsEngine.ts"), "utf8");
    const unifiedRevenue = readFileSync(resolve(process.cwd(), "src/hooks/useUnifiedRevenue.ts"), "utf8");
    const monthlyReport = readFileSync(resolve(process.cwd(), "src/pages/reports/MonthlyReport.tsx"), "utf8");
    const accountingPage = readFileSync(resolve(process.cwd(), "src/pages/Accounting.tsx"), "utf8");

    expect(insuranceAccounting).toContain("Claim approval is only an expected/approved value");
    expect(insuranceAccounting).toContain("return [];");
    expect(reportsEngine).toContain("Insurance claim estimates/approvals are expected values only");
    expect(reportsEngine).toContain("const revenue = salesRevenueExVat;");
    expect(unifiedRevenue).toContain("const insSubtotal = insInRange.reduce");
    expect(unifiedRevenue).toContain("totalRevenue: sales.totalRevenue + insSubtotal");
    expect(monthlyReport).toContain("Claim approval/estimate journals are not actual revenue");
    expect(accountingPage).toContain("estimates/claim approvals are never included");
    expect(accountingPage).toContain('if (entry.source === "insurance_claim") return false;');
  });

  it("keeps estimated work-order costs outside actual cost and profit", () => {
    const core = readFileSync(resolve(process.cwd(), "src/lib/accounting/core.ts"), "utf8");
    const reportsEngine = readFileSync(resolve(process.cwd(), "src/lib/reportsEngine.ts"), "utf8");
    expect(core).toContain("Estimated work-order/claim costs are planning values only");
    expect(core).toContain("const sparePartsCost = actualSparePartsCost;");
    expect(core).toContain("const labourCost = actualLabourCost;");
    expect(reportsEngine).toContain("Work-order partsCost/laborCost are estimates");
    expect(core).not.toContain("actualSparePartsCost + estimatedSparePartsCost");
    expect(core).not.toContain("actualLabourCost + estimatedLabourCost");
    expect(core).not.toContain("actualSparePartsCost > 0 ? actualSparePartsCost : estimatedSparePartsCost");
    expect(core).not.toContain("actualLabourCost > 0 ? actualLabourCost : estimatedLabourCost");
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
