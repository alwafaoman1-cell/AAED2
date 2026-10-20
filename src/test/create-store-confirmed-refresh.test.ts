import { beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({
  scopeVersion: 1,
  onScopeChange: null as null | (() => void),
  resolveInitial: null as null | ((rows: Array<{ id: string }>) => void),
  resolveFresh: null as null | ((rows: Array<{ id: string }>) => void),
  mutate: vi.fn(),
}));

vi.mock("@/lib/cloudSettings", () => ({
  getCloudSettingsScopeVersion: () => cloud.scopeVersion,
  subscribeCloudSettingsScopeChange: (listener: () => void) => {
    cloud.onScopeChange = listener;
    return () => {};
  },
  subscribeCloudSetting: () => () => {},
  readCloudSetting: () => new Promise((resolve) => { cloud.resolveInitial = resolve; }),
  readCloudSettingFresh: () => new Promise((resolve) => { cloud.resolveFresh = resolve; }),
  mutateCloudArraySetting: (...args: unknown[]) => cloud.mutate(...args),
  writeCloudSetting: vi.fn(),
}));

describe("confirmed legacy-store refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    cloud.scopeVersion = 1;
    cloud.onScopeChange = null;
    cloud.resolveInitial = null;
    cloud.resolveFresh = null;
    cloud.mutate.mockClear();
  });

  it("replaces an empty bootstrap view with the confirmed cloud journal before reconciliation", async () => {
    const { createStore } = await import("@/lib/createStore");
    const store = createStore({ key: "test_journal", seed: [] as Array<{ id: string }> });
    expect(store.getAll()).toEqual([]);
    const refresh = store.refreshConfirmed();
    cloud.resolveInitial?.([]);
    await vi.waitFor(() => expect(cloud.resolveFresh).not.toBeNull());
    cloud.resolveFresh?.([{ id: "JE-00400" }]);
    await refresh;
    expect(store.getAll()).toEqual([{ id: "JE-00400" }]);
    expect(cloud.mutate).not.toHaveBeenCalled();
  });

  it("rejects an old journal read after the tenant scope changes", async () => {
    const { createStore } = await import("@/lib/createStore");
    const store = createStore({ key: "test_journal", seed: [] as Array<{ id: string }> });
    const refresh = store.refreshConfirmed();
    cloud.resolveInitial?.([]);
    await vi.waitFor(() => expect(cloud.resolveFresh).not.toBeNull());
    cloud.scopeVersion += 1;
    cloud.onScopeChange?.();
    cloud.resolveFresh?.([{ id: "JE-00400" }]);
    await expect(refresh).rejects.toThrow("STORE_CHANGED_DURING_REFRESH");
    expect(store.getAll()).toEqual([]);
    expect(cloud.mutate).not.toHaveBeenCalled();
  });
});
