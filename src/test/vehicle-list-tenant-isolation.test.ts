import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/queryKeys";

describe("vehicle list tenant isolation", () => {
  it("never reuses the same vehicle list cache key across tenants", () => {
    const filters = { scope: "active", search: "", page: 1, pageSize: 25 };
    expect(queryKeys.vehicles.list({ tenantId: "tenant-a", ...filters }))
      .not.toEqual(queryKeys.vehicles.list({ tenantId: "tenant-b", ...filters }));
  });

  it("does not issue an archive read before AuthContext resolves the tenant", () => {
    const page = readFileSync("src/pages/Vehicles.tsx", "utf8");
    expect(page).toContain("enabled: Boolean(profile?.tenant_id)");
    expect(page).toContain("tenantId: profile!.tenant_id");
  });
});
