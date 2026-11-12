import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession }, from: mocks.from, channel: mocks.channel, removeChannel: mocks.removeChannel },
}));

import { clearCloudSettingsCache, listCachedCloudKeys, readCloudSetting, setCloudSettingsTenantScope, subscribeCloudSetting } from "@/lib/cloudSettings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  clearCloudSettingsCache();
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user" } } } });
});

describe("cloud settings tenant isolation", () => {
  it("discards a previous tenant's late response without delaying or replacing the new tenant settings", async () => {
    let currentTenant = "tenant-a";
    const a = deferred<{ data: { value: string; version: number }; error: null }>();
    const b = deferred<{ data: { value: string; version: number }; error: null }>();
    const queriedTenants: string[] = [];
    mocks.getCurrentTenantId.mockImplementation(async () => currentTenant);
    mocks.from.mockImplementation(() => {
      let tenant = "";
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (column === "tenant_id") tenant = value;
          return query;
        },
        maybeSingle: () => {
          queriedTenants.push(tenant);
          return tenant === "tenant-a" ? a.promise : b.promise;
        },
      };
      return query;
    });

    const oldRead = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(queriedTenants).toEqual(["tenant-a"]));
    clearCloudSettingsCache();
    currentTenant = "tenant-b";
    const newRead = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(queriedTenants).toEqual(["tenant-a", "tenant-b"]));

    a.resolve({ data: { value: "Old Company", version: 1 }, error: null });
    expect(await oldRead).toBe("fallback");
    b.resolve({ data: { value: "Current Company", version: 1 }, error: null });
    expect(await newRead).toBe("Current Company");
    expect(listCachedCloudKeys()).toEqual(["tenant-b:company-name"]);
  });

  it("ignores an older Realtime version after a newer cloud snapshot", async () => {
    let onChange: ((payload: { new: { tenant_id: string; key: string; value: string; version: number } }) => void) | undefined;
    mocks.getCurrentTenantId.mockResolvedValue("tenant-a");
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () => Promise.resolve({
        data: { value: "Current Company", version: 2 },
        error: null,
      }),
    };
    mocks.from.mockReturnValue(query);
    mocks.channel.mockReturnValue({
      on: (_event: string, _filter: unknown, callback: typeof onChange) => {
        onChange = callback;
        return { subscribe: () => ({}) };
      },
    });
    setCloudSettingsTenantScope("tenant-a");
    const unsubscribe = subscribeCloudSetting("company-name", vi.fn());
    expect(await readCloudSetting("company-name", "fallback")).toBe("Current Company");
    onChange?.({ new: { tenant_id: "tenant-a", key: "company-name", value: "Old Company", version: 1 } });
    expect(await readCloudSetting("company-name", "fallback")).toBe("Current Company");
    unsubscribe();
  });
});
