import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260813130000_expense_management_classification_refactor.sql");
const workshopTemplate = read("supabase/migrations/20260822100000_expense_workshop_subcategory_template.sql");
const templatePolicyHardening = read("supabase/migrations/20260824122000_expense_template_policy_hardening.sql");
const templateDepartmentCorrection = read("supabase/migrations/20260825100000_expense_template_department_count_correction.sql");

describe("expense management classification refactor", () => {
  it("is additive and never reclassifies historical expenses", () => {
    expect(migration).toContain("add column if not exists classification_status");
    expect(migration).toContain("Legacy rows remain needs_classification");
    expect(migration.match(/expense_scope is distinct from 'work_order'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).not.toMatch(/update\s+public\.expenses\s+set\s+(expense_scope|classification_status|work_order_id)/i);
    expect(migration).not.toMatch(/\b(delete\s+from|truncate\s+table|drop\s+table)\b/i);
  });

  it("derives cash or insurance from the linked work order and protects deleted parents", () => {
    expect(migration).toContain("new.work_order_channel:=case when v_claim is not null");
    expect(migration).toContain("j.deleted_at is null");
    expect(migration).toContain("c.deleted_at is null");
    expect(migration).toContain("OPERATING_EXPENSE_WORK_ORDER_NOT_ALLOWED");
  });

  it("uses server pagination, complete filters, tenant RLS and mapping keys", () => {
    expect(migration).toContain("expense_management_rpc");
    expect(migration).toContain("offset v_offset limit v_limit");
    expect(migration.match(/p_filters->>'supplier_id'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/p_filters->>'work_order'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/p_filters->>'customer'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("expense_has_permission('expenses.manage_categories')");
    expect(migration).toContain("accounting_mapping_key");
  });

  it("keeps the default hierarchy manual and blocks category deletion in use", () => {
    expect(migration).toContain("apply_default_expense_category_template");
    expect(migration).not.toMatch(/select\s+public\.apply_default_expense_category_template\s*\(/i);
    expect(migration).toContain("EXPENSE_CATEGORY_IN_USE_DISABLE_INSTEAD");
    expect(migration).toContain("EXPENSE_CATEGORY_CYCLE");
  });

  it("routes to full pages and performs lazy lookup instead of loading full tables", () => {
    const app = read("src/App.tsx");
    const form = read("src/pages/accounting/expenses/ExpenseFormPage.tsx");
    const service = read("src/lib/expenses/expenseClassificationService.ts");
    expect(app).toContain('/accounting/expenses/categories/:categoryId');
    expect(app).toContain('/accounting/expenses/:expenseId/edit');
    expect(form).toContain("debouncedWo.trim().length>=2");
    expect(service).toContain("expense_work_order_search_rpc");
    expect(service).not.toMatch(/\.limit\((?:500|1000|5000)\)/);
  });

  it("derives insurance claim context independently", () => {
    const runtime = read("supabase/tests/expense_management_classification_runtime_validation.sql");
    expect(runtime).toContain("insurance_work_order_derived");
    expect(runtime).toContain("work_order_channel='insurance'");
    expect(runtime).toContain("claim_id='e9000000-0000-4000-8000-000000000106'");
  });

  it("keeps vehicle P&L limited to direct work-order costs", () => {
    const runtime = read("supabase/tests/expense_management_classification_runtime_validation.sql");
    expect(runtime).toContain("vehicle_pnl_cash_and_insurance");
    expect(runtime).toContain("vehicle_pnl_excludes_operating");
    expect(migration).toContain("expense_scope='operating' then 'workshop_general'");
    expect(migration).toContain("expense_scope='work_order' then 'work_order_direct'");
  });

  it("exports every filtered server page instead of the visible page", () => {
    const service = read("src/lib/expenses/expenseClassificationService.ts");
    const page = read("src/pages/accounting/expenses/ExpensesManagementPage.tsx");
    expect(service).toContain("export async function listAllExpenses");
    expect(service).toContain("listExpenses(index + 2, 500, filters)");
    expect(page).toContain("await listAllExpenses(filters)");
    expect(page).toContain("filters: filterNames.filter");
  });

  it("provides tree and flat category views with audit trail", () => {
    const page = read("src/pages/accounting/expenses/ExpenseCategoriesPage.tsx");
    expect(page).toContain('type ViewMode = "tree" | "flat"');
    expect(page).toContain("listCategoryAudit");
    expect(page).toContain("Category Audit Trail");
    expect(page).toContain("visited.has(row.id)");
    expect(page).toContain("compareExpenseCategoryRows");
  });

  it("normalizes legacy category nulls before locale-aware sorting", async () => {
    const { compareExpenseCategoryRows, normalizeExpenseCategoryRow } = await import("@/lib/expenses/expenseClassificationService");
    const legacy = normalizeExpenseCategoryRow({ id: "legacy", code: null, name_ar: "قديم", name_en: null, sort_order: null });
    const current = normalizeExpenseCategoryRow({ id: "current", code: "A-1", name_ar: "حديث", name_en: "Current", sort_order: 10 });
    expect(legacy.code).toBe("");
    expect(legacy.name_en).toBe("");
    expect(() => compareExpenseCategoryRows(legacy, current)).not.toThrow();
    expect(() => compareExpenseCategoryRows(legacy, current, "code")).not.toThrow();
  });

  it("exposes expense and category management from the accounting center", () => {
    const accounting = read("src/pages/Accounting.tsx");
    const form = read("src/pages/accounting/expenses/ExpenseFormPage.tsx");
    expect(accounting).toContain('value="expenses"');
    expect(accounting).toContain('/accounting/expenses/categories');
    expect(accounting).toContain('/accounting/expenses/new');
    expect(form).toContain('إدارة الأقسام والتصنيفات');
  });

  it("adds a manual three-level workshop template without historical backfill", () => {
    expect(workshopTemplate).toContain("'subcategory'");
    expect(workshopTemplate).toContain("for v_level in 1..3 loop");
    expect(workshopTemplate).toContain("v_parent.level<>v_level-1");
    expect(workshopTemplate).not.toMatch(/update\s+public\.expenses/i);
    expect(workshopTemplate).not.toMatch(/select\s+public\.apply_default_expense_category_template\s*\(/i);
  });

  it("keeps the shared template authenticated-only without permissive RLS", () => {
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(templatePolicyHardening).toContain("using (auth.uid() is not null)");
    expect(templatePolicyHardening).toContain("revoke all on public.expense_category_template_items from public, anon");
    expect(templatePolicyHardening).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)?expenses\b/i);
  });

  it("keeps fines under government and exactly thirteen template departments", () => {
    expect(templateDepartmentCorrection).toContain("parent_code = 'GOV'");
    expect(templateDepartmentCorrection).toContain("category_type = 'category'");
    expect(templateDepartmentCorrection).toContain("<> 13");
    expect(templateDepartmentCorrection).not.toMatch(/update\s+public\.expense_categories/i);
    expect(templateDepartmentCorrection).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)?expenses\b/i);
  });
});
