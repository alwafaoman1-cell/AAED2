// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVehicleLabelSelection } from "@/hooks/useVehicleLabelSelection";

const mocks = vi.hoisted(() => ({ page: vi.fn(), all: vi.fn(), print: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ listVehicleVisitCenterPage: mocks.page, listAllMatchingVehicleCenter: mocks.all }));
vi.mock("@/lib/vehicleEntryLabelSheet", () => ({ printVehicleEntryLabelSheets: mocks.print }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
const token = "a".repeat(32);
const row = (id: string) => ({ id, entry_number: id });
const input = { tenant: "t1", tab: "in_workshop" as const, filters: { search: "A" }, token, total: 31, rows: [row("A1"), row("A2")] };
beforeEach(() => { vi.clearAllMocks();mocks.page.mockResolvedValue({ scopeToken: token });mocks.print.mockImplementation(async (read) => read()); });

describe("filter-scoped vehicle-label selection", () => {
  it("keeps selected vehicles across pages but resets for a new tenant or filter", () => {
    const { result, rerender } = renderHook((props) => useVehicleLabelSelection(props), { initialProps: input });
    act(() => result.current.toggle(row("A1"), true));
    rerender({ ...input, rows: [row("A31")] });
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle(row("A31"), true));expect(result.current.count).toBe(2);
    rerender({ ...input, filters: { search: "B" } });expect(result.current.count).toBe(0);
    act(() => result.current.toggle(row("B1"), true));
    rerender({ ...input, tenant: "t2", filters: { search: "B" } });expect(result.current.count).toBe(0);
  });
  it("selects all matching results lazily, supports exclusions, and prints beyond this page", async () => {
    const { result } = renderHook(() => useVehicleLabelSelection(input));
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(31);expect(mocks.all).not.toHaveBeenCalled();
    act(() => result.current.toggle(row("A2"), false));expect(result.current.count).toBe(30);
    expect(result.current.pageChecked).toBe("indeterminate");
    mocks.all.mockResolvedValue(["A1", "A2", "A31"].map((id) => ({ entry: row(id) })));
    await act(async () => { await result.current.print(); });
    expect(mocks.all).toHaveBeenCalledWith({ tab: "in_workshop", filters: { search: "A" }, expectedScopeToken: token });
    expect(await mocks.print.mock.results[0].value).toMatchObject([row("A1"), row("A31")]);
  });
  it("prints just the selected snapshots after a fresh bounded scope check", async () => {
    const { result } = renderHook(() => useVehicleLabelSelection(input));
    act(() => result.current.toggle(row("A1"), true));
    await act(async () => { await result.current.print(); });
    expect(mocks.page).toHaveBeenCalledWith({ tab: "in_workshop", filters: { search: "A" }, page: 1, pageSize: 1 });
    expect(mocks.all).not.toHaveBeenCalled();
    expect(await mocks.print.mock.results[0].value).toEqual([row("A1")]);
  });
  it("rejects changed source data and clears selections when a refreshed page changes scope", async () => {
    const { result, rerender } = renderHook((props) => useVehicleLabelSelection(props), { initialProps: input });
    act(() => result.current.toggle(row("A1"), true));mocks.page.mockResolvedValue({ scopeToken: "b".repeat(32) });
    await act(async () => { await result.current.print(); });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    rerender({ ...input, token: "b".repeat(32) });expect(result.current.count).toBe(0);
  });
  it("aborts a pending preview when the filter changes or the view unmounts", async () => {
    let signal: AbortSignal | undefined;
    mocks.print.mockImplementation(async (_read, _language, _loading, value) => { signal = value; });
    const { result, unmount } = renderHook(() => useVehicleLabelSelection(input));
    act(() => result.current.togglePage(true));await act(async () => { await result.current.print(); });
    expect(signal?.aborted).toBe(false);unmount();expect(signal?.aborted).toBe(true);
  });
});
