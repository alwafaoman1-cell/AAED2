import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import {
  extractPlateDigits,
  extractPlateLetters,
  normalizePlateCountry,
  parseFullPlate,
} from "@/lib/plateUtils";
import { isUuid } from "@/lib/uuid";

export interface VehicleIdentityInput {
  vehicleId?: string | null;
  allowVinCandidate?: boolean;
  customerId?: string | null;
  plate?: string | null;
  plateNumber?: string | null;
  plateLetters?: string | null;
  plateCountry?: string | null;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | number | null;
  color?: string | null;
}

export interface VehicleIdentityMatch {
  id: string;
  customer_id: string | null;
  plate_number: string | null;
  plate_letters: string | null;
  plate_country: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  vin_number: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  source: "explicit" | "plate" | "vin";
}

export function normalizeVin(input?: string | null): string {
  return String(input || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeVehiclePlate(input: VehicleIdentityInput) {
  const parsed = parseFullPlate(input.plate || "");
  return {
    letters: extractPlateLetters(input.plateLetters || parsed.letters),
    digits: extractPlateDigits(input.plateNumber || parsed.digits),
    country: normalizePlateCountry(input.plateCountry || "OM"),
  };
}

function mapVehicle(row: any, source: VehicleIdentityMatch["source"]): VehicleIdentityMatch {
  return {
    id: row.id,
    customer_id: row.customer_id || null,
    plate_number: row.plate_number || null,
    plate_letters: row.plate_letters || null,
    plate_country: row.plate_country || null,
    brand: row.brand || null,
    model: row.model || null,
    year: row.year ?? null,
    color: row.color || null,
    vin: row.vin || null,
    vin_number: row.vin_number || null,
    customer_name: row.customers?.name || null,
    customer_phone: row.customers?.phone || null,
    source,
  };
}

export async function findExistingVehicle(input: VehicleIdentityInput): Promise<VehicleIdentityMatch | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  if (input.vehicleId && isUuid(input.vehicleId)) {
    const { data } = await supabase
      .from("vehicles")
      .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,customers(name,phone)")
      .eq("tenant_id", tenantId)
      .eq("id", input.vehicleId)
      .maybeSingle();
    if (data) return mapVehicle(data, "explicit");
  }

  const plate = normalizeVehiclePlate(input);
  const hasCompletePlate = !!plate.letters && !!plate.digits && !!plate.country;
  if (hasCompletePlate) {
    const { data } = await (supabase as any).rpc("find_vehicle_by_plate", {
      p_letters: plate.letters,
      p_digits: plate.digits,
      p_country: plate.country,
    });
    const row = ((data as any[]) || [])[0];
    if (row?.id) {
      const { data: full } = await supabase
        .from("vehicles")
        .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,customers(name,phone)")
        .eq("tenant_id", tenantId)
        .eq("id", row.id)
        .maybeSingle();
      if (full) return mapVehicle(full, "plate");
      return mapVehicle(row, "plate");
    }
  }

  const vin = normalizeVin(input.vin);
  if (vin) {
    const { data } = await supabase
      .from("vehicles")
      .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,customers(name,phone)")
      .eq("tenant_id", tenantId)
      .or(`vin.eq.${vin},vin_number.eq.${vin}`)
      .limit(1)
      .maybeSingle();
    if (data) return mapVehicle(data, "vin");
  }

  return null;
}

export function isVehicleAlreadyExistsError(error: unknown): boolean {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return raw.includes("23505") || raw.includes("duplicate key") || raw.includes("uniq_vehicle_plate");
}

export function vehicleSelectionRequiredMessage(): string {
  return "هذه المركبة موجودة مسبقًا. اختر Use This Vehicle أو غيّر بيانات اللوحة.";
}

export async function ensureVehicleForCustomer(input: VehicleIdentityInput & { customerId: string }) {
  if (!isUuid(input.customerId)) throw new Error("customer_id must be a valid UUID before linking vehicle");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");
  if (!input.customerId) throw new Error("customer_id مطلوب قبل ربط المركبة");

  const existing = await findExistingVehicle(input);
  if (existing?.id) {
    if (input.vehicleId !== existing.id) {
      throw new Error(vehicleSelectionRequiredMessage());
    }
    const confirmedVinCandidate = existing.source !== "vin" || input.allowVinCandidate || input.vehicleId === existing.id;
    if (!confirmedVinCandidate) {
      throw new Error("vin_candidate_requires_user_confirmation");
    }
    return {
      vehicleId: existing.id,
      existing,
      ownershipConflict: !!existing.customer_id && existing.customer_id !== input.customerId,
      created: false,
    };
  }

  const plate = normalizeVehiclePlate(input);
  const vin = normalizeVin(input.vin);
  const make = String(input.make || "").trim();
  const model = String(input.model || "").trim();
  if (!plate.digits) throw new Error("رقم اللوحة مطلوب قبل حفظ المركبة");
  if (!make || !model) throw new Error("أدخل ماركة وموديل المركبة قبل الحفظ");
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      tenant_id: tenantId,
      customer_id: input.customerId,
      plate_number: plate.digits,
      plate_letters: plate.letters || null,
      plate_country: plate.country,
      brand: make,
      model,
      year: input.year ? Number(input.year) || null : null,
      color: input.color || null,
      vin: vin || null,
      vin_number: vin || null,
    } as any)
    .select("id")
    .single();
  if (error) {
    if (isVehicleAlreadyExistsError(error)) {
      throw new Error(vehicleSelectionRequiredMessage());
    }
    throw error;
  }
  return { vehicleId: (data as any).id as string, existing: null, ownershipConflict: false, created: true };
}
