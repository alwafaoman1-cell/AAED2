import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { ensureVehicleForCustomer, findExistingVehicle, normalizeVehiclePlate, normalizeVin } from "@/lib/vehicleIdentity";
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
}

async function linkClaimVehicle(claimId: string, vehicleId: string) {
  if (!isUuid(claimId) || !isUuid(vehicleId)) return;
  const { error } = await supabase
    .from("insurance_claims" as any)
    .update({ vehicle_id: vehicleId } as any)
    .eq("id", claimId);
  if (error) throw error;
}

export async function resolveClaimVehicleForWorkOrder(input: ResolveClaimVehicleInput): Promise<string> {
  if (!isUuid(input.customerId || "")) {
    throw new Error("لا يمكن إنشاء أمر العمل قبل ربط العميل بالمطالبة");
  }

  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");

  if (input.vehicleId && isUuid(input.vehicleId)) {
    await linkClaimVehicle(input.claimId, input.vehicleId);
    return input.vehicleId;
  }

  const existing = await findExistingVehicle({
    vehicleId: input.vehicleId,
    customerId: input.customerId,
    plate: input.plate,
    plateNumber: input.plateNumber,
    plateLetters: input.plateLetters,
    plateCountry: input.plateCountry,
    vin: input.vin,
    make: input.make,
    model: input.model,
    year: input.year,
    color: input.color,
  });

  if (existing?.id) {
    if (existing.customer_id && existing.customer_id !== input.customerId) {
      throw new Error("المركبة موجودة في Supabase لكنها مرتبطة بعميل آخر. افتح سجل المركبة أو اختر العميل الصحيح قبل إنشاء أمر العمل.");
    }
    if (!existing.customer_id) {
      const { error } = await supabase
        .from("vehicles")
        .update({ customer_id: input.customerId } as any)
        .eq("tenant_id", tenantId)
        .eq("id", existing.id);
      if (error) throw error;
    }
    await linkClaimVehicle(input.claimId, existing.id);
    return existing.id;
  }

  const plate = normalizeVehiclePlate(input);
  const make = String(input.make || "").trim();
  const vin = normalizeVin(input.vin);
  if (!plate.digits) throw new Error("لا يمكن إنشاء أمر العمل قبل إدخال رقم لوحة المركبة");
  if (!make) throw new Error("لا يمكن إنشاء أمر العمل قبل إدخال ماركة المركبة");

  const created = await ensureVehicleForCustomer({
    customerId: input.customerId!,
    plate: input.plate,
    plateNumber: input.plateNumber || plate.digits,
    plateLetters: input.plateLetters || plate.letters,
    plateCountry: input.plateCountry || plate.country,
    vin,
    make,
    model: input.model,
    year: input.year,
    color: input.color,
  });

  await linkClaimVehicle(input.claimId, created.vehicleId);
  return created.vehicleId;
}
