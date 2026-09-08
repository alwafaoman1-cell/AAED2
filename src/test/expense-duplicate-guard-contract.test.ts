import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260908130000_expense_duplicate_guard.sql");

describe("central expense duplicate guard", () => {
  it("protects exact supplier documents atomically and per tenant", () => {
    expect(migration).toContain("expense_duplicate_candidates_rpc");
    expect(migration).toContain("guard_expense_duplicate_document_trigger");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("EXPENSE_DUPLICATE_EXACT");
    expect(migration).toContain("e.tenant_id = new.tenant_id");
    expect(migration).toContain("e.tenant_id = v_tenant");
  });

  it("ignores deleted, archived and cancelled expenses without rewriting history", () => {
    expect(migration).toContain("e.deleted_at is null and e.archived_at is null");
    expect(migration).toContain("not in ('cancelled', 'void', 'invalid')");
    expect(migration).not.toMatch(/update\s+public\.expenses\s+set/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.expenses/i);
  });

  it("permits legitimate lines from one bulk supplier invoice but blocks a later re-entry", () => {
    const bulk = read("src/components/workorders/WorkOrderBulkExpenseDialog.tsx");
    expect(bulk).toContain("const duplicateBatchId = crypto.randomUUID()");
    expect(bulk.match(/duplicateBatchId,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("duplicateBatchId");
    expect(migration).toContain("coalesce(e.meta->>'duplicateBatchId', '') <> v_batch");
  });

  it("checks both expense management and work-order create/update paths", () => {
    const store = read("src/lib/expensesStore.ts");
    const service = read("src/lib/expenses/expenseClassificationService.ts");
    const workOrderForm = read("src/components/workorders/WorkOrderExpenseDialog.tsx");
    const managementForm = read("src/pages/accounting/expenses/ExpenseFormPage.tsx");
    expect(store.match(/checkExpenseDuplicates\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(service).toContain("checkExpenseDuplicates");
    expect(workOrderForm).toContain("ExpensePotentialDuplicateError");
    expect(managementForm).toContain("ExpensePotentialDuplicateError");
  });

  it("requires manager approval reason for potential duplicates and records an audit", () => {
    const guard = read("src/lib/expenses/expenseDuplicateGuard.ts");
    expect(guard).toContain("Only a manager can override this warning");
    expect(guard).toContain("An override reason is required");
    expect(migration).toContain("expense_duplicate_audit_logs");
    expect(migration).toContain("p.role::text in ('admin', 'manager')");
    expect(migration).toContain("EXPENSE_DUPLICATE_OVERRIDE_FORBIDDEN");
  });

  it("supports attachment fingerprints without exposing document content", () => {
    const guard = read("src/lib/expenses/expenseDuplicateGuard.ts");
    expect(migration).toContain("document_sha256");
    expect(guard).toContain('crypto.subtle.digest("SHA-256"');
    expect(migration).not.toContain("document_content");
  });
});
