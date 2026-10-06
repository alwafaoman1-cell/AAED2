import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession, getUser: mocks.getUser, signOut: mocks.signOut },
    from: mocks.from,
  },
}));

import { __authProfileCacheSizeForTests, clearAllAuthProfileCache, getCachedAuthProfile } from "@/lib/authProfileCache";

const session = (id: string) => ({ user: { id }, access_token: `token-${id}` }) as any;

beforeEach(() => {
  clearAllAuthProfileCache();
  vi.clearAllMocks();
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: "profile", user_id: "user-a", tenant_id: "tenant-a", role: "manager", full_name: "Test" },
      error: null,
    }) }) }),
  });
});

describe("auth profile runtime de-duplication", () => {
  it("verifies once for concurrent profile requests and reuses the supplied session", async () => {
    let resolveUser!: (value: any) => void;
    mocks.getUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    const first = getCachedAuthProfile("user-a", { session: session("user-a") });
    const second = getCachedAuthProfile("user-a", { session: session("user-a") });
    expect(__authProfileCacheSizeForTests().inFlight).toBe(1);
    resolveUser({ data: { user: { id: "user-a" } }, error: null });
    const [a, b] = await Promise.all([first, second]);
    expect(a?.tenant_id).toBe("tenant-a");
    expect(b?.tenant_id).toBe("tenant-a");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("never signs out after a transient verification failure", async () => {
    mocks.getUser.mockRejectedValue(new Error("network timeout"));
    await expect(getCachedAuthProfile("user-a", { session: session("user-a") })).rejects.toThrow("network timeout");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not cache a delayed result after session cleanup", async () => {
    let resolveUser!: (value: any) => void;
    mocks.getUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    const pending = getCachedAuthProfile("user-a", { session: session("user-a") });
    clearAllAuthProfileCache();
    resolveUser({ data: { user: { id: "user-a" } }, error: null });
    await pending;
    expect(__authProfileCacheSizeForTests()).toEqual({ cache: 0, inFlight: 0 });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
