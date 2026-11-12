import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), read: vi.fn(), costs: vi.fn() }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderFromCloudByIdentifier: mocks.read, fetchActualExpenseCostsForOrders: mocks.costs }));
import { resolveSelectedWorkOrderActions, resolveSelectedWorkOrderExport, resolveWorkOrderListAction } from "@/lib/workOrderListActions";
beforeEach(() => { vi.clearAllMocks(); mocks.tenant.mockResolvedValue("tenant"); });
describe("complete records at list action boundary", () => {
  it("resolves UUID rather than an abbreviated row before any editor/action", async () => {
    const full = { id: "WO-C-26-0054", cloudId: "uuid", workItems: [{ title: "keep" }], receptionNotes: "keep", photos: [{ dataUrl: "keep" }] };
    mocks.read.mockResolvedValue(full);
    expect(await resolveWorkOrderListAction({ id: full.id, cloudId: "uuid" }, "tenant")).toBe(full);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("uuid");
  });
  it.each([null, { deletedAt: "2026-11-07" }])("refuses missing/deleted records without mutating", async value => {
    mocks.read.mockResolvedValue(value);
    await expect(resolveWorkOrderListAction("wo", "tenant")).rejects.toThrow("WORK_ORDER_UNAVAILABLE_REOPEN_LIST");
  });
  it("refuses a partial record and propagates read failures", async () => {
    mocks.read.mockResolvedValue({ summaryOnly: true });
    await expect(resolveWorkOrderListAction("wo", "tenant")).rejects.toThrow("WORK_ORDER_FULL_RECORD_REQUIRED");
    mocks.read.mockRejectedValue(new Error("Cloud unavailable"));
    await expect(resolveWorkOrderListAction("wo", "tenant")).rejects.toThrow("Cloud unavailable");
  });
  it("denies wrong tenant before reading and a scope change during read", async () => {
    await expect(resolveWorkOrderListAction("wo", "other")).rejects.toThrow("WORK_ORDER_READ_SCOPE_CHANGED");
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.tenant.mockResolvedValueOnce("tenant").mockResolvedValue("other"); mocks.read.mockResolvedValue({ id: "wo" });
    await expect(resolveWorkOrderListAction("wo", "tenant")).rejects.toThrow("WORK_ORDER_READ_SCOPE_CHANGED");
  });
  it("keeps cross-page selections, deduplicates and bounds parallel reads", async () => {
    let active = 0, peak = 0;
    mocks.read.mockImplementation(async id => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { id }; });
    const ids = Array.from({ length: 11 }, (_, i) => `page-${i}`);
    const rows = await resolveSelectedWorkOrderActions([...ids, ids[0]], "tenant");
    expect(rows.map(row => row.id)).toEqual(ids); expect(peak).toBe(4); expect(mocks.read).toHaveBeenCalledTimes(11);
  });
  it("does not replace actual exported expense costs with the detail reader's default zero", async () => {
    mocks.read.mockResolvedValue({ id: "WO-C-26-0001", cloudId: "uuid", actualExpenseCost: 0, photos: [{ dataUrl: "keep" }] });
    mocks.costs.mockResolvedValue(new Map([["uuid", 28.8]]));
    const rows = await resolveSelectedWorkOrderExport(["WO-C-26-0001"], "tenant");
    expect(mocks.costs).toHaveBeenCalledExactlyOnceWith("tenant", [{ id: "uuid", order_number: "WO-C-26-0001" }]);
    expect(rows[0]).toMatchObject({ actualExpenseCost: 28.8, photos: [{ dataUrl: "keep" }] });
  });
});
