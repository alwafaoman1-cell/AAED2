// @vitest-environment jsdom
import { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ tenant: "tenant-a" as string | null, user: "staff-a" as string | null, read: vi.fn(), channels: vi.fn(), remove: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: mock.tenant ? { tenant_id: mock.tenant, user_id: mock.user } : null }) }));
vi.mock("@/lib/workflowRequirements", () => ({ WORKFLOW_REQUIREMENT_QUERY_KEY: "workflow_requirement_policy", readWorkflowRequirementPolicy: mock.read }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel: mock.channels, removeChannel: mock.remove } }));
import { useWorkflowRequirements } from "@/hooks/useWorkflowRequirements";
const policy = (tenant_id = "tenant-a", requirements_enabled = false) => ({ tenant_id, requirements_enabled, revision: 1, reason: "Trial", updated_by: "admin", updated_at: "2026-11-23" });
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); mock.tenant = "tenant-a"; mock.user = "staff-a";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mock.channels.mockImplementation(() => { const channel = { on: () => channel, subscribe: () => channel }; return channel; });
});
afterEach(() => { cleanup(); client.clear(); });

describe("workflow requirements fail closed and share subscriptions", () => {
  it("keeps enforcement during a pending read and accepts only its confirmed tenant policy", async () => {
    let resolve!: (value: ReturnType<typeof policy>) => void;
    mock.read.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useWorkflowRequirements(), { wrapper });
    expect(result.current.requirementsEnabled).toBe(true);
    expect(result.current.policy).toBeNull();
    act(() => resolve(policy()));
    await waitFor(() => expect(result.current.requirementsEnabled).toBe(false));
  });
  it("does not reuse a previous tenant's disabled state or a late response after switching", async () => {
    let resolveA!: (value: ReturnType<typeof policy>) => void;
    let resolveB!: (value: ReturnType<typeof policy>) => void;
    mock.read.mockImplementation((tenant: string) => new Promise(done => { if (tenant === "tenant-a") resolveA = done; else resolveB = done; }));
    const { result, rerender } = renderHook(() => useWorkflowRequirements(), { wrapper });
    act(() => { mock.tenant = "tenant-b"; rerender(); });
    act(() => resolveA(policy()));
    expect(result.current.requirementsEnabled).toBe(true);
    act(() => resolveB(policy("tenant-b", true)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.policy?.tenant_id).toBe("tenant-b");
    expect(result.current.requirementsEnabled).toBe(true);
  });
  it("ignores a cached disabled policy after an unsuccessful refresh or logout", async () => {
    mock.read.mockResolvedValue(policy());
    const { result, rerender } = renderHook(() => useWorkflowRequirements(), { wrapper });
    await waitFor(() => expect(result.current.requirementsEnabled).toBe(false));
    mock.read.mockRejectedValue(new Error("offline"));
    await act(async () => { await result.current.refresh().catch(() => undefined); });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.requirementsEnabled).toBe(true);
    expect(result.current.policy).toBeNull();
    act(() => { mock.tenant = null; mock.user = null; rerender(); });
    expect(result.current.requirementsEnabled).toBe(true);
  });
  it("deduplicates cloud reads and one realtime subscription across multiple forms", async () => {
    mock.read.mockResolvedValue(policy());
    const { result, unmount } = renderHook(() => [useWorkflowRequirements(), useWorkflowRequirements()], { wrapper });
    await waitFor(() => expect(result.current.every(value => !value.requirementsEnabled)).toBe(true));
    expect(mock.read).toHaveBeenCalledTimes(1);
    expect(mock.channels).toHaveBeenCalledTimes(1);
    unmount();
    expect(mock.remove).toHaveBeenCalledTimes(1);
  });
});
