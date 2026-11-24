import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ tenant: "tenant-a", version: 1, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: async () => mock.tenant }));
vi.mock("@/lib/cloudSettings", () => ({ getCloudSettingsScopeVersion: () => mock.version }));
import { readWorkflowRequirementPolicy, setWorkflowRequirementPolicy } from "@/lib/workflowRequirements";

const strict = { tenant_id: "tenant-a", requirements_enabled: true, revision: 0, reason: "", updated_by: null, updated_at: null };
const relaxed = { ...strict, requirements_enabled: false, revision: 1, reason: "Controlled workshop trial", updated_by: "admin-a", updated_at: "2026-11-23T12:00:00Z" };
beforeEach(() => { vi.clearAllMocks(); mock.tenant = "tenant-a"; mock.version = 1; });

describe("canonical workflow requirement authority", () => {
  it("reads the server default without writing or creating a local override", async () => {
    mock.rpc.mockResolvedValue({ data: strict, error: null });
    expect(await readWorkflowRequirementPolicy("tenant-a")).toEqual(strict);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("get_workflow_requirement_policy");
  });
  it.each([null, { ...relaxed, requirements_enabled: "false" }, { ...relaxed, revision: -1 }, { ...relaxed, reason: null }, { ...strict, requirements_enabled: false }])("refuses an unconfirmed or malformed relaxed policy", async data => {
    mock.rpc.mockResolvedValue({ data, error: null });
    await expect(readWorkflowRequirementPolicy("tenant-a")).rejects.toThrow("WORKFLOW_POLICY_INVALID");
  });
  it("refuses a policy returned for another workshop", async () => {
    mock.rpc.mockResolvedValue({ data: { ...relaxed, tenant_id: "tenant-b" }, error: null });
    await expect(readWorkflowRequirementPolicy("tenant-a")).rejects.toThrow("WORKFLOW_POLICY_SCOPE_CHANGED");
  });
  it("checks scope before and after the request, including a same-tenant session reset", async () => {
    mock.tenant = "tenant-b";
    await expect(readWorkflowRequirementPolicy("tenant-a")).rejects.toThrow("WORKFLOW_POLICY_SCOPE_CHANGED");
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.tenant = "tenant-a";
    mock.rpc.mockImplementation(async () => { mock.version++; return { data: relaxed, error: null }; });
    await expect(readWorkflowRequirementPolicy("tenant-a")).rejects.toThrow("WORKFLOW_POLICY_SCOPE_CHANGED");
  });
  it("does not hide a failed read behind a permissive default", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(readWorkflowRequirementPolicy("tenant-a")).rejects.toThrow("offline");
  });
  it("sends a reason and expected revision, then verifies a fresh canonical read", async () => {
    mock.rpc.mockResolvedValue({ data: relaxed, error: null });
    await expect(setWorkflowRequirementPolicy("tenant-a", false, "  Controlled workshop trial  ", 0)).resolves.toEqual(relaxed);
    expect(mock.rpc).toHaveBeenNthCalledWith(1, "set_workflow_requirement_policy", { p_requirements_enabled: false, p_reason: "Controlled workshop trial", p_expected_revision: 0, p_tenant_id: "tenant-a" });
    expect(mock.rpc).toHaveBeenNthCalledWith(2, "get_workflow_requirement_policy");
  });
  it("rejects blank reasons before any write", async () => {
    await expect(setWorkflowRequirementPolicy("tenant-a", false, "  ", 0)).rejects.toThrow("WORKFLOW_POLICY_REASON_REQUIRED");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("never reports a save as successful if read-back fails", async () => {
    mock.rpc.mockResolvedValueOnce({ data: relaxed, error: null }).mockResolvedValueOnce({ data: null, error: new Error("read-back failed") });
    await expect(setWorkflowRequirementPolicy("tenant-a", false, relaxed.reason, 0)).rejects.toThrow("read-back failed");
  });
  it("rejects a later administrator's different revision instead of claiming the requested state", async () => {
    mock.rpc.mockResolvedValueOnce({ data: relaxed, error: null }).mockResolvedValueOnce({ data: { ...strict, revision: 2, reason: "Restore requirements" }, error: null });
    await expect(setWorkflowRequirementPolicy("tenant-a", false, relaxed.reason, 0)).rejects.toThrow("WORKFLOW_POLICY_CHANGED");
  });
  it("does not read back or authorize a previous tenant after saving", async () => {
    mock.rpc.mockImplementation(async () => { mock.tenant = "tenant-b"; return { data: relaxed, error: null }; });
    await expect(setWorkflowRequirementPolicy("tenant-a", false, relaxed.reason, 0)).rejects.toThrow("WORKFLOW_POLICY_SCOPE_CHANGED");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
