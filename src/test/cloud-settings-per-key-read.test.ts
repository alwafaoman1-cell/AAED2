import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenant: "tenant-a" as string | null,
  getCurrentTenantId: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession, getUser: mocks.getUser },
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

import {
  clearCloudSettingsCache,
  getCloudSettingsScopeVersion,
  listCachedCloudKeys,
  readCloudSetting,
  readCloudSettingFresh,
  setCloudSettingsTenantScope,
  subscribeCloudSetting,
  writeCloudSetting,
} from "@/lib/cloudSettings";

type ReadResult = { data: { value: unknown; version: number } | null; error: Error | null };
type SettingRow = { tenant_id?: string; key?: string; value?: unknown; version?: number; id?: string };
type Change = { eventType?: "INSERT" | "UPDATE" | "DELETE"; new?: SettingRow; old?: SettingRow };
const changes: Array<(payload: Change) => void> = [];
const unsubscribes: Array<() => void> = [];
let now = 1_800_000_000_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function snapshot(value: unknown, version = 1): ReadResult {
  return { data: { value, version }, error: null };
}

function watch(key = "company-name") {
  const listener = vi.fn();
  unsubscribes.push(subscribeCloudSetting(key, listener));
  return listener;
}

function update(value: unknown, version: number, key = "company-name", tenantId = "tenant-a") {
  changes[changes.length - 1]({ eventType: "UPDATE", new: { tenant_id: tenantId, key, value, version } });
}

beforeEach(() => {
  clearCloudSettingsCache();
  vi.resetAllMocks();
  mocks.tenant = "tenant-a";
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  changes.length = 0;
  mocks.getCurrentTenantId.mockImplementation(async () => mocks.tenant);
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-a" } } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mocks.read.mockResolvedValue(snapshot("Cloud Company"));
  mocks.save.mockResolvedValue({ data: { version: 3 }, error: null });
  mocks.removeChannel.mockResolvedValue("ok");
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe("tenant_settings");
    let columns = "";
    let payload: unknown;
    const filters: Record<string, unknown> = {};
    return {
      select(selected: string) { columns = selected; return this; },
      eq(column: string, value: unknown) { filters[column] = value; return this; },
      maybeSingle() {
        // A query without BOTH predicates, or any tenant-wide select, fails.
        expect(columns).toBe("value,version");
        expect(Object.keys(filters).sort()).toEqual(["key", "tenant_id"]);
        expect(typeof filters.tenant_id).toBe("string");
        expect(typeof filters.key).toBe("string");
        return mocks.read({ tenantId: filters.tenant_id, key: filters.key });
      },
      upsert(value: unknown) { payload = value; return this; },
      single() { expect(columns).toBe("version"); return mocks.save(payload); },
    };
  });
  mocks.channel.mockImplementation(() => ({
    on(_event: string, _filter: unknown, callback: (payload: Change) => void) {
      changes.push(callback);
      return { subscribe: () => ({}) };
    },
  }));
});

afterEach(() => {
  unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
  clearCloudSettingsCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("selective cloud setting reads", () => {
  it("selects only the requested tenant/key and never preloads operational settings", async () => {
    expect(await readCloudSetting("company-name", "fallback")).toBe("Cloud Company");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ tenantId: "tenant-a", key: "company-name" });
    expect(listCachedCloudKeys()).toEqual(["tenant-a:company-name"]);
  });

  it("deduplicates concurrent cold reads of one key, including first tenant resolution", async () => {
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValue(result.promise);
    const reads = [readCloudSetting("company-name", "one"), readCloudSetting("company-name", "two")];
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    result.resolve(snapshot("Shared"));
    expect(await Promise.all(reads)).toEqual(["Shared", "Shared"]);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("does not delay one key behind another key's in-flight read", async () => {
    const slow = deferred<ReadResult>();
    mocks.read.mockImplementation(({ key }: { key: string }) => key === "slow" ? slow.promise : Promise.resolve(snapshot("Fast")));
    const slowRead = readCloudSetting("slow", "fallback");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(await readCloudSetting("fast", "fallback")).toBe("Fast");
    slow.resolve(snapshot("Slow"));
    expect(await slowRead).toBe("Slow");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("caches confirmed absence for 30 seconds without sharing callers' defaults", async () => {
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(result.promise);
    const a = readCloudSetting("missing", "default-a");
    const b = readCloudSetting("missing", "default-b");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    result.resolve({ data: null, error: null });
    expect(await Promise.all([a, b])).toEqual(["default-a", "default-b"]);
    now += 29_999;
    expect(await readCloudSetting("missing", "default-c")).toBe("default-c");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await readCloudSetting("missing", "default-d")).toBe("Cloud Company");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each([false, 0, "", null])("preserves a present setting with the falsy value %s", async (value) => {
    mocks.read.mockResolvedValue(snapshot(value));
    expect(await readCloudSetting<unknown>("falsy", "fallback")).toBe(value);
    expect(await readCloudSetting<unknown>("falsy", "another-default")).toBe(value);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("expires each key independently, measured from its own successful response", async () => {
    await readCloudSetting("first", "fallback");
    now += 10_000;
    await readCloudSetting("second", "fallback");
    now += 19_999;
    await readCloudSetting("first", "fallback");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    now += 1;
    await readCloudSetting("first", "fallback");
    await readCloudSetting("second", "fallback");
    expect(mocks.read.mock.calls.map(([query]) => query.key)).toEqual(["first", "second", "first"]);
  });

  it("starts TTL when the response completes, not when the request starts", async () => {
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(result.promise);
    const read = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    now += 40_000;
    result.resolve(snapshot("Slow response"));
    await read;
    now += 29_999;
    expect(await readCloudSetting("company-name", "fallback")).toBe("Slow response");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});

describe("failure is not confirmed empty", () => {
  it.each(["response error", "rejected request"])("keeps %s retryable and returns each waiter's own fallback", async (failure) => {
    if (failure === "response error") mocks.read.mockResolvedValueOnce({ data: null, error: new Error("42501") });
    else mocks.read.mockRejectedValueOnce(new Error("offline"));
    expect(await Promise.all([readCloudSetting("monthly", "one"), readCloudSetting("monthly", "two")])).toEqual(["one", "two"]);
    expect(listCachedCloudKeys()).toEqual([]);
    expect(await readCloudSetting("monthly", "fallback")).toBe("Cloud Company");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each(["no session", "session error"])("does not cache defaults after %s", async (failure) => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: failure === "session error" ? new Error("auth unavailable") : null });
    expect(await readCloudSetting("company-name", "fallback")).toBe("fallback");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(listCachedCloudKeys()).toEqual([]);
    expect(await readCloudSetting("company-name", "fallback")).toBe("Cloud Company");
  });

  it("does not turn a failed tenant lookup into a cached empty tenant", async () => {
    mocks.getCurrentTenantId.mockRejectedValueOnce(new Error("offline"));
    expect(await readCloudSetting("company-name", "fallback")).toBe("fallback");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(listCachedCloudKeys()).toEqual([]);
    expect(await readCloudSetting("company-name", "fallback")).toBe("Cloud Company");
  });

  it("returns the previous confirmed value on failure without renewing its TTL", async () => {
    await readCloudSetting("company-name", "fallback");
    now += 30_000;
    mocks.read.mockRejectedValueOnce(new Error("offline"));
    expect(await readCloudSetting("company-name", "fallback")).toBe("Cloud Company");
    mocks.read.mockResolvedValueOnce(snapshot("Recovered", 2));
    expect(await readCloudSetting("company-name", "fallback")).toBe("Recovered");
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it("still requires a confirmed financial read after an ordinary fallback", async () => {
    mocks.read.mockResolvedValue({ data: null, error: new Error("42501") });
    expect(await readCloudSetting("monthly", {})).toEqual({});
    await expect(readCloudSettingFresh("monthly", {}, { requireConfirmed: true })).rejects.toThrow("42501");
    expect(listCachedCloudKeys()).toEqual([]);
  });

  it("does not cache a confirmed fresh caller's fallback as the absent setting", async () => {
    mocks.read.mockResolvedValue({ data: null, error: null });
    expect(await readCloudSettingFresh("missing", "fresh-default", { requireConfirmed: true })).toBe("fresh-default");
    expect(await readCloudSetting("missing", "ordinary-default")).toBe("ordinary-default");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await readCloudSettingFresh("missing", "another-fresh-default", { requireConfirmed: true });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});

describe("version and Realtime ordering", () => {
  it("uses a newer Realtime value over a late read and ignores older/foreign/unrequested events", async () => {
    setCloudSettingsTenantScope("tenant-a");
    const listener = watch();
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(result.promise);
    const read = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    update("Latest", 3);
    update("Old", 2);
    update("Foreign", 9, "company-name", "tenant-b");
    update("Large operational data", 1, "unrequested-key");
    result.resolve(snapshot("Old HTTP", 1));
    expect(await read).toBe("Latest");
    expect(listener).toHaveBeenCalledExactlyOnceWith("Latest");
    expect(listCachedCloudKeys()).toEqual(["tenant-a:company-name"]);
  });

  it("does not renew TTL when an expired read returns an older version", async () => {
    mocks.read.mockResolvedValueOnce(snapshot("Latest", 3));
    await readCloudSetting("company-name", "fallback");
    now += 30_000;
    mocks.read.mockResolvedValueOnce(snapshot("Old", 2));
    expect(await readCloudSetting("company-name", "fallback")).toBe("Latest");
    mocks.read.mockResolvedValueOnce(snapshot("Next", 4));
    expect(await readCloudSetting("company-name", "fallback")).toBe("Next");
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it.each(["Realtime insert", "confirmed write", "confirmed fresh read"])("does not let an absent HTTP snapshot erase a concurrent %s", async (source) => {
    setCloudSettingsTenantScope("tenant-a");
    watch();
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(result.promise);
    const read = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    if (source === "Realtime insert") update("Latest", 3);
    else if (source === "confirmed write") await writeCloudSetting("company-name", "Latest");
    else {
      mocks.read.mockResolvedValueOnce(snapshot("Latest", 3));
      await readCloudSettingFresh("company-name", "fallback", { requireConfirmed: true });
    }
    result.resolve({ data: null, error: null });
    expect(await read).toBe("Latest");
    expect(await readCloudSetting("company-name", "fallback")).toBe("Latest");
  });

  it("revalidates an absent setting after its cached row is actually removed", async () => {
    await readCloudSetting("company-name", "fallback");
    now += 30_000;
    mocks.read.mockResolvedValueOnce({ data: null, error: null });
    expect(await readCloudSetting("company-name", "new-default")).toBe("new-default");
    expect(await readCloudSetting("company-name", "own-default")).toBe("own-default");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the deleted key and allows an inserted row's version to restart", async () => {
    setCloudSettingsTenantScope("tenant-a");
    watch();
    mocks.read.mockResolvedValueOnce(snapshot("Previous", 5));
    await readCloudSetting("company-name", "fallback");
    await readCloudSetting("other", "fallback");
    changes[0]({ eventType: "DELETE", new: {}, old: { tenant_id: "tenant-a", key: "company-name", version: 5 } });
    expect(listCachedCloudKeys()).toEqual(["tenant-a:other"]);
    update("Recreated", 1);
    expect(await readCloudSetting("company-name", "fallback")).toBe("Recreated");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("invalidates PK-only DELETE payloads without fabricating empty subscriber values", async () => {
    setCloudSettingsTenantScope("tenant-a");
    const listener = watch();
    await readCloudSetting("company-name", "fallback");
    await readCloudSetting("other", "fallback");
    changes[0]({ eventType: "DELETE", old: { id: "deleted-row" }, new: {} });
    expect(listCachedCloudKeys()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ data: null, error: null });
    expect(await readCloudSetting("company-name", "deleted-default")).toBe("deleted-default");
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it("ignores deletes from another tenant or an older known row version", async () => {
    setCloudSettingsTenantScope("tenant-a");
    watch();
    mocks.read.mockResolvedValueOnce(snapshot("Latest", 3));
    await readCloudSetting("company-name", "fallback");
    changes[0]({ eventType: "DELETE", old: { tenant_id: "tenant-b", key: "company-name", version: 9 } });
    changes[0]({ eventType: "DELETE", old: { tenant_id: "tenant-a", key: "company-name", version: 2 } });
    expect(await readCloudSetting("company-name", "fallback")).toBe("Latest");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a deleted row or let its old completion remove a new in-flight read", async () => {
    setCloudSettingsTenantScope("tenant-a");
    watch();
    const old = deferred<ReadResult>();
    const current = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldRead = readCloudSetting("company-name", "old-default");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    changes[0]({ eventType: "DELETE", old: { tenant_id: "tenant-a", key: "company-name", version: 1 } });
    const currentRead = readCloudSetting("company-name", "current-default");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    old.resolve(snapshot("Deleted", 1));
    expect(await oldRead).toBe("old-default");
    const joinedRead = readCloudSetting("company-name", "joined-default");
    current.resolve(snapshot("Recreated", 1));
    expect(await Promise.all([currentRead, joinedRead])).toEqual(["Recreated", "Recreated"]);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("rejects a confirmed fresh snapshot invalidated by a concurrent DELETE", async () => {
    setCloudSettingsTenantScope("tenant-a");
    watch();
    const result = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(result.promise);
    const read = readCloudSettingFresh("company-name", "fallback", { requireConfirmed: true });
    const rejected = expect(read).rejects.toThrow("CLOUD_SETTING_STALE_READ");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    changes[0]({ eventType: "DELETE", old: { id: "deleted-row" } });
    result.resolve(snapshot("Deleted", 1));
    await rejected;
    expect(listCachedCloudKeys()).toEqual([]);
  });
});

describe("logout and tenant transitions", () => {
  it("discards a pre-logout response during a new login to the same tenant", async () => {
    const old = deferred<ReadResult>();
    const current = deferred<ReadResult>();
    mocks.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldRead = readCloudSetting("company-name", "old-default");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    clearCloudSettingsCache();
    const currentRead = readCloudSetting("company-name", "new-default");
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    old.resolve(snapshot("Old session", 99));
    expect(await oldRead).toBe("old-default");
    const joinedRead = readCloudSetting("company-name", "joined-default");
    current.resolve(snapshot("New session", 1));
    expect(await Promise.all([currentRead, joinedRead])).toEqual(["New session", "New session"]);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each(["logout", "tenant switch"])("does not restore a stale tenant lookup after %s", async (transition) => {
    setCloudSettingsTenantScope("tenant-a");
    const tenant = deferred<string | null>();
    mocks.getCurrentTenantId.mockReturnValueOnce(tenant.promise);
    const read = readCloudSetting("company-name", "fallback");
    if (transition === "logout") clearCloudSettingsCache();
    else setCloudSettingsTenantScope("tenant-b");
    const generation = getCloudSettingsScopeVersion();
    tenant.resolve("tenant-a");
    expect(await read).toBe("fallback");
    expect(getCloudSettingsScopeVersion()).toBe(generation);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not adopt a tenant resolved after a cold read was logged out", async () => {
    const tenant = deferred<string | null>();
    mocks.getCurrentTenantId.mockReturnValueOnce(tenant.promise);
    const read = readCloudSetting("company-name", "fallback");
    clearCloudSettingsCache();
    tenant.resolve("tenant-a");
    expect(await read).toBe("fallback");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a confirmed fresh read whose tenant lookup crossed logout", async () => {
    const tenant = deferred<string | null>();
    mocks.getCurrentTenantId.mockReturnValueOnce(tenant.promise);
    const read = readCloudSettingFresh("monthly", {}, { requireConfirmed: true });
    const rejected = expect(read).rejects.toThrow("CLOUD_SETTING_SESSION_CHANGED_DURING_READ");
    clearCloudSettingsCache();
    tenant.resolve("tenant-a");
    await rejected;
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not issue a database read when a delayed session check crosses logout", async () => {
    const session = deferred<{ data: { session: { user: { id: string } } }; error: null }>();
    mocks.getSession.mockReturnValueOnce(session.promise);
    const read = readCloudSetting("company-name", "fallback");
    await vi.waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(1));
    clearCloudSettingsCache();
    session.resolve({ data: { session: { user: { id: "old-user" } } }, error: null });
    expect(await read).toBe("fallback");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rebinds persistent listeners and ignores callbacks from a previous login's channel", async () => {
    setCloudSettingsTenantScope("tenant-a");
    const listener = watch();
    const oldChange = changes[0];
    clearCloudSettingsCache();
    setCloudSettingsTenantScope("tenant-a");
    expect(mocks.channel).toHaveBeenCalledTimes(2);
    oldChange({ new: { tenant_id: "tenant-a", key: "company-name", value: "Old session", version: 99 } });
    expect(listCachedCloudKeys()).toEqual([]);
    update("Current session", 1);
    expect(await readCloudSetting("company-name", "fallback")).toBe("Current session");
    expect(listener).toHaveBeenCalledExactlyOnceWith("Current session");
  });

  it("uses a new topic on rapid resubscribe while the old channel is still being removed", async () => {
    setCloudSettingsTenantScope("tenant-a");
    const removal = deferred<string>();
    mocks.removeChannel.mockReturnValue(removal.promise);
    watch();
    const oldChange = changes[0];
    unsubscribes.pop()?.();
    const listener = watch();
    const topics = mocks.channel.mock.calls.map(([topic]) => topic);
    expect(topics).toHaveLength(2);
    expect(new Set(topics).size).toBe(2);
    oldChange({ new: { tenant_id: "tenant-a", key: "company-name", value: "Disposed channel", version: 99 } });
    expect(listCachedCloudKeys()).toEqual([]);
    update("Current channel", 1);
    removal.resolve("ok");
    expect(await readCloudSetting("company-name", "fallback")).toBe("Current channel");
    expect(listener).toHaveBeenCalledExactlyOnceWith("Current channel");
  });

  it("clears a previous tenant's cache when tenant resolution is no longer available", async () => {
    await readCloudSetting("company-name", "fallback");
    mocks.tenant = null;
    expect(await readCloudSetting("company-name", "fallback")).toBe("fallback");
    expect(listCachedCloudKeys()).toEqual([]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("also clears old cache when a confirmed fresh read has no tenant", async () => {
    await readCloudSetting("company-name", "fallback");
    mocks.tenant = null;
    await expect(readCloudSettingFresh("company-name", "fallback", { requireConfirmed: true }))
      .rejects.toThrow("CLOUD_SETTING_TENANT_REQUIRED");
    expect(listCachedCloudKeys()).toEqual([]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it.each(["/auth", "/auth/login", "/reset-password"])("does not fetch settings on %s", async (pathname) => {
    await readCloudSetting("company-name", "fallback");
    vi.stubGlobal("window", { location: { pathname } });
    mocks.getCurrentTenantId.mockClear();
    expect(await readCloudSetting("company-name", "fallback")).toBe("Cloud Company");
    expect(mocks.getCurrentTenantId).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    clearCloudSettingsCache();
    expect(await readCloudSetting("company-name", "signed-out-default")).toBe("signed-out-default");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
