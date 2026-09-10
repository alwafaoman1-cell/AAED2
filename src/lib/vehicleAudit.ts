import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export async function logVehicleAudit(
  vehicleId: string,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!vehicleId) throw new Error("vehicle_audit_identity_required");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("vehicle_audit_tenant_required");
  const { data } = await supabase.auth.getUser();
  const { error } = await (supabase.from("operational_audit_log" as any) as any).insert({
    tenant_id: tenantId,
    user_id: data.user?.id || null,
    action,
    entity_type: "vehicle",
    entity_id: vehicleId,
    related_entities: details,
    after_snapshot: details,
  });
  if (error) throw error;
}
