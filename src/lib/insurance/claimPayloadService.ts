import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { sanitizeClaimWritePayload } from "@/lib/supabasePayload";
import { isVehicleAlreadyExistsError, normalizeVehiclePlate } from "@/lib/vehicleIdentity";

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

const isMissingColumnError = (error: unknown) =>
  /deleted_at|archived_at|column/i.test(String((error as any)?.message || ""));

export async function prepareClaimPayload(input: PreparedClaimInput) {
  let claim: PreparedClaimInput = { ...input };

  if (!claim.tenant_id || !isUuid(claim.tenant_id)) {
    throw new Error("Tenant was not loaded. Please refresh and try again.");
  }
  if (!claim.customer_id || !isUuid(claim.customer_id) || /^(CUST|TEMP)-/i.test(String(claim.customer_id))) {
    throw new Error("لا يمكن حفظ المطالبة بدون عميل صالح في Supabase");
  }

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

  const loadVehicle = async (vehicleId: string | null | undefined) => {
    if (!vehicleId || !isUuid(vehicleId) || /^(VEH|TEMP)-/i.test(String(vehicleId))) return null;
    let query = await supabase
      .from("vehicles")
      .select("id,customer_id")
      .eq("tenant_id", claim.tenant_id)
      .eq("id", vehicleId)
      .is("deleted_at", null)
      .maybeSingle();
    if (query.error && isMissingColumnError(query.error)) {
      query = await supabase
        .from("vehicles")
        .select("id,customer_id")
        .eq("tenant_id", claim.tenant_id)
        .eq("id", vehicleId)
        .maybeSingle();
    }
    if (query.error) throw query.error;
    return query.data as any;
  };

  const findVehicleByPlate = async () => {
    const plate = normalizeVehiclePlate({
      plate: claim.vehicle_plate || "",
      make: claim.vehicle_make || "",
      model: claim.vehicle_model || "",
      year: claim.vehicle_year || null,
      color: claim.vehicle_color || "",
    });
    if (!plate.digits) return null;
    let query = supabase
      .from("vehicles")
      .select("id,customer_id")
      .eq("tenant_id", claim.tenant_id)
      .eq("plate_number", plate.digits)
      .eq("plate_country", plate.country)
      .limit(1);
    if (plate.letters) query = query.eq("plate_letters", plate.letters);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data as any;
  };

  const resolveVehicleForClaim = async () => {
    const currentVehicle = await loadVehicle(claim.vehicle_id);
    if (currentVehicle?.id) return currentVehicle;

    const canResolveFromInlineVehicle = !!(
      String(claim.vehicle_plate || "").trim() ||
      String(claim.vehicle_make || "").trim() ||
      String(claim.vehicle_model || "").trim()
    );
    if (!canResolveFromInlineVehicle) {
      throw new Error("لا يمكن حفظ المطالبة بدون مركبة صالحة في Supabase");
    }

    const plate = normalizeVehiclePlate({
      plate: claim.vehicle_plate || "",
      make: claim.vehicle_make || "",
      model: claim.vehicle_model || "",
      year: claim.vehicle_year || null,
      color: claim.vehicle_color || "",
    });
    const make = String(claim.vehicle_make || "").trim();
    const model = String(claim.vehicle_model || "").trim();
    if (!plate.digits) throw new Error("رقم اللوحة مطلوب قبل حفظ المطالبة");
    if (!make) throw new Error("أدخل ماركة المركبة قبل حفظ المطالبة");

    const existingByPlate = await findVehicleByPlate();
    if (existingByPlate?.id) {
      claim = { ...claim, vehicle_id: existingByPlate.id };
      return existingByPlate;
    }

    const insertPayload = {
      tenant_id: claim.tenant_id,
      customer_id: claim.customer_id,
      plate_number: plate.digits,
      plate_letters: plate.letters || null,
      plate_country: plate.country,
      brand: make,
      model: model || null,
      year: claim.vehicle_year ? Number(claim.vehicle_year) || null : null,
      color: claim.vehicle_color || null,
    };

    const { data: insertedVehicle, error: insertVehicleError } = await supabase
      .from("vehicles")
      .insert(insertPayload as any)
      .select("id,customer_id")
      .single();

    if (insertVehicleError) {
      if (isVehicleAlreadyExistsError(insertVehicleError)) {
        const duplicateVehicle = await findVehicleByPlate();
        if (duplicateVehicle?.id) {
          claim = { ...claim, vehicle_id: duplicateVehicle.id };
          return duplicateVehicle;
        }
      }
      throw insertVehicleError;
    }

    if (!(insertedVehicle as any)?.id) {
      throw new Error("تعذر إنشاء أو ربط المركبة في Supabase قبل حفظ المطالبة");
    }
    claim = { ...claim, vehicle_id: (insertedVehicle as any).id };
    return insertedVehicle as any;
  };

  let existingCustomer = await loadCustomer(claim.customer_id);
  if (!(existingCustomer as any)?.id) {
    throw new Error("لا يمكن حفظ المطالبة: العميل غير موجود في Supabase");
  }

  const existingVehicle = await resolveVehicleForClaim();
  if ((existingVehicle as any).customer_id && (existingVehicle as any).customer_id !== claim.customer_id) {
    claim = { ...claim, customer_id: (existingVehicle as any).customer_id };
    existingCustomer = await loadCustomer(claim.customer_id);
  }
  if (!(existingCustomer as any)?.id) {
    throw new Error("لا يمكن حفظ المطالبة: العميل غير موجود في Supabase");
  }
  if (!(existingVehicle as any)?.id) {
    throw new Error("لا يمكن حفظ المطالبة: المركبة غير موجودة في Supabase");
  }

  const claimNumber = String(claim.claim_number || "").trim();
  let { data: existing, error: existingError } = await supabase
    .from("insurance_claims" as any)
    .select("id,claim_number,deleted_at,archived_at")
    .eq("tenant_id", claim.tenant_id)
    .ilike("claim_number", claimNumber)
    .limit(1)
    .maybeSingle();
  if (existingError && isMissingColumnError(existingError)) {
    ({ data: existing, error: existingError } = await supabase
      .from("insurance_claims" as any)
      .select("id,claim_number")
      .eq("tenant_id", claim.tenant_id)
      .ilike("claim_number", claimNumber)
      .limit(1)
      .maybeSingle());
  }
  if (existingError) throw existingError;
  if ((existing as any)?.id) {
    const err = new Error("claim_number_exists");
    (err as any).existingClaimId = (existing as any).id;
    (err as any).existingClaimInactive = !!((existing as any).deleted_at || (existing as any).archived_at);
    throw err;
  }

  return sanitizeClaimWritePayload({ ...claim, claim_number: claimNumber });
}
