// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkOrder } from "@/lib/workOrdersStore";

const db = vi.hoisted(() => ({ read: vi.fn(), cached: vi.fn(), subscribe: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("@/lib/workOrdersStore", () => ({
  fetchWorkOrderFromCloudByIdentifier: db.read,
  getWorkOrderById: db.cached,
  subscribeWorkOrders: db.subscribe,
}));
import { useWorkOrderDetailRecord } from "@/hooks/useWorkOrderDetailRecord";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const record = (id = "WO-I-26-0113"): WorkOrder => ({
  id, cloudId: "11111111-1111-4111-8111-111111111111", customerId: "customer", vehicleId: "vehicle", claimId: "claim",
  customer: "Synthetic customer", phone: "99990000", plate: "QA 123", vehicleType: "Synthetic", model: "Audit", year: "2026", vin: "",
  insurance: "Synthetic insurer", claimNumber: "TEST-CLAIM", entryDate: "2026-01-01", technician: "", serviceType: "Inspection", status: "تحت الفحص", totalCost: 0,
  photos: [{ id: "old-photo", phase: "received", dataUrl: "data:original", storagePath: "original-only", uploadedAt: "2026-01-01" }],
  partsNeeded: [{ id: "part", name: "Preserved part", quantity: 2 }],
  workItems: [{ id: "item", title: "Preserved work", note: "Preserved note" }],
  receptionNotes: "Preserve saved reception", deletedAt: undefined,
});
beforeEach(() => {
  vi.clearAllMocks(); db.listeners.clear(); db.cached.mockReturnValue(undefined); db.read.mockResolvedValue(record());
  db.subscribe.mockImplementation((listener: () => void) => { db.listeners.add(listener); return () => db.listeners.delete(listener); });
});
afterEach(cleanup);
describe("confirmed, scoped work-order detail loading", () => {
  it("loads one canonical record, preserves its complete data and observes saves without loading the archive", async () => {
    const saved = record(); db.read.mockResolvedValue(saved);
    const { result } = renderHook(() => useWorkOrderDetailRecord(saved.id, "tenant-a"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(db.read).toHaveBeenCalledExactlyOnceWith(saved.id);
    expect(db.subscribe).toHaveBeenCalledWith(expect.any(Function), { loadAll: false });
    expect(result.current.order).toBe(saved); expect(result.current.order?.photos[0].storagePath).toBe("original-only");
    const updated = { ...saved, diagnosis: "Confirmed save from another screen" };
    db.cached.mockReturnValue(updated); act(() => db.listeners.forEach((listener) => listener()));
    expect(result.current.order).toBe(updated); expect(db.read).toHaveBeenCalledTimes(1);
  });
  it("does not issue a read before the authenticated tenant is known", async () => {
    const { rerender, result } = renderHook(({ tenant }) => useWorkOrderDetailRecord("WO-00049", tenant), { initialProps: { tenant: undefined as string | undefined } });
    expect(db.read).not.toHaveBeenCalled(); expect(result.current.loading).toBe(true);
    rerender({ tenant: "tenant-a" }); await waitFor(() => expect(result.current.loading).toBe(false));
    expect(db.read).toHaveBeenCalledExactlyOnceWith("WO-00049");
  });
  it("keeps a deleted/archived record available to the existing restore-only interface", async () => {
    const deleted = { ...record(), deletedAt: "2026-11-01T00:00:00Z", archivedAt: "2026-10-31T00:00:00Z" };
    db.read.mockResolvedValue(deleted); const { result } = renderHook(() => useWorkOrderDetailRecord(deleted.id, "tenant-a"));
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.order).toEqual(deleted);
  });
  it("reports an actual load failure and retries the same record without returning a stale cached success", async () => {
    db.cached.mockReturnValue(record()); db.read.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(record());
    const { result } = renderHook(() => useWorkOrderDetailRecord("WO-I-26-0113", "tenant-a"));
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.error?.message).toBe("offline"); expect(result.current.order).toBeUndefined();
    act(() => result.current.retry()); await waitFor(() => expect(result.current.order?.id).toBe("WO-I-26-0113")); expect(db.read).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a confirmed missing record from a network failure", async () => {
    db.read.mockResolvedValue(null); const { result } = renderHook(() => useWorkOrderDetailRecord("WO-99999", "tenant-a"));
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.error).toBeNull(); expect(result.current.order).toBeUndefined();
  });
  it("rejects a late result and a late local setter from the previous record", async () => {
    const first = deferred<WorkOrder>(); db.read.mockReturnValueOnce(first.promise).mockResolvedValueOnce(record("WO-C-26-0001"));
    const { result, rerender } = renderHook(({ id }) => useWorkOrderDetailRecord(id, "tenant-a"), { initialProps: { id: "WO-I-26-0113" } });
    const oldSetter = result.current.setOrder; rerender({ id: "WO-C-26-0001" });
    await waitFor(() => expect(result.current.order?.id).toBe("WO-C-26-0001"));
    await act(async () => { first.resolve(record()); await first.promise; oldSetter(record()); });
    expect(result.current.order?.id).toBe("WO-C-26-0001"); expect(db.listeners.size).toBe(1);
  });
  it("does not expose a previous tenant's late record after switching workshops", async () => {
    const first = deferred<WorkOrder>(); db.read.mockReturnValueOnce(first.promise).mockResolvedValueOnce(record("NEW-TENANT-ORDER"));
    const { result, rerender } = renderHook(({ tenant }) => useWorkOrderDetailRecord("same-id", tenant), { initialProps: { tenant: "tenant-a" } });
    rerender({ tenant: "tenant-b" }); await waitFor(() => expect(result.current.order?.id).toBe("NEW-TENANT-ORDER"));
    await act(async () => { first.resolve(record("OLD-TENANT-ORDER")); await first.promise; });
    expect(result.current.order?.id).toBe("NEW-TENANT-ORDER");
  });
  it("resolves the same historical route again when another screen renumbers the cached order", async () => {
    db.read.mockResolvedValueOnce(record()).mockResolvedValueOnce(record("WO-C-26-0018"));
    const { result } = renderHook(() => useWorkOrderDetailRecord("WO-I-26-0113", "tenant-a"));
    await waitFor(() => expect(result.current.order?.id).toBe("WO-I-26-0113"));
    act(() => db.listeners.forEach((listener) => listener()));
    await waitFor(() => expect(result.current.order?.id).toBe("WO-C-26-0018"));
    expect(db.read.mock.calls).toEqual([["WO-I-26-0113"], ["WO-I-26-0113"]]);
  });
  it("removes editable data after a confirmed deletion on another screen", async () => {
    db.read.mockResolvedValueOnce(record()).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useWorkOrderDetailRecord("WO-I-26-0113", "tenant-a"));
    await waitFor(() => expect(result.current.order).toBeDefined());
    act(() => db.listeners.forEach((listener) => listener()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.order).toBeUndefined(); expect(db.read).toHaveBeenCalledTimes(2);
  });
});
