import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getVehicleEntry, getVehicleEntryPresence } from "@/lib/vehicleEntryService";
import type { InsuranceInspectionData } from "@/lib/insuranceInspectionPdf";
import type { InspectionRecord } from "@/lib/inspectionsStore";

export interface VehicleEntryInspectionContext {
  entryId: string;
  entryNumber: string;
  claimId: string;
  workOrderNumber?: string;
  meta: Pick<InsuranceInspectionData, "claimNo" | "regNo" | "makeModel" | "modelYear" | "gatePass" | "insuranceCompany" | "surveyorName"> & { customer: string; phone: string };
  existingCode?: string;
  report?: InsuranceInspectionData;
}

/** Entry/claim UUIDs, never plate-only or cached work-order guesses, define this visit. */
export function canInspectVehicleEntry(entry: any): boolean {
  return Boolean(entry?.id && !entry._claimOnly && !entry.deleted_at && entry.status !== "Draft"
    && entry.status !== "Cancelled" && entry.vehicle_id
    && getVehicleEntryPresence(entry) === "in_workshop"
    && (entry.insurance_claim_id || entry.converted_claim_id)
    && !(entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id)
    && !["cancelled", "rejected"].includes((entry.claim || entry.converted_claim)?.status));
}

export async function loadVehicleEntryInspection(entryId: string): Promise<VehicleEntryInspectionContext> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const entry = await getVehicleEntry(entryId, { includeAttachments: false });
  if (!canInspectVehicleEntry(entry) || entry.tenant_id !== tenantId) throw new Error("INSPECTION_ENTRY_UNAVAILABLE");
  const claimId = entry.insurance_claim_id || entry.converted_claim_id;
  const { data: claim, error } = await supabase.from("insurance_claims")
    .select("id,tenant_id,vehicle_id,claim_number,inspection_id,insurance_company,vehicle_owner_name,vehicle_owner_phone,adjuster_name,status")
    .eq("tenant_id", tenantId).eq("id", claimId).is("deleted_at", null).single();
  if (error) throw error;
  if (claim.vehicle_id !== entry.vehicle_id || ["cancelled", "rejected"].includes(claim.status)) throw new Error("INSPECTION_LINK_CONFLICT");
  const orderId = entry.work_order_id || entry.converted_work_order_id;
  const order = entry.work_order || entry.converted_work_order;
  if ((entry.work_order_id && entry.converted_work_order_id && entry.work_order_id !== entry.converted_work_order_id)
    || (orderId && (!order || order.id !== orderId || order.tenant_id !== tenantId || order.deleted_at
      || order.vehicle_id !== entry.vehicle_id || order.claim_id !== claimId || order.work_order_type !== "insurance"
      || (order.vehicle_entry_id && order.vehicle_entry_id !== entry.id)))) throw new Error("INSPECTION_LINK_CONFLICT");
  const { data: inspections, error: inspectionError } = await supabase.from("inspections")
    .select("id,inspection_code,details").eq("tenant_id", tenantId).eq("inspection_kind", "insurance")
    .eq("details->>vehicleEntryId", entry.id).limit(2);
  if (inspectionError) throw inspectionError;
  const saved = inspections?.[0];
  if ((inspections?.length || 0) > 1 || (claim.inspection_id && claim.inspection_id !== saved?.id)
    || (saved && (saved.details as Record<string, unknown>)?.claimId !== claimId)) throw new Error("INSPECTION_LINK_CONFLICT");
  if (saved && !(saved.details as Record<string, unknown>)?.insuranceInspectionReport) throw new Error("INSPECTION_LINK_CONFLICT");
  const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
  const customer = entry.customer || entry.customer_snapshot || {};
  return {
    entryId: entry.id, entryNumber: entry.entry_number, claimId,
    workOrderNumber: orderId ? order?.order_number : undefined,
    meta: {
      claimNo: claim.claim_number, regNo: [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
      makeModel: [vehicle.brand || vehicle.make, vehicle.model].filter(Boolean).join(" "), modelYear: String(vehicle.year || ""),
      gatePass: entry.entry_number, insuranceCompany: claim.insurance_company,
      surveyorName: claim.adjuster_name || "", customer: claim.vehicle_owner_name || customer.name || "",
      phone: claim.vehicle_owner_phone || customer.phone || "",
    },
    existingCode: saved?.inspection_code || undefined,
    report: (saved?.details as Record<string, unknown>)?.insuranceInspectionReport as InsuranceInspectionData | undefined,
  };
}

/** Exact persisted FK lookup; does not guess from plate, claim text or the latest cache item. */
export async function loadClaimInspection(claimId: string, inspectionId: string): Promise<InspectionRecord> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const { data: claim, error: claimError } = await supabase.from("insurance_claims").select("inspection_id")
    .eq("tenant_id", tenantId).eq("id", claimId).single();
  if (claimError) throw claimError;
  if (claim.inspection_id !== inspectionId) throw new Error("INSPECTION_LINK_CONFLICT");
  const { data, error } = await supabase.from("inspections")
    .select("*,job_order:job_orders(order_number)").eq("tenant_id", tenantId).eq("id", inspectionId).single();
  if (error) throw error;
  const details = data.details as Record<string, unknown>;
  if (details.claimId && details.claimId !== claimId) throw new Error("INSPECTION_LINK_CONFLICT");
  return { id: data.inspection_code || data.id, workOrder: data.job_order?.order_number || "—",
    customer: data.customer_name || "", vehicle: data.vehicle_summary || "", date: data.inspection_date,
    damageType: data.damage_type || "", photos: data.photo_count, status: data.status,
    kind: data.inspection_kind === "insurance" ? "insurance" : "general", plate: data.plate_number || undefined, details };
}
