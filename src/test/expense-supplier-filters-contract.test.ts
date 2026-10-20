import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261010110000_expense_supplier_invoice_filter.sql");
const page = read("src/pages/accounting/expenses/ExpensesManagementPage.tsx");
const service = read("src/lib/expenses/expenseClassificationService.ts");

describe("expense supplier filters", () => {
  it("filters invoice number and supplier name in both rows and aggregates", () => {
    expect(migration.match(/p_filters->>'supplier_invoice_number'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/e\.supplier_invoice_number,e\.meta->>'supplierInvoiceNumber'/g)).toHaveLength(2);
    expect(migration.match(/s\.name,e\.beneficiary,e\.meta->>'supplierName'/g)).toHaveLength(2);
    expect(migration).toContain("offset v_offset limit v_limit");
    expect(migration).toContain("into v_agg from eligible");
    expect(migration).not.toMatch(/\b(update|delete from|truncate)\s+public\.expenses\b/i);
  });

  it("preserves the tenant, permissions and deleted-parent eligibility rules", () => {
    expect(migration).toContain("expense_has_permission('expenses.view')");
    expect(migration.match(/e\.tenant_id=v_tenant and e\.deleted_at is null and e\.archived_at is null/g)).toHaveLength(2);
    expect(migration.match(/j\.id is not null and j\.deleted_at is null/g)).toHaveLength(2);
    expect(migration.match(/c\.id is not null and lower\(c\.status::text\) not in \('cancelled','deleted'\)/g)).toHaveLength(2);
    expect(migration).toContain("grant execute on function public.expense_management_rpc(integer,integer,jsonb) to authenticated");
  });

  it("applies both filters to paged results and all exported pages", () => {
    expect(page).toContain('"supplier_invoice_number"');
    expect(page).toContain('update("supplier_invoice_number", supplierInvoiceSearch.trim())');
    expect(page).toContain('update("supplier", supplier.name)');
    expect(page).toContain("await listAllExpenses(filters)");
    expect(service).toContain("p_filters: clean");
    expect(service).toContain("listExpenses(index + 2, 500, filters)");
  });

  it("loads supplier suggestions lazily and keeps the filter view scoped and clearable", () => {
    expect(page).toContain("debouncedSupplierSearch.length >= 2");
    expect(page).toContain("searchSuppliers(tenantId, debouncedSupplierSearch)");
    expect(page).toContain("const filterScope = tenantId && user?.id");
    expect(page).toContain("loadExpenseListFilters(filterScope, savedFilterKeys)");
    expect(page).toContain("clearExpenseListFilters(filterScope)");
    expect(page).toContain('setParams(new URLSearchParams({ month: "all" }))');
    expect(page).toContain("activeFilterCount > 0 && <Badge");
    expect(page).not.toContain("createSupplier(");
  });
});
