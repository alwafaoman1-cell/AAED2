import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("work order list fallback safety", () => {
  const page = readFileSync("src/pages/WorkOrders.tsx", "utf8");
  const store = readFileSync("src/lib/workOrdersStore.ts", "utf8");

  it("never starts the full compatibility sync for a normal network error", () => {
    expect(page).toContain('const missingListRpc = workOrdersPageQuery.isError && !workOrdersPageQuery.data');
    expect(page).toContain('if (!missingListRpc || !fallbackListTenantId) return;');
    expect(page).not.toContain('if (!workOrdersPageQuery.isError) return;');
  });

  it("does not show false counts, rows or exports before a verified cloud read", () => {
    expect(page).toContain('const listVerified = serverListReady || fallbackReady');
    expect(page).toContain('listVerified ? totalOrders : "—"');
    expect(page).toContain('fallbackReady ? filtered.slice((page - 1) * pageSize, page * pageSize) : []');
    expect(page).toContain('return fallbackReady ? filtered : []');
  });

  it("keeps compatibility reads explicitly tenant-scoped and bounded", () => {
    expect(store).toMatch(/\.from\("job_orders"\)\s*\.select\("\*"\)\s*\.eq\("tenant_id", tenantId\)/);
    expect(store).toContain('.limit(customerIds.length)');
    expect(store).toContain('.limit(vehicleIds.length)');
    expect(store).toContain('.limit(claimIds.length)');
  });
});
