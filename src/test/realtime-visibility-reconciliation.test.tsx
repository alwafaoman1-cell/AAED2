// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver, type InvalidateQueryFilters } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealtimeScope, useRealtimeSync } from "@/hooks/useRealtimeSync";
import { markClean, markDirty } from "@/lib/unsavedWork";

const realtime = vi.hoisted(() => ({
  callbacks: new Map<string, (payload: unknown) => void>(),
  filters: new Map<string, string>(),
  pathname: "/vehicles",
  applyExpense: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: realtime.pathname }) }));
vi.mock("@/lib/expensesStore", () => ({ applyExpenseRealtimeChange: realtime.applyExpense }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({
      on(_event: string, options: { table: string; filter: string }, callback: (payload: unknown) => void) {
        realtime.callbacks.set(options.table, callback);
        realtime.filters.set(options.table, options.filter);
        return this;
      },
      subscribe() { return this; },
    }),
    removeChannel: vi.fn(),
  },
}));

function MountedSync() { useRealtimeSync(); return null; }

describe("realtime visibility reconciliation", () => {
  it("keeps the required inspection summary/count invalidation on work order pages", () => {
    expect(getRealtimeScope("/work-orders").tables).toContain("inspections");
    expect(getRealtimeScope("/work-orders/WO-I-26-0001").tables).toContain("inspections");
  });
  let client: QueryClient;
  let visible: "visible" | "hidden";
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T08:00:00Z"));
    visible = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible });
    realtime.callbacks.clear();
    realtime.filters.clear();
    realtime.pathname = "/vehicles";
    realtime.applyExpense.mockReset().mockResolvedValue(undefined);
    client = new QueryClient();
    invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
  });

  function lastBatchMatches(key: string) {
    const filters = invalidate.mock.calls[invalidate.mock.calls.length - 1]?.[0] as InvalidateQueryFilters;
    expect(filters.refetchType).toBe("active");
    return filters.predicate!({ queryKey: [key] } as unknown as Parameters<NonNullable<InvalidateQueryFilters["predicate"]>>[0]);
  }

  afterEach(() => {
    cleanup();
    markClean("realtime-test-draft");
    client.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retains hidden-tab events and refetches after the return delay without page reload", () => {
    expect(realtime.filters.get("vehicles")).toBe("tenant_id=eq.tenant-1");
    act(() => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { realtime.callbacks.get("vehicles")?.({}); vi.advanceTimersByTime(5_000); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(1_999); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(lastBatchMatches("vehicles")).toBe(true);
  });

  it("defers query refresh until unsaved work is clean", () => {
    act(() => { markDirty("realtime-test-draft"); realtime.callbacks.get("vehicles")?.({}); vi.advanceTimersByTime(5_000); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { markClean("realtime-test-draft"); vi.advanceTimersByTime(1_500); });
    expect(lastBatchMatches("vehicles")).toBe(true);
  });

  it.each(["/vehicle-entry/entry-1", "/supervisor/entry/entry-1"])("refreshes the existing receipt and history readers after intake/signature events on %s", (pathname) => {
    cleanup();
    realtime.callbacks.clear();
    realtime.pathname = pathname;
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    expect(realtime.filters.get("vehicle_entry_signatures")).toBe("tenant_id=eq.tenant-1");
    act(() => {
      realtime.callbacks.get("vehicle_entries")?.({});
      realtime.callbacks.get("vehicle_entry_signatures")?.({});
      vi.advanceTimersByTime(1_500);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    for (const key of ["vehicle_entries", "vehicle-intake-receipts", "intake-receipt-history"]) {
      expect(lastBatchMatches(key)).toBe(true);
    }
    expect(lastBatchMatches("insurance_invoices")).toBe(false);
  });

  it("queues receipt and history updates until a dirty staff intake becomes clean", () => {
    cleanup();
    realtime.callbacks.clear();
    realtime.pathname = "/vehicle-entry/entry-1/edit";
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    act(() => {
      markDirty("realtime-test-draft");
      realtime.callbacks.get("vehicle_entry_signatures")?.({});
      vi.advanceTimersByTime(5_000);
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { markClean("realtime-test-draft"); vi.advanceTimersByTime(1_500); });
    expect(lastBatchMatches("vehicle_entries")).toBe(true);
    expect(lastBatchMatches("vehicle-intake-receipts")).toBe(true);
    expect(lastBatchMatches("intake-receipt-history")).toBe(true);
  });

  it("invalidates expense lists and financial reports after an expense changes", async () => {
    cleanup();
    realtime.pathname = "/accounting/reports/monthly-vehicle-profitability";
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    await act(async () => { realtime.callbacks.get("expenses")?.({}); });
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(lastBatchMatches("expense_management")).toBe(true);
    expect(lastBatchMatches("monthly-vehicle-profitability")).toBe(true);
    expect(lastBatchMatches("monthly-workshop-report")).toBe(true);
  });

  it.each(["/insurance/claims", "/insurance/claims/", "/insurance/list", "/insurance/pipeline"])("keeps %s on exactly the three list tables", (pathname) => {
    expect(getRealtimeScope(pathname)).toMatchObject({ scope: "claims_list", tables: ["insurance_claims", "vehicle_entries", "vehicle_visit_workflows"] });
  });

  it.each(["/insurance/claims/claim-1", "/insurance/claim-1", "/insurance/claim-1/archive", "/insurance/claim-1/audit"])("retains the detail refresh dependencies for %s", (pathname) => {
    const scope = getRealtimeScope(pathname);
    expect(scope.scope).toBe("claim_detail");
    expect(scope.tables).toHaveLength(11);
    expect(scope.tables).toContain("insurance_invoices");
    expect(scope.tables).toContain("claim_payments");
  });

  it("coalesces overlapping table events into one invalidation and ignores unrelated readers", () => {
    act(() => {
      realtime.callbacks.get("vehicles")?.({});
      realtime.callbacks.get("vehicle_media")?.({});
      realtime.callbacks.get("vehicles")?.({});
      vi.advanceTimersByTime(1_500);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    for (const key of ["vehicles", "customers", "vehicle_media", "vehicle_360", "job_orders"]) expect(lastBatchMatches(key)).toBe(true);
    expect(lastBatchMatches("insurance_invoices")).toBe(false);
  });

  it("lets the expense store own its existing invalidations without losing other financial refreshes", async () => {
    cleanup();
    realtime.pathname = "/accounting/expenses";
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    await act(async () => { realtime.callbacks.get("expenses")?.({ eventType: "UPDATE", new: { id: "expense-1" } }); });
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(realtime.applyExpense).toHaveBeenCalledTimes(1);
    expect(lastBatchMatches("expense_management")).toBe(false);
    expect(lastBatchMatches("monthly-vehicle-profitability")).toBe(false);
    for (const key of ["expenses", "job_orders", "journal_entries", "vehicle_360", "monthly-workshop-report"]) expect(lastBatchMatches(key)).toBe(true);
  });

  it("retains all invalidations if applying an expense event fails", async () => {
    cleanup();
    realtime.pathname = "/accounting/expenses";
    realtime.applyExpense.mockRejectedValue(new Error("legacy cache unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    await act(async () => { realtime.callbacks.get("expenses")?.({ eventType: "UPDATE", new: { id: "expense-1" } }); });
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(lastBatchMatches("expense_management")).toBe(true);
    expect(lastBatchMatches("monthly-vehicle-profitability")).toBe(true);
  });

  it("does not schedule delayed expense refreshes after leaving the scope", async () => {
    cleanup();
    realtime.pathname = "/accounting/expenses";
    let resolve!: () => void;
    realtime.applyExpense.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    await act(async () => { realtime.callbacks.get("expenses")?.({ eventType: "UPDATE", new: { id: "expense-1" } }); });
    cleanup();
    await act(async () => { resolve(); });
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("marks inactive readers stale without refetching them, while refreshing active readers", async () => {
    invalidate.mockRestore();
    const activeRead = vi.fn().mockResolvedValue("new vehicles");
    const inactiveRead = vi.fn().mockResolvedValue("new media");
    client.setQueryData(["vehicles"], "old vehicles");
    client.setQueryData(["vehicle_media"], "old media");
    client.setQueryDefaults(["vehicle_media"], { queryFn: inactiveRead });
    const observer = new QueryObserver(client, { queryKey: ["vehicles"], queryFn: activeRead, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await act(async () => { realtime.callbacks.get("vehicle_media")?.({}); vi.advanceTimersByTime(1_500); });
    expect(activeRead).toHaveBeenCalledTimes(1);
    expect(inactiveRead).not.toHaveBeenCalled();
    expect(client.getQueryState(["vehicle_media"])!.isInvalidated).toBe(true);
    unsubscribe();
  });

  it("reconciles stale active readers after a long hidden period even without an event", () => {
    client.setQueryData(["vehicles"], "cached vehicles");
    const read = vi.fn().mockResolvedValue("fresh vehicles");
    const observer = new QueryObserver(client, { queryKey: ["vehicles"], queryFn: read, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    act(() => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(31_000); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(2_000); });
    expect(lastBatchMatches("vehicles")).toBe(true);
    expect(read).not.toHaveBeenCalled();
    unsubscribe();
  });
});
