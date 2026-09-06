import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260906110000_expense_amount_totals_ssot.sql"),
  "utf8",
);
const form = readFileSync(resolve(process.cwd(), "src/pages/accounting/expenses/ExpenseFormPage.tsx"), "utf8");
const store = readFileSync(resolve(process.cwd(), "src/lib/expensesStore.ts"), "utf8");
const legacyPage = readFileSync(resolve(process.cwd(), "src/pages/accounting/ExpenseNew.tsx"), "utf8");
const managementPage = readFileSync(resolve(process.cwd(), "src/pages/accounting/expenses/ExpensesManagementPage.tsx"), "utf8");

describe("expense financial totals SSOT", () => {
  it("treats the entered amount as VAT-inclusive and never adds VAT on top", () => {
    expect(migration).toContain("v_subtotal := round(v_total / 1.05, 3)");
    expect(migration).toContain("new.vat_amount := round(v_total - v_subtotal, 3)");
    expect(migration).toContain("new.total := v_total");
    expect(migration).not.toContain("new.total := round(v_total +");
  });

  it("allows VAT only when the tenant supplier has a tax number", () => {
    expect(migration).toContain("from public.suppliers s");
    expect(migration).toContain("s.tenant_id = new.tenant_id");
    expect(migration).toContain("new.is_vat_applicable := v_tax_number is not null");
    expect(migration).toContain("expenses_vat_requires_supplier_tax_number_check");
    expect(legacyPage).toContain("filtered.filter((r) => Boolean(r.supplierTaxNumber?.trim()))");
    expect(legacyPage).not.toContain("r.supplierTaxNumber || r.supplierInvoiceNumber");
    expect(managementPage).toContain("مورد مسجل ضريبيًا — لديه رقم ضريبي");
  });

  it("canonicalizes exact legacy work-order links for filters and reports", () => {
    expect(migration).toContain("expense_scope = 'work_order'");
    expect(migration).toContain("work_order_channel = case");
    expect(migration).toContain("e.tenant_id = j.tenant_id");
    expect(migration).toContain("j.deleted_at is null");
  });

  it("uses the same VAT and work-order rules in active frontend write paths", () => {
    expect(form).toContain("deriveExpenseTotals(form.amount,hasSupplierTaxNumber)");
    expect(form).toContain("supplier_tax_number:supplier.taxNumber||\"\"");
    expect(store).toContain("Boolean(e.supplierTaxNumber?.trim())");
    expect(store).toContain('expense_scope: e.linkedWorkOrderId || e.sourceWorkOrderId ? "work_order" : "operating"');
  });

  it("repairs all mismatched expense rows without targeting one work order", () => {
    expect(migration).toContain("update public.expenses");
    expect(migration).toContain("set amount = round(coalesce(amount, 0)::numeric, 3)");
    expect(migration).not.toContain("WO-00092");
    expect(migration).not.toMatch(/set\s+(date|supplier_id)\s*=/i);
  });
});
