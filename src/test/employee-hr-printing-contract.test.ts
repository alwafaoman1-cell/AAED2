import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(resolve(root, "src/pages/staff/EmployeeDetail.tsx"), "utf8");
const reports = readFileSync(resolve(root, "src/lib/employeeHrReports.ts"), "utf8");

describe("employee HR historical payslip and printing contract", () => {
  it("allows selecting a historical salary month and an editable payment date", () => {
    expect(page).toContain('type="month" value={month}');
    expect(page).toContain('type="date" value={paidAt}');
    expect(page).toContain("paidAt: paidAt || undefined");
    expect(page).toContain("selectedSlip?.id || hrStore.uid()");
    expect(page).toContain("setMonth(p.month)");
    expect(page).not.toContain('if (slips.find((s) => s.month === month))');
  });

  it("prints a monthly payslip and attendance/absence report", () => {
    expect(page).toContain("printPayslip(employee, p, isAr)");
    expect(page).toContain("printAttendanceMonth(employee, month, records, isAr)");
    expect(reports).toContain("Monthly Attendance & Absence Report");
    expect(reports).toContain("Monthly Payslip");
  });

  it("provides printable extracts for every employee file section", () => {
    for (const section of ["profile", "contract", "salary", "advances", "adjustments", "payslips", "leaves", "attendance", "documents", "performance"]) {
      expect(reports).toContain(`${section}: [`);
    }
    expect(page).toContain('printEmployeeHrExtract(draft, "all", isAr)');
    expect(reports).toContain("printReportRows(request)");
  });
});
