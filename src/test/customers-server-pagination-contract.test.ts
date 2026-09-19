import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260915141000_customers_list_pagination.sql"), "utf8");
const page = readFileSync(resolve(root, "src/pages/Customers.tsx"), "utf8");
const detailPage = readFileSync(resolve(root, "src/pages/CustomerDetail.tsx"), "utf8");
const vehiclesStore = readFileSync(resolve(root, "src/lib/vehiclesStore.ts"), "utf8");
const store = readFileSync(resolve(root, "src/lib/customersStore.ts"), "utf8");
const realtime = readFileSync(resolve(root, "src/hooks/useRealtimeSync.ts"), "utf8");

describe("customers server pagination contract", () => {
  it("uses a tenant-bound read-only RPC with bounded pages", () => {
    expect(migration).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("offset greatest");
    expect(migration).toContain("limit least(greatest");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(into|public\.)/i);
  });

  it("calculates row statistics and summary without loading every customer in the browser", () => {
    expect(migration).toContain("order_stats as materialized");
    expect(migration).toContain("vehicle_stats as materialized");
    expect(migration).toContain("'pagination'");
    expect(migration).toContain("'summary'");
    expect(store).toContain('"customers_list_rpc"');
  });

  it("uses React Query and starts the legacy full refresh only as a compatibility fallback", () => {
    expect(page).toContain("queryKeys.customers.operationalList");
    expect(page).toContain("fetchCustomerListPage");
    expect(page).toContain("if (!customersPageQuery.isError) return;");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).toContain("TablePaginationControls");
    expect(realtime).toContain('scope: "customers_list"');
    expect(realtime).toContain('tables: ["customers"]');
  });

  it("loads a direct customer route independently from the paginated list cache", () => {
    expect(store).toContain("export async function fetchCustomerByIdFromCloud");
    expect(store).toContain('.eq("tenant_id", tenantId)');
    expect(store).toContain('.eq("id", id)');
    expect(detailPage).toContain("fetchCustomerByIdFromCloud(id)");
    expect(detailPage).toContain("detailLoading");
    expect(detailPage).toContain("fetchWorkOrderListPage");
    expect(detailPage).toContain("fetchVehiclesByCustomerId");
    expect(vehiclesStore).toContain("export async function fetchVehiclesByCustomerId");
  });
});
