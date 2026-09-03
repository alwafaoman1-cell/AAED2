import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { composeMonthlyWorkshopOverheads, type MonthlyWorkshopOverheads } from "@/lib/accounting/monthlyWorkshopReport";

const emptySource = (): MonthlyWorkshopOverheads => ({
  summary: { subtotal: 0, vat: 0, total: 0, salaries: 0, fixed: 0, operating: 0, unlinked_parts: 0, other: 0, count: 0 },
  groups: [], expenseRows: [], payrollRows: [], basis: "test", generatedAt: "2026-09-03T00:00:00Z",
});

const hr = {
  employees: [
    { id: "employee-a", name: "Employee A", position: "Technician", hireDate: "2026-01-01", employmentStatus: "active", baseSalary: 200 },
    { id: "employee-b", name: "Employee B", position: "Painter", hireDate: "2026-01-01", employmentStatus: "active", baseSalary: 300 },
  ],
  advances: [], deductions: [], bonuses: [], payslips: [],
};

describe("monthly workshop section exports and HR accrual", () => {
  it("creates month-specific HR accrual rows for July and August without database writes", () => {
    const result = composeMonthlyWorkshopOverheads(emptySource(), hr, { fixedCosts: [], defaultMonthlySalariesTotal: 0 }, "2026-07-01", "2026-08-31");
    expect(result.payrollRows).toHaveLength(4);
    expect(result.payrollRows.map((row) => row.voucher_number)).toEqual([
      "HR-AUTO-2026-07", "HR-AUTO-2026-07", "HR-AUTO-2026-08", "HR-AUTO-2026-08",
    ]);
    expect(result.summary.salaries).toBe(1_000);
    expect(result.payrollRows.every((row) => row.source_basis === "hr_accrual" && row.generated === true)).toBe(true);
  });

  it("does not double-count a consolidated actual payroll voucher", () => {
    const source = emptySource();
    source.expenseRows = [{
      id: "actual-payroll", date: "2026-07-31", voucher_number: "PAY-2026-07", beneficiary: "Payroll",
      description: "رواتب شهر يوليو", accounting_mapping_key: "salary_expense", subtotal: 500, vat: 0, total: 500,
    }];
    const result = composeMonthlyWorkshopOverheads(source, hr, { fixedCosts: [], defaultMonthlySalariesTotal: 0 }, "2026-07-01", "2026-07-31");
    expect(result.payrollRows).toHaveLength(1);
    expect(result.payrollRows[0].source_basis).toBe("actual_voucher");
    expect(result.summary.salaries).toBe(500);
  });

  it("keeps section-level Excel, PDF and print actions with complete financial columns and totals", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/accounting/reports/MonthlyVehicleProfitabilityPage.tsx"), "utf8");
    for (const section of ["summary", "expenses", "groups", "payroll"]) {
      expect(page).toContain(`section="${section}"`);
    }
    expect(page).toContain("exportReportRowsToXlsx(request)");
    expect(page).toContain("exportReportRowsToPdf(request)");
    expect(page).toContain("printReportRows(request)");
    expect(page).toContain("إجمالي الرواتب والأجور");
    expect(page).toContain("مصدر الاحتساب");
    expect(page).toContain("قبل الضريبة");
    expect(page).toContain("VAT");
  });
});
