import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("atomic expense voucher numbering", () => {
  it("allocates payment voucher numbers through one Supabase RPC", () => {
    const helper = read("src/lib/expenseVoucherNumbering.ts");
    expect(helper).toContain('"next_expense_voucher_number"');
    expect(helper).not.toContain("Date.now()");
    expect(helper).not.toContain("Math.random()");
  });

  it("does not use the browser counter in active expense creation screens", () => {
    const files = [
      "src/pages/accounting/ExpenseNew.tsx",
      "src/components/workorders/WorkOrderExpenseDialog.tsx",
      "src/components/workorders/WorkOrderBulkExpenseDialog.tsx",
      "src/components/accounting/BulkExpenseDialog.tsx",
      "src/pages/apps/SupervisorApp.tsx",
      "src/pages/ExpensesImport.tsx",
      "src/lib/dailyLogStore.ts",
      "src/lib/importExportCenter.ts",
      "src/lib/insuranceCancellation.ts",
    ];
    for (const file of files) {
      expect(read(file), file).not.toContain('generateNextNumber("payment")');
      expect(read(file), file).not.toContain("generateNextNumber('payment')");
    }
    expect(read("src/lib/importExportCenter.ts")).not.toContain("`EXP-IMP-${Date.now()}");
    expect(read("src/lib/insuranceCancellation.ts")).not.toContain("`EXP-CNL-${Date.now()");
  });

  it("uses a tenant-scoped atomic database sequence", () => {
    const migration = read("supabase/migrations/20260817120000_atomic_expense_voucher_numbering.sql");
    expect(migration).toContain("primary key (tenant_id, voucher_year, prefix)");
    expect(migration).toContain("on conflict (tenant_id, voucher_year, prefix) do update");
    expect(migration).toContain("greatest(");
    expect(migration).toContain("get_user_tenant_id()");
    expect(migration).toContain("auth.uid() is null");
  });

  it("protects new rows without rewriting historical duplicate vouchers", () => {
    const guard = read("supabase/migrations/20260817121000_expense_voucher_uniqueness_guard.sql");
    expect(guard).toContain("add column if not exists voucher_number_guarded boolean");
    expect(guard).toContain("alter column voucher_number_guarded set default true");
    expect(guard).toContain("where voucher_number_guarded is true");
    expect(guard).toContain("prevent_new_duplicate_expense_voucher");
    expect(guard).not.toMatch(/update\s+public\.expenses\s+set\s+voucher_number_guarded/i);
  });
});
