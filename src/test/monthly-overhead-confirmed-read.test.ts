import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  scope: 1, tenant: "tenant-a" as string | null, fresh: vi.fn(), rpc: vi.fn(),
  source: { expenseRows: [], summary: {}, groups: [], payrollRows: [], basis: "actual", generatedAt: "2026-11-04" },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: async () => db.tenant }));
vi.mock("@/lib/cloudSettings", () => ({
  getCloudSettingsScopeVersion: () => db.scope,
  setCloudSettingsTenantScope: vi.fn(), readCloudSettingFresh: db.fresh,
}));
import { fetchMonthlyWorkshopOverheads } from "@/lib/accounting/monthlyWorkshopReport";

beforeEach(() => {
  db.scope = 1; db.tenant = "tenant-a";
  db.fresh.mockReset().mockImplementation(async (_key, fallback) => fallback);
  db.rpc.mockReset().mockImplementation(() => ({ abortSignal: async () => ({ data: db.source, error: null }) }));
});
describe("monthly overhead confirmed sources", () => {
  it("reads HR and fixed settings strictly, never cached fallback snapshots, without writing accruals", async () => {
    const result = await fetchMonthlyWorkshopOverheads("2026-07-01", "2026-07-31");
    expect(result.summary.total).toBe(0);
    expect(db.fresh).toHaveBeenCalledWith("alwafa_hr_v1", expect.any(Object), { requireConfirmed: true });
    expect(db.fresh).toHaveBeenCalledWith("alwafa_monthly_settings_v1", expect.any(Object), { requireConfirmed: true });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("monthly_workshop_overheads_rpc", { p_from: "2026-07-01", p_to: "2026-07-31" });
  });
  it("does not turn a failed HR/fixed source read into a zero expense and overstated profit", async () => {
    db.fresh.mockRejectedValue(new Error("HR read denied"));
    await expect(fetchMonthlyWorkshopOverheads("2026-07-01", "2026-07-31")).rejects.toThrow("HR read denied");
  });
  it("refuses to combine different tenant/session snapshots", async () => {
    db.fresh.mockImplementation(async (_key, fallback) => { db.scope = 2; return fallback; });
    await expect(fetchMonthlyWorkshopOverheads("2026-07-01", "2026-07-31")).rejects.toThrow("MONTHLY_OVERHEAD_SESSION_CHANGED");
  });
  it("requires a tenant before any financial reads", async () => {
    db.tenant = null;
    await expect(fetchMonthlyWorkshopOverheads("2026-07-01", "2026-07-31")).rejects.toThrow("MONTHLY_OVERHEAD_TENANT_REQUIRED");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.fresh).not.toHaveBeenCalled();
  });
});

