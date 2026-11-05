// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: mocks, from: mocks.from } }));
import { clearAllAuthProfileCache, getCachedAuthProfile } from "@/lib/authProfileCache";

const user = { id: "user-a", user_metadata: { tenant_id: "forged-tenant", role: "admin", full_name: "Display name" } };
const session = { user, access_token: "offline-test-token" } as any;
const active = { id: "profile-a", user_id: user.id, tenant_id: "confirmed-tenant", role: "accountant", account_status: "active", disabled_at: null };
function cloud(data: unknown, error: unknown = null) {
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) });
}

beforeEach(() => {
  clearAllAuthProfileCache();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  cloud(active);
});

describe("confirmed cloud profile authority", () => {
  it.each([
    null,
    { ...active, user_id: "other-user" },
    { ...active, tenant_id: null },
    { ...active, role: null },
    { ...active, role: "owner" },
    { ...active, account_status: "disabled" },
    { ...active, account_status: "invited" },
    { ...active, account_status: undefined },
    { ...active, disabled_at: "2026-01-01T00:00:00Z" },
  ])("never derives authority from metadata when the cloud identity is invalid: %j", async (row) => {
    cloud(row);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await getCachedAuthProfile(user.id, { session })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses metadata for display only, preserving the confirmed role and tenant", async () => {
    expect(await getCachedAuthProfile(user.id, { session })).toMatchObject({
      user_id: user.id, tenant_id: active.tenant_id, role: "accountant", full_name: "Display name",
    });
  });

  it("does not authorize a browser-stored admin snapshot without revalidation", async () => {
    sessionStorage.setItem("alwafa.auth.profile." + user.id, JSON.stringify({ cached_at: Date.now(), profile: { ...active, role: "admin" } }));
    cloud(null);
    expect(await getCachedAuthProfile(user.id, { session })).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("alwafa.auth.profile." + user.id)).toBeNull();
  });

  it("keeps one sequential REST recovery path after a transport failure", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "offline-public-key");
    cloud(null, new Error("temporary SDK transport failure"));
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [active] });
    vi.stubGlobal("fetch", fetch);
    expect((await getCachedAuthProfile(user.id, { session }))?.role).toBe("accountant");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when both transports fail, rather than using metadata", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "offline-public-key");
    cloud(null, new Error("network unavailable"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    expect(await getCachedAuthProfile(user.id, { session })).toBeNull();
  });

  it("invalidates confirmed in-memory authority on explicit refresh", async () => {
    expect((await getCachedAuthProfile(user.id, { session }))?.role).toBe("accountant");
    cloud({ ...active, account_status: "disabled" });
    expect(await getCachedAuthProfile(user.id, { session, forceRefresh: true })).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });
});
