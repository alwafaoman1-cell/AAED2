import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("monthly expense and supplier account contracts", () => {
  it("loads payroll and fixed-cost settings into the monthly report without creating expenses", () => {
    const source = read("src/lib/accounting/monthlyWorkshopReport.ts");
    expect(source).toContain('readCloudSetting<HrSnapshot>("alwafa_hr_v1"');
    expect(source).toContain('readCloudSetting<MonthlySettingsSnapshot>("alwafa_monthly_settings_v1"');
    expect(source).toContain('source_basis: "hr_accrual"');
    expect(source).toContain('source_basis: "fixed_cost_setting"');
    expect(source).not.toContain('.from("expenses").insert');
  });

  it("lets actual payroll and fixed vouchers override generated monthly accruals", () => {
    const source = read("src/lib/accounting/monthlyWorkshopReport.ts");
    expect(source).toContain("payrollAccrualRowsForMonth(monthRows, hr, settings, month)");
    expect(source).toContain("A consolidated or otherwise unmatchable payroll voucher is authoritative");
    expect(source).toContain('monthRows.some((row) => classifyExpenseRow(row) === "fixed")');
    expect(source).toContain("when they are not covered by actual vouchers");
  });

  it("exposes a dedicated monthly expense report with column-aware exports", () => {
    const app = read("src/App.tsx");
    const page = read("src/pages/accounting/reports/MonthlyExpensesReportPage.tsx");
    expect(app).toContain('/accounting/reports/monthly-expenses');
    expect(page).toContain("exportReportRowsToXlsx");
    expect(page).toContain("exportReportRowsToPdf");
    expect(page).toContain("printReportRows");
    expect(page).toContain("Actual payroll/fixed vouchers override generated accruals for the same month");
  });

  it("uses canonical cloud tables for supplier balances instead of legacy settings stores", () => {
    const list = read("src/pages/purchases/Suppliers.tsx");
    const service = read("src/lib/purchases/supplierAccountService.ts");
    expect(list).not.toContain("suppliersStore");
    expect(list).not.toContain("purchaseInvoicesStore");
    for (const table of ["suppliers", "purchase_invoices", "supplier_payments", "expenses"]) {
      expect(service).toContain(`from("${table}")`);
    }
    expect(service).toContain('.eq("tenant_id", tenantId)');
  });

  it("avoids duplicate supplier purchases and preserves legacy invoice payments", () => {
    const service = read("src/lib/purchases/supplierAccountService.ts");
    expect(service).toContain("invoiceKeys.has(invoiceMatchKey");
    expect(service).toContain("Math.max(0, num(row.paid_amount)");
    expect(service).toContain("actualPaymentsByInvoice");
  });

  it("provides supplier details, vehicle linkage, selected-column Excel and print", () => {
    const app = read("src/App.tsx");
    const detail = read("src/pages/purchases/SupplierDetailPage.tsx");
    expect(app).toContain('/inventory/suppliers/:supplierId');
    expect(detail).toContain('key: "vehicle_linked"');
    expect(detail).toContain('key: "work_order_number"');
    expect(detail).toContain('key: "plate_number"');
    expect(detail).toContain("columns: columns.map");
    expect(detail).toContain("exportReportRowsToXlsx");
    expect(detail).toContain("printReportRows");
  });
});
