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

beforeEach(() => {
  clearTenantCache();
  vi.clearAllMocks();
});

describe("tenant cache session isolation", () => {
  it("deduplicates concurrent tenant lookups for one session", async () => {
    const profile = deferred<{ data: { tenant_id: string }; error: null }>();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => profile.promise }) }) });
    const first = getCurrentTenantId();
    const second = getCurrentTenantId();
    profile.resolve({ data: { tenant_id: "tenant-a" }, error: null });
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
    const oldProfile = deferred<{ data: { tenant_id: string }; error: null }>();
    const newProfile = deferred<{ data: { tenant_id: string }; error: null }>();
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
    oldProfile.resolve({ data: { tenant_id: "tenant-a" }, error: null });
    expect(await oldRequest).toBeNull();
    const joinedNewRequest = getCurrentTenantId();
    newProfile.resolve({ data: { tenant_id: "tenant-b" }, error: null });
    expect(await Promise.all([newRequest, joinedNewRequest])).toEqual(["tenant-b", "tenant-b"]);
    expect(await getCurrentTenantId()).toBe("tenant-b");
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after a transient lookup error", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { user: { id: "user-b" } } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: "tenant-b" }, error: null }) }) }) });
    await expect(getCurrentTenantId()).rejects.toThrow("offline");
    expect(await getCurrentTenantId()).toBe("tenant-b");
  });
});
