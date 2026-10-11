// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { markClean, markDirty } from "@/lib/unsavedWork";

const realtime = vi.hoisted(() => ({
  callbacks: new Map<string, (payload: unknown) => void>(),
  filters: new Map<string, string>(),
  pathname: "/vehicles",
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: realtime.pathname }) }));
vi.mock("@/lib/expensesStore", () => ({ applyExpenseRealtimeChange: vi.fn() }));
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
    client = new QueryClient();
    invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
  });

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
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vehicles"], refetchType: "active" });
  });

  it("defers query refresh until unsaved work is clean", () => {
    act(() => { markDirty("realtime-test-draft"); realtime.callbacks.get("vehicles")?.({}); vi.advanceTimersByTime(5_000); });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { markClean("realtime-test-draft"); vi.advanceTimersByTime(1_500); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vehicles"], refetchType: "active" });
  });

  it("invalidates expense lists and financial reports after an expense changes", () => {
    cleanup();
    realtime.pathname = "/accounting/reports/monthly-vehicle-profitability";
    render(<QueryClientProvider client={client}><MountedSync /></QueryClientProvider>);
    act(() => { realtime.callbacks.get("expenses")?.({}); vi.advanceTimersByTime(1_500); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["expense_management"], refetchType: "active" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["monthly-vehicle-profitability"], refetchType: "active" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["monthly-workshop-report"], refetchType: "active" });
  });
});
