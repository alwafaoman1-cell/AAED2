import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260813100000_monthly_vehicle_profitability_report.sql"), "utf8");
const monthlyDetailsMigration = readFileSync(resolve(root, "supabase/migrations/20260825130000_monthly_workshop_report_details.sql"), "utf8");
const expenseLinkageMigration = readFileSync(resolve(root, "supabase/migrations/20260901120000_monthly_vehicle_profitability_expense_linkage.sql"), "utf8");
const lifetimeCostMigration = readFileSync(resolve(root, "supabase/migrations/20260901123000_monthly_vehicle_profitability_lifetime_direct_costs.sql"), "utf8");
const revenueCompositionMigration = readFileSync(resolve(root, "supabase/migrations/20260902100000_monthly_vehicle_profitability_revenue_composition.sql"), "utf8");
const paymentMonthMigration = readFileSync(resolve(root, "supabase/migrations/20260902110000_monthly_vehicle_profitability_payment_month_basis.sql"), "utf8");
const matchedCostMigration = readFileSync(resolve(root, "supabase/migrations/20260902120000_monthly_vehicle_profitability_matched_cost_basis.sql"), "utf8");
const page = readFileSync(resolve(root, "src/pages/accounting/reports/MonthlyVehicleProfitabilityPage.tsx"), "utf8");
const service = readFileSync(resolve(root, "src/lib/accounting/monthlyWorkshopReport.ts"), "utf8");

describe("monthly vehicle profitability report contract", () => {
  it("keeps cash and insurance financial sources separated", () => {
    expect(migration).toContain("p_business_type text");
    expect(migration).toContain("i.business_type = p_business_type");
    expect(migration).toContain("p.business_type = p_business_type");
    expect(migration).toContain("e.business_type = p_business_type");
  });

  it("uses actual financial dates and excludes estimates from profit", () => {
    expect(migration).toContain("i.invoice_date between p_from and p_to");
    expect(migration).toContain("p.payment_date between p_from and p_to");
    expect(migration).toContain("e.date between p_from and p_to");
    expect(migration).not.toContain("estimated_amount");
  });

  it("keeps overhead separate from direct vehicle profit", () => {
    expect(migration).toContain("overhead_summary");
    expect(migration).toContain("'overheads'");
    expect(page).toContain("لا توزّع على السيارات");
    expect(page).toContain("المصروفات العامة (غير موزعة)");
  });

  it("uses the selected columns for screen and all exports", () => {
    expect(page).toContain("selectedColumns.map");
    expect(page).toContain("exportReportRowsToXlsx(request)");
    expect(page).toContain('runExport("xlsx")');
    expect(page).toContain('runExport("pdf")');
    expect(page).toContain('runExport("print")');
  });

  it("exports the filtered vehicle rows with the same selected columns as PDF and labels real parts expenses correctly", () => {
    expect(page).toContain("const rows = await fetchAllMonthlyVehicleProfitabilityRows(filters)");
    expect(page).toContain("const request = exportRequest(rows)");
    expect(page).toContain('key: "parts_cost", ar: "مصروفات قطع الغيار"');
    expect(page).not.toContain("إيراد قطع الغيار");
    expect(service).toContain('["مصروفات قطع الغيار", cashSummary.parts_cost');
    expect(service).not.toContain("إيراد قطع الغيار");
  });

  it("builds the permanent monthly report from cloud data without importing the reference workbook", () => {
    expect(page).toContain("fetchMonthlyWorkshopOverheads");
    expect(page).toContain("التقرير الشهري الشامل للورشة");
    expect(service).toContain("monthly_workshop_overheads_rpc");
    expect(service).toContain('"ربحية السيارات"');
    expect(service).toContain('"المصروفات العامة"');
    expect(service).toContain('"الرواتب"');
    expect(page).not.toContain("FileReader");
    expect(page).not.toContain("localStorage");
  });

  it("keeps workshop overhead out of vehicle profit and excludes VAT from monthly profit", () => {
    expect(monthlyDetailsMigration).toContain("e.expense_scope='operating'");
    expect(monthlyDetailsMigration).toContain("'subtotal'");
    expect(monthlyDetailsMigration).toContain("VAT is reported but excluded from profit");
    expect(page).toContain("combinedGross - generalExpenses");
  });

  it("excludes deleted, archived, cancelled, and void operating expenses", () => {
    expect(monthlyDetailsMigration).toContain("e.deleted_at is null");
    expect(monthlyDetailsMigration).toContain("e.archived_at is null");
    expect(monthlyDetailsMigration).toContain("'cancelled','canceled','void','invalid','deleted'");
  });

  it("restores linked legacy work-order expenses without mutating historical rows", () => {
    expect(expenseLinkageMigration).toContain("e.expense_scope is null");
    expect(expenseLinkageMigration).toContain("e.linked_work_order_id");
    expect(expenseLinkageMigration).toContain("e.meta->>'sourceWorkOrderId'");
    expect(expenseLinkageMigration).toContain("e.vehicle_id is not null");
    expect(expenseLinkageMigration).toContain("case when r.is_direct_vehicle_cost then 'work_order'");
    expect(expenseLinkageMigration).not.toMatch(/update\s+public\.expenses/i);
  });

  it("uses accounting mapping for parts and keeps archived work orders reportable", () => {
    expect(expenseLinkageMigration).toContain("nullif(r.accounting_mapping_key, '')");
    expect(expenseLinkageMigration).toContain("parts_direct_cost");
    expect(expenseLinkageMigration).not.toContain("resolved_work_order_archived_at");
    expect(expenseLinkageMigration).toContain("resolved_work_order_deleted_at is null");
    expect(expenseLinkageMigration).toContain("r.expense_scope = 'operating' then 'workshop_general'");
  });

  it("uses lifetime direct costs for vehicles active in the period while keeping overhead monthly", () => {
    expect(lifetimeCostMigration).toContain("eligible_expenses as (");
    expect(lifetimeCostMigration).toContain("eligible_period_expenses as (");
    expect(lifetimeCostMigration).toContain("direct_expenses as (");
    expect(lifetimeCostMigration).toContain("direct_period_expenses as (");
    expect(lifetimeCostMigration).toContain("expense_lifetime as (");
    expect(lifetimeCostMigration).toContain("from direct_expenses e");
    expect(lifetimeCostMigration).toContain("join activity_operations a");
    expect(lifetimeCostMigration).toContain("from eligible_period_expenses e");
    expect(lifetimeCostMigration).toContain("direct vehicle costs are lifetime per operation");
  });

  it("separates billed labor and parts revenue from actual direct costs without double counting", () => {
    expect(revenueCompositionMigration).toContain("invoice_line_amounts as (");
    expect(revenueCompositionMigration).toContain("public.sales_documents");
    expect(revenueCompositionMigration).toContain("public.insurance_invoices");
    expect(revenueCompositionMigration).toContain("pg_input_is_valid");
    expect(revenueCompositionMigration).toContain("parts_revenue");
    expect(revenueCompositionMigration).toContain("labor_revenue");
    expect(revenueCompositionMigration).toContain("external_direct_cost");
    expect(revenueCompositionMigration).toContain("coalesce(im.invoiced_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0)");
    expect(revenueCompositionMigration).not.toContain("coalesce(im.invoiced_ex_vat,0)+coalesce(im.labor_revenue,0)");
    expect(page).toContain("أجرة العمل/الخدمة المفوترة");
    expect(page).toContain("تكلفة عمالة خارجية");
    expect(service).toContain("row.labor_revenue");
    expect(service).toContain("row.parts_cost");
    expect(service).toContain("row.external_direct_cost");
  });

  it("uses one strict month for recognized payment revenue and direct costs without carryover", () => {
    expect(paymentMonthMigration).toContain("p.payment_date between p_from and p_to");
    expect(paymentMonthMigration).toContain("e.date between p_from and p_to");
    expect(paymentMonthMigration).toContain("direct_period_expenses as (");
    expect(paymentMonthMigration).toContain("from direct_period_expenses e");
    expect(paymentMonthMigration).not.toContain("expense_lifetime as (");
    expect(paymentMonthMigration).toContain("recognized_revenue_ex_vat");
    expect(paymentMonthMigration).toContain("least(p.amount, greatest(p.invoice_total - p.paid_before, 0))");
    expect(paymentMonthMigration).toContain("p.invoice_id is null");
    expect(paymentMonthMigration).toContain("i.operation_invoice_count = 1");
    expect(paymentMonthMigration).toContain("no revenue or vehicle cost is carried between months");
    expect(page).toContain('type="month"');
    expect(page).not.toContain('type="date" value={from}');
    expect(page).toContain("شهر التقرير");
  });

  it("matches real lifetime vehicle costs to payment revenue without duplicate cost recognition", () => {
    expect(matchedCostMigration).toContain("expense_lifetime as (");
    expect(matchedCostMigration).toContain("from direct_expenses e");
    expect(matchedCostMigration).toContain("matched_cost_month as (");
    expect(matchedCostMigration).toContain("pr.recognized_revenue_ex_vat");
    expect(matchedCostMigration).toContain("cx.total_invoice_subtotal");
    expect(matchedCostMigration).toContain("without duplicating costs across payment months");
    expect(matchedCostMigration).not.toContain("from direct_period_expenses e");
    expect(page).toContain("حتى لو كان سند المصروف بتاريخ مختلف");
  });
});
