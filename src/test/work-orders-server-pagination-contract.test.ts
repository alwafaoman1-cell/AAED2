import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260915140000_work_orders_list_pagination.sql"), "utf8");
const store = readFileSync(resolve(root, "src/lib/workOrdersStore.ts"), "utf8");
const keys = readFileSync(resolve(root, "src/lib/queryKeys.ts"), "utf8");
const page = readFileSync(resolve(root, "src/pages/WorkOrders.tsx"), "utf8");

describe("work-order server pagination contract", () => {
  it("provides a tenant-bound read-only RPC with bounded pagination", () => {
    expect(migration).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("offset greatest");
    expect(migration).toContain("limit least(greatest");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("from public, anon");
  });

  it("returns only page rows while calculating totals and filter options server-side", () => {
    expect(migration).toContain("'pagination'");
    expect(migration).toContain("'summary'");
    expect(migration).toContain("'filterOptions'");
    expect(migration).toContain("list_has_needed_parts");
    expect(migration).toContain("actual_expense_cost");
  });

  it("exposes a dedicated list reader without changing detail or mutation paths", () => {
    expect(store).toContain('supabase.rpc as any)("work_orders_list_rpc"');
    expect(store).toContain("export async function fetchWorkOrderListPage");
    expect(keys).toContain('"operational_list"');
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/i);
  });

  it("uses React Query for the operational page and keeps the legacy loader as fallback only", () => {
    expect(page).toContain("queryKeys.jobOrders.operationalList");
    expect(page).toContain("fetchWorkOrderListPage");
    expect(page).toContain("fetchAllWorkOrderListRows");
    expect(page).toContain("if (!workOrdersPageQuery.isError) return;");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).toContain("totalItems={filteredResultCount}");
  });
});
