import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { sanitizeClaimWritePayload } from "@/lib/supabasePayload";
import { ensureVehicleForVisit } from "@/lib/vehicleIdentity";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export type PreparedClaimInput = Record<string, any> & {
  tenant_id: string;
  customer_id: string;
  vehicle_id?: string | null;
  claim_number: string;
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | string | null;
  vehicle_color?: string | null;
};

/** A cleared draft is still a JSON document (tenant_settings.value is NOT NULL).
 * savedAt=0 is the existing hydration contract for "nothing to resume". */
export function createEmptyClaimDraft<T extends object>(data: T): { savedAt: 0; data: T } {
  return { savedAt: 0, data };
}

export async function prepareClaimPayload(input: PreparedClaimInput) {
  let claim: PreparedClaimInput = { ...input };

  if (!claim.tenant_id || !isUuid(claim.tenant_id)) {
    throw new Error("Tenant was not loaded. Please refresh and try again.");
  }
  if (!claim.customer_id || !isUuid(claim.customer_id) || /^(CUST|TEMP)-/i.test(String(claim.customer_id))) {
    throw new Error("لا يمكن حفظ المطالبة بدون عميل صالح في Supabase");
  }
  if (await getCurrentTenantId() !== claim.tenant_id) throw new Error("vehicle_tenant_changed");

  const loadCustomer = async (customerId: string) => {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", claim.tenant_id)
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data as any;
  };

  const existingCustomer = await loadCustomer(claim.customer_id);
  if (!(existingCustomer as any)?.id) {
    throw new Error("لا يمكن حفظ المطالبة: العميل غير موجود في Supabase");
  }

  const claimNumber = String(claim.claim_number || "").trim();
  const { data: existing, error: existingError } = await supabase
    .from("insurance_claims" as any)
    .select("id,claim_number,status,deleted_at")
    .eq("tenant_id", claim.tenant_id)
    .ilike("claim_number", claimNumber)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if ((existing as any)?.id) {
    const err = new Error("claim_number_exists");
    (err as any).existingClaimId = (existing as any).id;
    (err as any).existingClaimInactive = !!(
      (existing as any).deleted_at || (existing as any).status === "cancelled"
    );
    throw err;
  }

  // This service is used only by useCreateClaim, never by historical claim edits.
  // Customer selection belongs to this operation, not to vehicles.customer_id.
  const vehicle = await ensureVehicleForVisit({
    customerId: claim.customer_id,
    vehicleId: claim.vehicle_id,
    plate: claim.vehicle_plate,
    plateNumber: claim.vehicle_plate_number,
    plateLetters: claim.vehicle_plate_letters,
    plateCountry: claim.vehicle_plate_country,
    vin: claim.vehicle_vin,
    make: claim.vehicle_make,
    model: claim.vehicle_model,
    year: claim.vehicle_year,
    color: claim.vehicle_color,
    confirmedNewVisit: true,
  });
  claim = { ...claim, vehicle_id: vehicle.vehicleId };
  return sanitizeClaimWritePayload({ ...claim, claim_number: claimNumber });
}

/** Shared create path for every claim form, including real-browser verification.
 * Never use the registry owner's customer ID as the claim's selected party. */
export async function createClaimInCloud(input: PreparedClaimInput) {
  const payload=await prepareClaimPayload(input);
  const {data,error}=await supabase.from("insurance_claims" as any).insert(payload).select("id").single();
  if(error) throw error;
  if(!(data as any)?.id) throw new Error("Claim was saved but could not be read back for verification");
  const {data:verified,error:verifyError}=await supabase.from("insurance_claims" as any)
    .select("*").eq("tenant_id",input.tenant_id).eq("id",(data as any).id).maybeSingle();
  if(verifyError) throw verifyError;
  const saved=verified as any;
  if(!saved?.id || saved.customer_id!==payload.customer_id || saved.vehicle_id!==payload.vehicle_id)
    throw new Error("Claim was saved but could not be read back for verification");
  return saved;
}
