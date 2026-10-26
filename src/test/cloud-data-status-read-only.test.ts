import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantId: "tenant-a" as string | null,
  selected: [] as Array<{ table: string; tenantId: string; columns: string; head: boolean }>,
  failingTable: "" as string,
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({
  getCurrentTenantId: async () => mocks.tenantId,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, options: { head: boolean }) => ({
        eq: async (column: string, tenantId: string) => {
          if (column !== "tenant_id") throw new Error("Unscoped count");
          mocks.selected.push({ table, tenantId, columns, head: options.head });
          return table === mocks.failingTable
            ? { count: null, error: { message: "RLS or schema unavailable" } }
            : { count: 3, error: null };
        },
      }),
    }),
  },
}));

beforeEach(() => {
  mocks.tenantId = "tenant-a";
  mocks.selected = [];
  mocks.failingTable = "";
});

describe("read-only cloud status", () => {
  it("scopes every count to the current tenant and performs only HEAD reads", async () => {
    const { CLOUD_TABLES, readCloudTableCounts } = await import("@/lib/cloudDataStatus");
    const rows = await readCloudTableCounts();
    expect(rows).toHaveLength(CLOUD_TABLES.length);
    expect(rows.every((row) => row.count === 3 && row.error === null)).toBe(true);
    expect(mocks.selected).toHaveLength(CLOUD_TABLES.length);
    expect(mocks.selected.every((read) => read.tenantId === "tenant-a" && read.columns === "id" && read.head)).toBe(true);
  });

  it("keeps a failed count unknown instead of reporting zero", async () => {
    mocks.failingTable = "expenses";
    const { readCloudTableCounts } = await import("@/lib/cloudDataStatus");
    const rows = await readCloudTableCounts();
    expect(rows.find((row) => row.table === "expenses")).toMatchObject({ count: null, error: "RLS or schema unavailable" });
    expect(rows.find((row) => row.table === "customers")).toMatchObject({ count: 3, error: null });
  });

  it("rejects an unknown tenant before querying any table", async () => {
    mocks.tenantId = null;
    const { readCloudTableCounts } = await import("@/lib/cloudDataStatus");
    await expect(readCloudTableCounts()).rejects.toThrow("Current workshop");
    expect(mocks.selected).toEqual([]);
  });
});
