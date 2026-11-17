// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: db.tenant }));
vi.mock("@/lib/customersStore", () => ({ customersStore: {} }));
vi.mock("@/lib/claimWorkOrderUnified", () => ({ addUnifiedVehicleMedia: vi.fn(), fetchUnifiedOperationalState: vi.fn(), upsertUnifiedOperationalState: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc, from: db.from, auth: { onAuthStateChange: vi.fn() } } }));
const page = readFileSync("src/pages/WorkOrders.tsx", "utf8");
const migrationName = readdirSync("supabase/migrations").find(name => name.endsWith("_work_orders_light_summary_page.sql"))!;
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8").replace(/\r\n/g, "\n");
const legacy = readFileSync("supabase/migrations/20260928140000_work_orders_list_channel_filter_alignment.sql", "utf8").replace(/\r\n/g, "\n");
const payload = { rows: [{ id: "uuid", order_number: "WO-C-26-0001", customer_id: "customer", vehicle_id: "vehicle", status: "received", actual_expense_cost: 28.8, _customer: { name: "Synthetic", phone: "80000971" }, _vehicle: { plateNumber: "999400", plateLetters: "QA" } }], pagination: { page: 1, pageSize: 20, totalRows: 26, totalPages: 2 }, summary: { total: 26, cash: 13, insurance: 13 }, filterOptions: {} };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); db.tenant.mockResolvedValue("tenant"); db.rpc.mockResolvedValue({ data: payload, error: null }); });
describe("bounded lightweight work-order list", () => {
  it("requests only a summary page and keeps cost/customer/page data unchanged", async () => {
    const store = await import("@/lib/workOrdersStore");
    const result = await store.fetchWorkOrderListPage({ tenantId: "tenant", projection: "summary", page: 2, pageSize: 20, search: "  QA  ", filters: { ownership: "cash" } });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("work_orders_summary_page_rpc", { p_tenant_id: "tenant", p_page: 2, p_page_size: 20, p_search: "QA", p_filters: { ownership: "cash" } });
    expect(result.rows[0]).toMatchObject({ summaryOnly: true, customer: "Synthetic", actualExpenseCost: 28.8 });
    expect(result.pagination.totalRows).toBe(26); expect(result.summary.cash).toBe(13); expect(db.from).not.toHaveBeenCalled();
    expect(store.getWorkOrders()).toEqual([]);
    await expect(store.saveWorkOrderToCloud(result.rows[0])).rejects.toThrow("WORK_ORDER_FULL_RECORD_REQUIRED");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("preserves full projection by default for legacy print/export consumers", async () => {
    const store = await import("@/lib/workOrdersStore"); const result = await store.fetchWorkOrderListPage({ tenantId: "tenant", page: 1, pageSize: 20 });
    expect(db.rpc.mock.calls[0][0]).toBe("work_orders_list_rpc"); expect(result.rows[0].summaryOnly).toBeUndefined();
  });
  it.each(["PGRST202", "42883"])("falls back only to another bounded page when the new function is unavailable (%s)", async code => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { code } });
    const store = await import("@/lib/workOrdersStore"); const result = await store.fetchWorkOrderListPage({ tenantId: "tenant", page: 1, pageSize: 20, projection: "summary" });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["work_orders_summary_page_rpc", "work_orders_list_rpc"]);
    expect(result.rows[0].summaryOnly).toBeUndefined(); expect(db.from).not.toHaveBeenCalled();
  });
  it("does not hide network/RLS errors with an archive load or another RPC", async () => {
    const error = { code: "42501", message: "permission denied" }; db.rpc.mockResolvedValue({ data: null, error });
    const store = await import("@/lib/workOrdersStore"); await expect(store.fetchWorkOrderListPage({ tenantId: "tenant", page: 1, pageSize: 20, projection: "summary" })).rejects.toBe(error);
    expect(db.rpc).toHaveBeenCalledTimes(1); expect(db.from).not.toHaveBeenCalled();
  });
  it("changes only the projection, not tenant/filter/sort/paging/financial SQL rules", () => {
    const body = (text: string) => text.split("as $$")[1].split("$$;")[0];
    expect(body(migration).replace(/jo\.id,[\s\S]*?jo\.received_at,/, "jo.*,")).toBe(body(legacy));
    expect(migration).toContain("security invoker"); expect(migration).toContain("from public, anon"); expect(migration).not.toMatch(/\b(?:insert into|update public|delete from|alter table)\b/i);
    expect(migration).not.toContain("jo.photos"); expect(migration).not.toContain("jo.metadata"); expect(migration).not.toContain("jo.work_items");
  });
  it("does not mount heavy dialogs or publish partial rows before explicit actions", () => {
    expect(page).toContain('projection: "summary"'); expect(page).toContain('{expenseOrder && <WorkOrderExpenseDialog'); expect(page).toContain('{photosOrderId && <StagePhotosDialog');
    expect(page).not.toMatch(/^import .*from "@\/lib\/pdfGenerator"/m);
    expect(page).toContain("resolveWorkOrderListAction(order, tenantId)"); expect(page).toContain("resolveSelectedWorkOrderActions([...selectedIds]"); expect(page).toContain("linkedExpenseVouchers={editVouchers}");
    expect(page).not.toContain("setEditOrder(order)"); expect(page).not.toContain("availableActionOrders");
    expect(page).toMatch(/if \(!listVerified\) return;\s*if \(page > totalPages\) setPage\(totalPages\)/);
  });
  it("invalidates canonical vehicle queries after confirmed identity, not the archive/settings mirror", () => {
    const form = readFileSync("src/components/workorders/WorkOrderForm.tsx", "utf8");
    expect(form).toContain("queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all })");
    expect(form).not.toContain("refreshVehiclesFromCloud");
    expect(form).toContain("await ensureVehicleForCustomer(");
    expect(form).toContain("await saveWorkOrderToCloud(");
  });
});
