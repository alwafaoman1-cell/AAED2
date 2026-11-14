// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), tenant: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
import { buildCustomerPortalUrl, buildWorkOrderSignatureUrl, ensureCustomerPortalToken, readCustomerPortalToken } from "@/lib/customerPortalTokens";
beforeEach(() => { mocks.rpc.mockReset(); mocks.tenant.mockResolvedValue("tenant-a"); });
describe("customer portal authority", () => {
  it("a read resolves the canonical visit without creating a link", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "vehicle_customer_portal_entry_for_order" ? { entry_id: "review-visit" } : null, error: null }));
    expect(await readCustomerPortalToken("order", "tenant-a")).toBeNull();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["vehicle_customer_portal_entry_for_order", "vehicle_customer_portal_context"]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("vehicle_customer_portal_context", { p_entry_id: "review-visit" });
  });
  it("never invents an entry or token when the server cannot resolve one", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(ensureCustomerPortalToken("order")).rejects.toThrow("CUSTOMER_PORTAL_VISIT_REQUIRED");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("requires the canonical portal token and uses one URL for tracking and signing", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "vehicle_customer_portal_entry_for_order" ? { entry_id: "entry" } : { token: "new-token", enabled: true, expires_at: null }, error: null }));
    expect(await ensureCustomerPortalToken("order")).toMatchObject({ token: "new-token" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("ensure_vehicle_customer_portal", { p_entry_id: "entry" });
    expect(buildCustomerPortalUrl("new-token")).toContain("/customer/vehicle/new-token");
    expect(buildWorkOrderSignatureUrl("new-token")).toBe(buildCustomerPortalUrl("new-token"));
  });
  it("rejects a mismatched tenant before looking up an order", async () => {
    await expect(readCustomerPortalToken("order", "tenant-b")).rejects.toThrow("TENANT_NOT_FOUND");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
