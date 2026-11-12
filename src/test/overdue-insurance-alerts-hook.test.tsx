// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverdueInsuranceAlerts } from "@/hooks/useOverdueInsuranceAlerts";
import type { ReactNode } from "react";

const runtime = vi.hoisted(() => ({
  profile: { tenant_id: "tenant-1", user_id: "user-1", role: "manager" } as { tenant_id: string; user_id: string; role: string } | null,
  language: "en",
  fetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: runtime.profile }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: runtime.language } }) }));
vi.mock("@/lib/overdueInsuranceSummary", () => ({
  overdueInsuranceQueryKey: ["insurance_claims", "overdue_summary"],
  fetchOverdueInsuranceSummary: runtime.fetch,
}));

describe("shared overdue notification query", () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  beforeEach(() => {
    runtime.profile = { tenant_id: "tenant-1", user_id: "user-1", role: "manager" };
    runtime.language = "en";
    runtime.fetch.mockReset().mockResolvedValue([]);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => { cleanup(); client.clear(); });

  it("shares both bells' reads and exposes confirmed empty separately from pending", async () => {
    let resolve!: (data: never[]) => void;
    runtime.fetch.mockReturnValue(new Promise<never[]>((done) => { resolve = done; }));
    const first = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    const second = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    expect(first.result.current.isPending).toBe(true);
    expect(first.result.current.data).toBeUndefined();
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve([]); });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toEqual([]);
    expect(runtime.fetch.mock.calls[0]).toEqual(["tenant-1", expect.any(AbortSignal), "Unspecified"]);
  });

  it("does not turn an error into an empty or zero-valued result", async () => {
    const error = new Error("permission denied");
    runtime.fetch.mockRejectedValue(error);
    const { result } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not request data before an authenticated tenant/profile is available", () => {
    runtime.profile = null;
    const { result } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it("partitions cached results across tenants, users and permission roles", async () => {
    runtime.fetch.mockResolvedValueOnce([{ name: "Tenant one" }]);
    const { result, rerender } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    runtime.fetch.mockImplementation(() => new Promise(() => {}));
    runtime.profile = { tenant_id: "tenant-2", user_id: "user-2", role: "technician" };
    rerender();
    expect(result.current.data).toBeUndefined();
    expect(runtime.fetch).toHaveBeenLastCalledWith("tenant-2", expect.any(AbortSignal), "Unspecified");
  });

  it("coalesces invoice/company/payment invalidations with two bells and no full-table readers", async () => {
    const first = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    runtime.fetch.mockClear();
    await act(async () => {
      await Promise.all(["insurance_invoices", "insurance_companies", "claim_payments"].map((root) =>
        client.invalidateQueries({ queryKey: [root] })));
    });
    await waitFor(() => expect(runtime.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(first.result.current.isFetching).toBe(false));
    await act(async () => { await client.invalidateQueries({ queryKey: ["insurance_invoices"] }); });
    await waitFor(() => expect(runtime.fetch).toHaveBeenCalledTimes(2));
    expect(client.getQueryCache().findAll({ queryKey: ["insurance_invoices"] }).every((q) => q.queryKey[1] === "overdue_invalidation")).toBe(true);
  });

  it("refreshes after direct local claim cache updates without recursively invalidating itself", async () => {
    const { result } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    runtime.fetch.mockClear();
    await act(async () => { client.setQueryData(["insurance_claims", "claim-1"], { approved_at: "2026-01-01" }); });
    await waitFor(() => expect(runtime.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a summary refresh already covered by a central realtime batch", async () => {
    const { result } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    runtime.fetch.mockClear();
    await act(async () => { await client.invalidateQueries({
      predicate: (query) => ["insurance_claims", "insurance_invoices", "claim_payments"].includes(String(query.queryKey[0])),
      refetchType: "active",
    }); });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let an older initial in-flight read swallow a payment change", async () => {
    runtime.fetch.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useOverdueInsuranceAlerts(), { wrapper });
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
    const oldSignal = runtime.fetch.mock.calls[0][1] as AbortSignal;
    await act(async () => { await client.invalidateQueries({ queryKey: ["insurance_invoices"] }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(oldSignal.aborted).toBe(true);
    expect(runtime.fetch).toHaveBeenCalledTimes(2);
  });
});
