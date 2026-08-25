import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260813100000_monthly_vehicle_profitability_report.sql"), "utf8");
const monthlyDetailsMigration = readFileSync(resolve(root, "supabase/migrations/20260825130000_monthly_workshop_report_details.sql"), "utf8");
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
    expect(page).toContain('runExport("xlsx")');
    expect(page).toContain('runExport("pdf")');
    expect(page).toContain('runExport("print")');
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
});
