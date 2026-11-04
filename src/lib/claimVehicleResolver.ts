import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { ensureVehicleForCustomer, ensureVehicleForVisit, findExistingVehicle } from "@/lib/vehicleIdentity";
import { isUuid } from "@/lib/uuid";

export interface ResolveClaimVehicleInput {
  claimId: string;
  customerId?: string | null;
  vehicleId?: string | null;
  plate?: string | null;
  plateNumber?: string | null;
  plateLetters?: string | null;
  plateCountry?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | number | null;
  color?: string | null;
  vin?: string | null;
  confirmedNewVisit?: boolean;
}

async function linkClaimVehicle(tenantId: string, claimId: string, vehicleId: string) {
  if (!isUuid(claimId) || !isUuid(vehicleId)) return;
  if (await getCurrentTenantId() !== tenantId) throw new Error("vehicle_tenant_changed");
  const { data, error } = await supabase
    .from("insurance_claims" as any)
    .update({ vehicle_id: vehicleId } as any)
    .eq("tenant_id", tenantId)
    .eq("id", claimId)
    .is("deleted_at", null)
    .is("vehicle_id", null)
    .select("id,vehicle_id").maybeSingle();
  if (error) throw error;
  if ((data as any)?.vehicle_id !== vehicleId) throw new Error("claim_vehicle_link_not_confirmed");
}

export async function resolveClaimVehicleForWorkOrder(input: ResolveClaimVehicleInput): Promise<string> {
  if (!isUuid(input.customerId || "")) {
    throw new Error("لا يمكن إنشاء أمر العمل قبل ربط العميل بالمطالبة");
  }

  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");

  if (!isUuid(input.claimId)) throw new Error("selected_claim_unavailable");
  const { data: claim, error } = await supabase.from("insurance_claims" as any)
    .select("id,vehicle_id,customer_id").eq("tenant_id", tenantId).eq("id", input.claimId)
    .is("deleted_at", null).maybeSingle();
  if (error) throw error;
  // The insurance financial party may differ from the operational visitor.
  // Authorize the claim by tenant, never by equality of those customer IDs.
  if (!claim) throw new Error("selected_claim_unavailable");
  if ((claim as any).vehicle_id && input.vehicleId && (claim as any).vehicle_id !== input.vehicleId) {
    throw new Error("selected_vehicle_unavailable");
  }
  const identity = { ...input, vehicleId: (claim as any).vehicle_id || input.vehicleId, customerId: input.customerId! };
  if (input.confirmedNewVisit === true) {
    const resolved = await ensureVehicleForVisit({ ...identity, confirmedNewVisit: true });
    if (!(claim as any).vehicle_id) await linkClaimVehicle(tenantId, input.claimId, resolved.vehicleId);
    return resolved.vehicleId;
  }

  const existing = await findExistingVehicle(identity);

  if (existing?.id) {
    if (existing.deleted) throw new Error("deleted_vehicle_requires_restore");
    if (existing.archived) throw new Error("archived_vehicle_requires_confirmation");
    if (existing.source === "vin") throw new Error("vin_candidate_requires_user_confirmation");
    if (!(claim as any).vehicle_id) await linkClaimVehicle(tenantId, input.claimId, existing.id);
    return existing.id;
  }

  const created = await ensureVehicleForCustomer({
    ...identity,
    allowDifferentCustomer: true,
  });

  await linkClaimVehicle(tenantId, input.claimId, created.vehicleId);
  return created.vehicleId;
}
