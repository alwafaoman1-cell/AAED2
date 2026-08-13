import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("vehicle P&L and filtered expense exports", () => {
  const migration = read("supabase/migrations/20260813130000_expense_management_classification_refactor.sql");
  const runtime = read("supabase/tests/expense_management_classification_runtime_validation.sql");
  const service = read("src/lib/expenses/expenseClassificationService.ts");
  const page = read("src/pages/accounting/expenses/ExpensesManagementPage.tsx");

  it("includes cash and insurance direct costs and excludes operating costs", () => {
    expect(migration).toContain("expense_scope='work_order' then 'work_order_direct'");
    expect(migration).toContain("expense_scope='operating' then 'workshop_general'");
    expect(runtime).toContain("vehicle_pnl_cash_and_insurance");
    expect(runtime).toContain("vehicle_pnl_excludes_operating");
  });

  it("exports every filtered page with the same URL-backed filters", () => {
    expect(service).toContain("export async function listAllExpenses");
    expect(service).toContain("listExpenses(index + 2, 500, filters)");
    expect(page).toContain("await listAllExpenses(filters)");
    expect(page).toContain("new URLSearchParams(params)");
    expect(runtime).toContain("export_all_page_count");
  });
});
