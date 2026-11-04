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
  allowDifferentCustomer?: boolean;
  reactivateArchived?: boolean;
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
  archived: boolean;
  /** Soft deletion is not archival and must be restored through the explicit admin flow. */
  deleted: boolean;
  source: "explicit" | "plate" | "vin";
}

export function normalizeVin(input?: string | null): string {
  return String(input || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeVehiclePlate(input: VehicleIdentityInput) {
  // Older intake/import records sometimes put the full plate in plateNumber.
  // Do not drop its letters and accidentally resolve/create another vehicle.
  const parsed = parseFullPlate(input.plate || input.plateNumber || "");
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
    archived: !!row.archived || !!row.archived_at,
    deleted: !!row.deleted_at,
    source,
  };
}

async function updateExistingVehicleFromInput(
  tenantId: string,
  existing: VehicleIdentityMatch,
  input: VehicleIdentityInput,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const plate = normalizeVehiclePlate(input);
  const vin = normalizeVin(input.vin);
  const make = String(input.make || "").trim();
  const model = String(input.model || "").trim();
  const color = String(input.color || "").trim();
  const year = input.year ? Number(input.year) || null : null;

  if (input.reactivateArchived && existing.archived) {
    patch.archived = false;
    patch.archived_at = null;
    patch.archived_reason = null;
  }

  if (plate.digits && plate.digits !== existing.plate_number) patch.plate_number = plate.digits;
  if (plate.letters && plate.letters !== existing.plate_letters) patch.plate_letters = plate.letters;
  if (plate.country && plate.country !== existing.plate_country) patch.plate_country = plate.country;
  if (vin && vin !== normalizeVin(existing.vin_number || existing.vin)) {
    patch.vin = vin;
    patch.vin_number = vin;
  }
  if (make && make !== (existing.brand || "")) patch.brand = make;
  if (model && model !== (existing.model || "")) patch.model = model;
  if (year && year !== existing.year) patch.year = year;
  if (color && color !== (existing.color || "")) patch.color = color;

  if (Object.keys(patch).length === 0) return;

  const { data, error } = await supabase
    .from("vehicles")
    .update(patch as any)
    .eq("tenant_id", tenantId)
    .eq("id", existing.id)
    .is("deleted_at", null)
    .select("id").maybeSingle();

  if (error) {
    if (isVehicleAlreadyExistsError(error)) {
      throw new Error(vehicleSelectionRequiredMessage());
    }
    throw error;
  }
  if (data?.id !== existing.id) throw new Error("selected_vehicle_unavailable");
}

export async function findExistingVehicle(input: VehicleIdentityInput): Promise<VehicleIdentityMatch | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  return findExistingVehicleInTenant(input, tenantId);
}

async function findExistingVehicleInTenant(input: VehicleIdentityInput, tenantId: string): Promise<VehicleIdentityMatch | null> {

  if (input.vehicleId && isUuid(input.vehicleId)) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,archived,archived_at,deleted_at,customers(name,phone)")
      .eq("tenant_id", tenantId)
      .eq("id", input.vehicleId)
      .maybeSingle();
    if (error) throw error;
    if (data) return mapVehicle(data, "explicit");
    // An explicit selection must never fall through to a different record/tenant.
    throw new Error("selected_vehicle_unavailable");
  }

  const plate = normalizeVehiclePlate(input);
  const hasCompletePlate = !!plate.letters && !!plate.digits && !!plate.country;
  if (hasCompletePlate) {
    const { data, error } = await (supabase as any).rpc("find_vehicle_by_plate", {
      p_letters: plate.letters,
      p_digits: plate.digits,
      p_country: plate.country,
    });
    if (error) throw error;
    if (Array.isArray(data) && data.length > 1) throw new Error("ambiguous_vehicle_identity");
    const row = ((data as any[]) || [])[0];
    if (row?.id) {
      const { data: full, error: fullError } = await supabase
        .from("vehicles")
        .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,archived,archived_at,deleted_at,customers(name,phone)")
        .eq("tenant_id", tenantId)
        .eq("id", row.id)
        .maybeSingle();
      if (fullError) throw fullError;
      if (full) return mapVehicle(full, "plate");
      // Do not expose a SECURITY DEFINER RPC result without a tenant-scoped read.
      throw new Error("selected_vehicle_unavailable");
    }
  }

  const vin = normalizeVin(input.vin);
  if (vin) {
    if (!/^[A-Z0-9]+$/.test(vin)) throw new Error("invalid_vehicle_vin");
    const { data, error } = await supabase
      .from("vehicles")
      .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,archived,archived_at,deleted_at,customers(name,phone)")
      .eq("tenant_id", tenantId)
      .or(`vin.eq.${vin},vin_number.eq.${vin}`)
      .limit(2);
    if (error) throw error;
    if (data && data.length > 1) throw new Error("ambiguous_vehicle_identity");
    if (data?.[0]) return mapVehicle(data[0], "vin");
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
  return ensureVehicle(input);
}

export type VehicleVisitIdentityInput = Omit<VehicleIdentityInput, "allowDifferentCustomer" | "reactivateArchived"> & {
  customerId: string;
  /** Only final, user-confirmed creation of a new visit/order/claim may opt in. */
  confirmedNewVisit: boolean;
};

/** Resolve an operational vehicle, not its owner. Existing rows are read-only here:
 * archive reactivation belongs to the successful NEW operation's database transaction.
 * Never call during search/selection or historical edits.
 */
export async function ensureVehicleForVisit(input: VehicleVisitIdentityInput) {
  if (input.confirmedNewVisit !== true) throw new Error("new_visit_requires_confirmation");
  return ensureVehicle(input, true);
}

async function ensureVehicle(input: VehicleIdentityInput & { customerId: string }, operationalVisit = false) {
  if (!isUuid(input.customerId)) throw new Error("customer_id must be a valid UUID before linking vehicle");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");
  if (!input.customerId) throw new Error("customer_id مطلوب قبل ربط المركبة");

  if (input.vehicleId && !isUuid(input.vehicleId)) throw new Error("invalid_vehicle_id");
  if (operationalVisit) {
    const { data: customer, error } = await supabase.from("customers").select("id")
      .eq("tenant_id", tenantId).eq("id", input.customerId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!customer) throw new Error("selected_customer_unavailable");
  }
  const existing = await findExistingVehicleInTenant(input, tenantId);
  if (existing?.id) {
    if (existing.deleted) throw new Error("deleted_vehicle_requires_restore");
    const sameCustomer = !existing.customer_id || existing.customer_id === input.customerId;
    if (existing.archived && !input.reactivateArchived && !operationalVisit) {
      throw new Error("archived_vehicle_requires_confirmation");
    }
    if (input.vehicleId && input.vehicleId !== existing.id) {
      throw new Error(vehicleSelectionRequiredMessage());
    }
    if (!operationalVisit && !input.vehicleId && !sameCustomer && !input.allowDifferentCustomer) {
      throw new Error(vehicleSelectionRequiredMessage());
    }
    const confirmedVinCandidate = existing.source !== "vin" || input.allowVinCandidate || input.vehicleId === existing.id;
    if (!confirmedVinCandidate) {
      throw new Error("vin_candidate_requires_user_confirmation");
    }
    if (await getCurrentTenantId() !== tenantId) throw new Error("vehicle_tenant_changed");
    let resolvedExisting = existing;
    if (operationalVisit) {
      // Do not UPDATE vehicles: insurance/supervisor roles may insert an operation
      // without permission to update the registry. Re-read to catch deletion or
      // tenant changes; the insert trigger performs the final locked DB check.
      const current = await findExistingVehicleInTenant({ vehicleId: existing.id }, tenantId);
      if (!current) throw new Error("selected_vehicle_unavailable");
      if (current.deleted) throw new Error("deleted_vehicle_requires_restore");
      if (await getCurrentTenantId() !== tenantId) throw new Error("vehicle_tenant_changed");
      resolvedExisting = { ...current, source: existing.source };
    } else {
      await updateExistingVehicleFromInput(tenantId, existing, input);
    }
    return {
      vehicleId: existing.id,
      existing: resolvedExisting,
      ownershipConflict: !!resolvedExisting.customer_id && resolvedExisting.customer_id !== input.customerId,
      reactivated: !operationalVisit && !!input.reactivateArchived && existing.archived,
      pendingReactivation: operationalVisit && resolvedExisting.archived,
      created: false,
    };
  }

  const plate = normalizeVehiclePlate(input);
  const vin = normalizeVin(input.vin);
  const make = String(input.make || "").trim();
  const model = String(input.model || "").trim();
  if (!plate.digits) throw new Error("رقم اللوحة مطلوب قبل حفظ المركبة");
  if (operationalVisit && !plate.letters) throw new Error("vehicle_plate_letters_required");
  if (!make) throw new Error("أدخل ماركة المركبة قبل الحفظ");
  if (await getCurrentTenantId() !== tenantId) throw new Error("vehicle_tenant_changed");
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
  if (!data?.id || !isUuid(data.id)) throw new Error("vehicle_save_not_confirmed");
  return { vehicleId: data.id as string, existing: null, ownershipConflict: false, reactivated: false, pendingReactivation: false, created: true };
}
