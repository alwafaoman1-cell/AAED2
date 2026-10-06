import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));

import {
  clearCloudSettingsCache,
  getCloudSettingsScopeVersion,
  mutateCloudArraySetting,
  setCloudSettingsTenantScope,
} from "@/lib/cloudSettings";

type Item = { id: string; label: string };

beforeEach(() => {
  clearCloudSettingsCache();
  setCloudSettingsTenantScope("tenant-a");
  vi.clearAllMocks();
  mocks.getCurrentTenantId.mockResolvedValue("tenant-a");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
});

describe("legacy array store compare-and-swap", () => {
  it("preserves both users' additions when they read the same version concurrently", async () => {
    let row = { value: [] as Item[], version: 1 };
    let reads = 0;
    let conflicts = 0;
    const firstReadResolvers: Array<(value: any) => void> = [];
    mocks.from.mockImplementation(() => ({
      select: () => {
        const query: any = {
          eq: () => query,
          maybeSingle: () => {
            const snapshot = { data: { value: [...row.value], version: row.version }, error: null };
            reads += 1;
            if (reads > 2) return Promise.resolve(snapshot);
            return new Promise((resolve) => {
              firstReadResolvers.push(resolve);
              if (firstReadResolvers.length === 2) {
                firstReadResolvers.forEach((done) => done(snapshot));
              }
            });
          },
        };
        return query;
      },
      update: (payload: { value: Item[] }) => {
        let expectedVersion = 0;
        const query: any = {
          eq: (column: string, value: number) => {
            if (column === "version") expectedVersion = value;
            return query;
          },
          select: () => query,
          maybeSingle: async () => {
            if (expectedVersion !== row.version) {
              conflicts += 1;
              return { data: null, error: null };
            }
            row = { value: payload.value, version: row.version + 1 };
            return { data: { value: row.value }, error: null };
          },
        };
        return query;
      },
    }));

    const version = getCloudSettingsScopeVersion();
    await Promise.all([
      mutateCloudArraySetting<Item>("deposits", { type: "add", item: { id: "a", label: "A" } }, version),
      mutateCloudArraySetting<Item>("deposits", { type: "add", item: { id: "b", label: "B" } }, version),
    ]);
    expect(conflicts).toBe(1);
    expect(row.value.map((item) => item.id).sort()).toEqual(["a", "b"]);
  });
});
