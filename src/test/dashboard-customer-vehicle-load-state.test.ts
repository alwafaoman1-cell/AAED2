import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("operational page load states", () => {
  it("does not turn a dashboard network failure into a full-history fallback or false zero dashboard", () => {
    const source = read("src/pages/Dashboard.tsx");
    expect(source).toContain('const missingDashboardRpc = dashboardQuery.isError && !dashboardQuery.data');
    expect(source).toContain('if (!missingDashboardRpc) return;');
    expect(source).toContain('!dashboardDataReady ? (');
    expect(source).toContain('No empty result has been assumed.');
  });

  it("keeps cached list placeholders within the same tenant only", () => {
    const customers = read("src/pages/Customers.tsx");
    const vehicles = read("src/pages/Vehicles.tsx");
    const dashboard = read("src/pages/Dashboard.tsx");
    expect(customers).toContain('previousQuery?.queryKey[2] === profile.tenant_id');
    expect(vehicles).toContain('previousQuery?.queryKey[2] as { tenantId?: string }');
    expect(dashboard).toContain('previousQuery?.queryKey[2] === profile.tenant_id');
    expect(vehicles).toContain('enabled: Boolean(profile?.tenant_id)');
  });
});
