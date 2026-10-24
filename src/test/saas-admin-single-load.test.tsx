// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SaasAdminConsole from "@/pages/admin/SaasAdminConsole";

const mocks = vi.hoisted(() => ({
  listTenants: vi.fn(),
  listTenantFeatures: vi.fn(),
  listDomains: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    profile: { user_id: "user-1", tenant_id: "tenant-1", role: "admin", is_platform_admin: false },
    hasRole: () => true,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock("@/lib/saasAdmin", () => ({
  FEATURE_DEFINITIONS: [],
  listTenants: mocks.listTenants,
  listTenantFeatures: mocks.listTenantFeatures,
  listDomains: mocks.listDomains,
}));
vi.mock("@/pages/admin/TenantFiles", () => ({ default: () => null }));

beforeEach(() => {
  mocks.listTenants.mockReset().mockResolvedValue([{ id: "tenant-1", name: "Workshop" }]);
  mocks.listTenantFeatures.mockReset().mockResolvedValue([]);
  mocks.listDomains.mockReset().mockResolvedValue([]);
  mocks.invoke.mockReset().mockResolvedValue({ data: { users: [] }, error: null });
});

describe("SaaS admin initial load", () => {
  it("does not request users and tenant features twice on mount", async () => {
    render(<SaasAdminConsole />);
    await waitFor(() => expect(mocks.listTenantFeatures).toHaveBeenCalledTimes(1));
    expect(mocks.listTenantFeatures).toHaveBeenCalledWith("tenant-1");
    expect(mocks.listDomains).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
