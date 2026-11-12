// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ from: vi.fn(), operational: vi.fn(), authListeners: [] as Array<(event: string, session: unknown) => void>, tenant: vi.fn() }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: db.tenant }));
vi.mock("@/lib/customersStore", () => ({ customersStore: {} }));
vi.mock("@/lib/claimWorkOrderUnified", () => ({ addUnifiedVehicleMedia: vi.fn(), fetchUnifiedOperationalState: db.operational, upsertUnifiedOperationalState: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: db.from, auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: "observer-user" } } } })),
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => { db.authListeners.push(callback); return { data: { subscription: { unsubscribe: vi.fn() } } }; },
  },
} }));
function query(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const q: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve), maybeSingle: vi.fn(async () => result) };
  for (const method of ["select", "eq", "is", "order", "limit", "range", "in", "or"]) q[method] = vi.fn(() => q);
  return q;
}
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks(); db.authListeners.length = 0; db.tenant.mockResolvedValue("tenant-a"); db.operational.mockResolvedValue(null); db.from.mockImplementation(() => query()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("store observation versus archive hydration", () => {
  it("observes work-order saves without an initial workshop-wide request, while retaining the old list subscription default", async () => {
    const store = await import("@/lib/workOrdersStore"); const unsubscribe = store.subscribeWorkOrders(vi.fn(), { loadAll: false });
    await vi.runOnlyPendingTimersAsync(); expect(db.from).not.toHaveBeenCalled(); unsubscribe();
    const stopList = store.subscribeWorkOrders(vi.fn()); await vi.runOnlyPendingTimersAsync();
    expect(db.from).toHaveBeenCalledWith("job_orders"); stopList();
  });
  it("does not hydrate expenses on observation or an Auth event for observer-only consumers", async () => {
    const { expensesStore } = await import("@/lib/expensesStore"); const changed = vi.fn(); const unsubscribe = expensesStore.subscribe(changed, { loadAll: false });
    db.authListeners.forEach((listener) => listener("SIGNED_IN", { user: { id: "observer-user" } }));
    await vi.runOnlyPendingTimersAsync(); expect(db.from).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalled(); unsubscribe();
  });
  it("preserves the full expense list's default hydration", async () => {
    const { expensesStore } = await import("@/lib/expensesStore"); const unsubscribe = expensesStore.subscribe(vi.fn());
    await expensesStore.refresh(); expect(db.from).toHaveBeenCalledWith("expenses"); expect(expensesStore.isHydrated()).toBe(true); unsubscribe();
  });
  it("loads the complete selected row including deletion, photos and required parts without fetching other orders", async () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", tenant_id: "tenant-a", order_number: "WO-I-26-0113", status: "delivered", deleted_at: "2026-11-01", archived_at: "2026-10-31", photos: [{ id: "photo", dataUrl: "data:original", phase: "received" }], parts_needed: [{ id: "part", name: "Retain required part", quantity: 2 }], work_items: [{ id: "item", title: "Retain work item" }] };
    const selected = query({ data: row, error: null }); db.from.mockReturnValue(selected);
    const store = await import("@/lib/workOrdersStore"); const actual = await store.fetchWorkOrderFromCloudByIdentifier(row.id);
    expect(db.from).toHaveBeenCalledExactlyOnceWith("job_orders");
    expect(selected.eq).toHaveBeenCalledWith("tenant_id", "tenant-a"); expect(selected.eq).toHaveBeenCalledWith("id", row.id);
    expect(actual).toMatchObject({ id: row.order_number, cloudId: row.id, deletedAt: row.deleted_at, archivedAt: row.archived_at, photos: row.photos, partsNeeded: row.parts_needed, workItems: row.work_items });
    expect(store.getWorkOrderById(row.id)).toBe(actual);
  });
  it("refuses to publish a selected row if its tenant changed during the read", async () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", order_number: "WO-C-26-0001", tenant_id: "tenant-a" };
    db.from.mockReturnValue(query({ data: row, error: null })); db.tenant.mockResolvedValueOnce("tenant-a").mockResolvedValue("tenant-b");
    const store = await import("@/lib/workOrdersStore");
    await expect(store.fetchWorkOrderFromCloudByIdentifier(row.id)).rejects.toThrow("WORK_ORDER_READ_SCOPE_CHANGED");
    expect(store.getWorkOrderById(row.id)).toBeUndefined();
  });
  it("retains the existing unified operational status, presence, reception and parts on the canonical detail read", async () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", order_number: "WO-I-26-0001", tenant_id: "tenant-a", status: "received", photos: [{ id: "original-photo" }] };
    const parts = [{ id: "operational-part", name: "Required part", quantity: 1 }];
    db.from.mockReturnValue(query({ data: row, error: null }));
    db.operational.mockResolvedValue({ tenant_id: "tenant-a", operational_status: "in_progress", vehicle_presence_status: "with_customer", vehicle_received_at: "2026-07-01T08:00:00Z", parts_required: parts });
    const store = await import("@/lib/workOrdersStore");
    await expect(store.fetchWorkOrderFromCloudByIdentifier(row.id)).resolves.toMatchObject({ status: "تحت الإصلاح", vehiclePresenceStatus: "with_customer", receivedAt: "2026-07-01T08:00:00Z", partsNeeded: parts, photos: row.photos });
  });
  it("does not publish operational data belonging to another tenant", async () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", order_number: "WO-I-26-0001", tenant_id: "tenant-a" };
    db.from.mockReturnValue(query({ data: row, error: null })); db.operational.mockResolvedValue({ tenant_id: "tenant-b" });
    const store = await import("@/lib/workOrdersStore");
    await expect(store.fetchWorkOrderFromCloudByIdentifier(row.id)).rejects.toThrow("WORK_ORDER_READ_SCOPE_CHANGED");
    expect(store.getWorkOrderById(row.id)).toBeUndefined();
  });
});
