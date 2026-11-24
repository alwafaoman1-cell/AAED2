import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getCloudSettingsScopeVersion } from "@/lib/cloudSettings";

export const WORKFLOW_REQUIREMENT_QUERY_KEY = "workflow_requirement_policy";

export interface WorkflowRequirementPolicy {
  tenant_id: string;
  requirements_enabled: boolean;
  revision: number;
  reason: string;
  updated_by: string | null;
  updated_by_name?: string | null;
  updated_at: string | null;
}

export interface WorkflowRequirementAudit {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  actor_name: string;
  policy_revision: number;
  reason: string;
  requirements_enabled: boolean;
  details: Record<string, unknown>;
  created_at: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORKFLOW_POLICY_INVALID");
  return value as Record<string, unknown>;
}

function parsePolicy(value: unknown, tenantId: string): WorkflowRequirementPolicy {
  const row = record(value);
  if (row.tenant_id !== tenantId) throw new Error("WORKFLOW_POLICY_SCOPE_CHANGED");
  if (typeof row.requirements_enabled !== "boolean" || !Number.isSafeInteger(row.revision)
    || Number(row.revision) < 0 || typeof row.reason !== "string"
    || (row.updated_by !== null && typeof row.updated_by !== "string")
    || (row.updated_at !== null && typeof row.updated_at !== "string")) {
    throw new Error("WORKFLOW_POLICY_INVALID");
  }
  if (!row.requirements_enabled && (Number(row.revision)<1 || !row.reason.trim() || !row.updated_by || !row.updated_at)) {
    throw new Error("WORKFLOW_POLICY_INVALID");
  }
  return row as unknown as WorkflowRequirementPolicy;
}

async function assertScope(tenantId: string, version: number) {
  if (!tenantId || await getCurrentTenantId() !== tenantId || getCloudSettingsScopeVersion() !== version) {
    throw new Error("WORKFLOW_POLICY_SCOPE_CHANGED");
  }
}

/** No cached disabled state or browser storage can authorize a relaxed workflow. */
export async function readWorkflowRequirementPolicy(tenantId: string): Promise<WorkflowRequirementPolicy> {
  const version = getCloudSettingsScopeVersion();
  await assertScope(tenantId, version);
  const { data, error } = await supabase.rpc("get_workflow_requirement_policy" as never);
  if (error) throw error;
  await assertScope(tenantId, version);
  return parsePolicy(data, tenantId);
}

/** Admin-only on the server; success requires a fresh, matching canonical read. */
export async function setWorkflowRequirementPolicy(
  tenantId: string, requirementsEnabled: boolean, reason: string, expectedRevision: number,
): Promise<WorkflowRequirementPolicy> {
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (typeof requirementsEnabled !== "boolean" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("WORKFLOW_POLICY_INVALID");
  }
  if (!cleanReason || cleanReason.length > 1000) throw new Error("WORKFLOW_POLICY_REASON_REQUIRED");
  const version = getCloudSettingsScopeVersion();
  await assertScope(tenantId, version);
  const { data, error } = await supabase.rpc("set_workflow_requirement_policy" as never, {
    p_requirements_enabled: requirementsEnabled,
    p_reason: cleanReason,
    p_expected_revision: expectedRevision,
    p_tenant_id: tenantId,
  } as never);
  if (error) throw error;
  await assertScope(tenantId, version);
  const saved = parsePolicy(data, tenantId);
  if (saved.requirements_enabled !== requirementsEnabled || saved.revision < expectedRevision) {
    throw new Error("WORKFLOW_POLICY_SAVE_NOT_CONFIRMED");
  }
  const confirmed = await readWorkflowRequirementPolicy(tenantId);
  await assertScope(tenantId, version);
  if (confirmed.revision !== saved.revision || confirmed.requirements_enabled !== saved.requirements_enabled
    || confirmed.reason !== saved.reason || confirmed.updated_by !== saved.updated_by
    || confirmed.updated_at !== saved.updated_at) throw new Error("WORKFLOW_POLICY_CHANGED");
  return confirmed;
}

export async function listWorkflowRequirementAudit(tenantId: string): Promise<WorkflowRequirementAudit[]> {
  const version = getCloudSettingsScopeVersion();
  await assertScope(tenantId, version);
  const { data, error } = await supabase.from("workflow_requirement_audit" as never)
    .select("id,tenant_id,entity_type,entity_id,action,actor_id,actor_name,policy_revision,reason,requirements_enabled,details,created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  await assertScope(tenantId, version);
  if (!Array.isArray(data)) throw new Error("WORKFLOW_POLICY_INVALID");
  return (data as unknown[]).map(value => {
    const row = record(value);
    if (row.tenant_id !== tenantId) throw new Error("WORKFLOW_POLICY_SCOPE_CHANGED");
    if (typeof row.id !== "string" || typeof row.entity_type !== "string" || typeof row.entity_id !== "string"
      || typeof row.action !== "string" || typeof row.actor_id !== "string" || typeof row.actor_name !== "string"
      || !Number.isSafeInteger(row.policy_revision) || typeof row.reason !== "string"
      || typeof row.requirements_enabled !== "boolean" || typeof row.created_at !== "string") {
      throw new Error("WORKFLOW_POLICY_INVALID");
    }
    record(row.details);
    return row as unknown as WorkflowRequirementAudit;
  });
}
