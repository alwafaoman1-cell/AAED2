import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: mocks.getUser, onAuthStateChange: mocks.onAuthStateChange },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import { clearTenantCache, getCurrentTenantId, setCachedTenantId } from "@/lib/cloud/createCloudStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const active = (tenant_id: string, user_id = "user-a") => ({ tenant_id, user_id, account_status: "active", disabled_at: null });
type Active = ReturnType<typeof active>;

beforeEach(() => {
  clearTenantCache();
  vi.clearAllMocks();
});

describe("tenant cache session isolation", () => {
  it("deduplicates concurrent tenant lookups for one session", async () => {
    const profile = deferred<{ data: Active; error: null }>();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => profile.promise }) }) });
    const first = getCurrentTenantId();
    const second = getCurrentTenantId();
    profile.resolve({ data: active("tenant-a"), error: null });
    expect(await Promise.all([first, second])).toEqual(["tenant-a", "tenant-a"]);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("ignores a lookup that completes after logout and a new user's tenant is seeded", async () => {
    const oldUser = deferred<{ data: { user: { id: string } } }>();
    mocks.getUser.mockReturnValue(oldUser.promise);
    const pending = getCurrentTenantId();
    clearTenantCache();
    setCachedTenantId("tenant-b");
    oldUser.resolve({ data: { user: { id: "user-a" } } });
    expect(await pending).toBeNull();
    expect(await getCurrentTenantId()).toBe("tenant-b");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not cache a former user's late profile or clear the new user's pending lookup", async () => {
    const oldProfile = deferred<{ data: Active; error: null }>();
    const newProfile = deferred<{ data: Active; error: null }>();
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "user-a" } } })
      .mockResolvedValueOnce({ data: { user: { id: "user-b" } } });
    mocks.from.mockReturnValue({
      select: () => ({
        eq: (_column: string, uid: string) => ({ maybeSingle: () => uid === "user-a" ? oldProfile.promise : newProfile.promise }),
      }),
    });
    const oldRequest = getCurrentTenantId();
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    clearTenantCache();
    const newRequest = getCurrentTenantId();
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
    oldProfile.resolve({ data: active("tenant-a"), error: null });
    expect(await oldRequest).toBeNull();
    const joinedNewRequest = getCurrentTenantId();
    newProfile.resolve({ data: active("tenant-b", "user-b"), error: null });
    expect(await Promise.all([newRequest, joinedNewRequest])).toEqual(["tenant-b", "tenant-b"]);
    expect(await getCurrentTenantId()).toBe("tenant-b");
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after a transient lookup error", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { user: { id: "user-b" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: active("tenant-b", "user-b"), error: null }) }) }) });
    await expect(getCurrentTenantId()).rejects.toThrow("offline");
    expect(await getCurrentTenantId()).toBe("tenant-b");
  });
  it.each([null, { ...active("tenant-a"), account_status: "disabled" }, { ...active("tenant-a"), account_status: "invited" }, { ...active("tenant-a"), disabled_at: "2026-01-01" }])("does not restore denied authority through legacy role fallback: %j", async (data) => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
    expect(await getCurrentTenantId()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("uses only the guarded server tenant helper after a profile transport failure", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("SDK failed") }) }) }) });
    mocks.rpc.mockResolvedValue({ data: "tenant-a", error: null });
    expect(await getCurrentTenantId()).toBe("tenant-a");
    expect(mocks.rpc).toHaveBeenCalledWith("get_user_tenant_id");
    clearTenantCache();
    const error = new Error("RPC unavailable");
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(getCurrentTenantId()).rejects.toBe(error);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
  it("cannot apply a late guarded-RPC tenant after logout/new-tenant initialization", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("SDK failed") }) }) }) });
    const rpc = deferred<{ data: string; error: null }>();
    mocks.rpc.mockReturnValue(rpc.promise);
    const pending = getCurrentTenantId();
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    clearTenantCache(); setCachedTenantId("tenant-b");
    rpc.resolve({ data: "tenant-a", error: null });
    expect(await pending).toBeNull();
    expect(await getCurrentTenantId()).toBe("tenant-b");
  });
});
