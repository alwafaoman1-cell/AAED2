import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportWorkbook } from "@/lib/reports-center/reportExportService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("expense management VAT and configurable export", () => {
  const page = read("src/pages/accounting/expenses/ExpensesManagementPage.tsx");
  const service = read("src/lib/expenses/expenseClassificationService.ts");
  const migration = read("supabase/migrations/20260825120000_expense_supplier_invoice_date.sql");

  it("exposes VAT filtering and supplier invoice identity columns", () => {
    expect(page).toContain('value="vat"');
    expect(page).toContain("مصروفات عليها ضريبة");
    expect(page).toContain('key: "supplier_name"');
    expect(page).toContain('key: "supplier_tax_number"');
    expect(page).toContain('key: "supplier_invoice_number"');
    expect(page).toContain('key: "supplier_invoice_date"');
    expect(service).toContain('.select("id,name,tax_number")');
  });

  it("exports all filtered pages and only the columns selected by the user", () => {
    expect(page).toContain("selectedExportColumns");
    expect(page).toContain("DropdownMenuCheckboxItem");
    expect(page).toContain("await listAllExpenses(filters)");
    expect(service).toContain("listExpenses(index + 2, 500, filters)");

    const workbook = buildReportWorkbook({
      fileName: "expense-export-test",
      sheetName: "Expenses",
      title: "Expenses",
      filters: [{ label: "vat", value: "vat" }],
      columns: [
        { key: "supplier_name", label: "Supplier Name" },
        { key: "supplier_tax_number", label: "Supplier Tax No." },
      ],
      rows: [{ supplier_name: "Supplier", supplier_tax_number: "VAT-1", ignored: "not exported" }],
    });
    const sheet = workbook.Sheets.Expenses;
    expect(sheet["A6"].v).toBe("Supplier Name");
    expect(sheet["B6"].v).toBe("Supplier Tax No.");
    expect(sheet["C6"]).toBeUndefined();
  });

  it("adds supplier invoice date without historical backfill", () => {
    expect(migration).toContain("add column if not exists supplier_invoice_date date");
    expect(migration).not.toMatch(/update\s+public\.expenses/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.expenses/i);
  });
});
