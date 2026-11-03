import { supabase } from "@/integrations/supabase/client";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { upsertUnifiedOperationalState } from "@/lib/claimWorkOrderUnified";
import { ensureVehicleEntryForClaim, getVehicleEntryByClaimId } from "@/lib/vehicleEntryService";
import i18n from "@/i18n";

type ClaimRow = InsuranceClaim & {
  deleted_at?: string | null;
  vehicle_entry_id?: string | null;
  vehicle_delivered_at?: string | null;
  auto_job_order_id?: string | null;
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_vin?: string | null;
  vehicle_year?: number | null;
};

export interface BulkVehicleEntryReport {
  created: Array<{ claimNumber: string; entryNumber: string }>;
  skipped: Array<{ claimNumber: string; reason: string }>;
  errors: Array<{ claimNumber: string; reason: string }>;
}

export function bulkVehicleEntryIneligibility(claim: ClaimRow): string | null {
  if (claim.deleted_at || ["cancelled", "rejected", "paid"].includes(claim.status)) return "closed";
  if (claim.delivered_at || claim.vehicle_delivered_at) return "delivered";
  if (!claim.customer_id || !claim.vehicle_id || !claim.customer?.name || !claim.vehicle) return "missingLink";
  if (!claim.vehicle.plate_number && !claim.vehicle.vin_number) return "missingIdentity";
  if (claim.vehicle_entry_id) return "linked";
  return null;
}

/** Each claim is re-read from the cloud; a selected, stale row is never used as the write source. */
export async function registerSelectedClaimVehicleEntries(
  selected: Pick<InsuranceClaim, "id" | "claim_number">[],
  tenantId: string,
  userId: string,
  receivedByName: string,
): Promise<BulkVehicleEntryReport> {
  const report: BulkVehicleEntryReport = { created: [], skipped: [], errors: [] };
  const seen = new Set<string>();

  // Sequential processing prevents two selected claims for the same car from
  // creating two active physical visits. The database also guards one entry/claim.
  for (const item of selected) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    let claimNumber = item.claim_number;
    let createdEntryNumber: string | null = null;
    try {
      const { data, error } = await supabase
        .from("insurance_claims" as any)
        .select("*,customer:customers(name,phone),vehicle:vehicles(brand,model,plate_number,plate_letters,plate_country,year,color,vin_number)")
        .eq("tenant_id", tenantId)
        .eq("id", item.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        report.skipped.push({ claimNumber, reason: i18n.t("insuranceBulkEntry.unavailable") });
        continue;
      }
      const claim = data as unknown as ClaimRow;
      claimNumber = claim.claim_number;
      const reason = bulkVehicleEntryIneligibility(claim);
      if (reason) {
        report.skipped.push({ claimNumber, reason: i18n.t(`insuranceBulkEntry.reasons.${reason}`) });
        continue;
      }
      const existing = await getVehicleEntryByClaimId(claim.id);
      if (existing) {
        report.skipped.push({ claimNumber, reason: i18n.t("insuranceBulkEntry.existing", { number: existing.entry_number }) });
        continue;
      }

      const { data: activeVisit, error: visitError } = await supabase
        .from("vehicle_entries" as any)
        .select("id,entry_number,insurance_claim_id")
        .eq("tenant_id", tenantId)
        .eq("vehicle_id", claim.vehicle_id!)
        .eq("vehicle_location", "داخل الورشة")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      if (visitError) throw visitError;
      if (activeVisit) {
        report.skipped.push({ claimNumber, reason: i18n.t("insuranceBulkEntry.activeVisit", { number: (activeVisit as any).entry_number }) });
        continue;
      }

      const result = await ensureVehicleEntryForClaim({
        claimId: claim.id,
        status: "Draft",
        customerId: claim.customer_id,
        vehicleId: claim.vehicle_id,
        insuranceCompanyId: claim.insurance_company_id,
        workOrderId: claim.job_order_id,
        receivedByName,
        customer: { name: claim.customer!.name, phone: claim.customer!.phone || "" },
        vehicle: {
          plate_number: claim.vehicle!.plate_number || "",
          plate_letters: claim.vehicle!.plate_letters || "",
          plate_country: claim.vehicle!.plate_country || "OM",
          make: claim.vehicle!.brand || claim.vehicle_make || "",
          model: claim.vehicle!.model || claim.vehicle_model || "",
          year: String(claim.vehicle!.year || claim.vehicle_year || ""),
          color: (claim.vehicle as any).color || claim.vehicle_color || "",
          vin: claim.vehicle!.vin_number || claim.vehicle_vin || "",
          current_owner_name: claim.vehicle_owner_name || claim.customer!.name,
        },
        insurance: {
          company_name: claim.insurance_company,
          claim_number: claim.claim_number,
          policy_number: claim.policy_number || "",
        },
      }, userId);
      if (!result.created) {
        report.skipped.push({ claimNumber, reason: i18n.t("insuranceBulkEntry.existing", { number: result.entry.entry_number }) });
        continue;
      }
      createdEntryNumber = result.entry.entry_number;
      const arrivalDate = String(result.entry.arrival_date);
      const arrivalTime = String(result.entry.arrival_time || "00:00").slice(0, 5);
      const receivedAt = new Date(`${arrivalDate}T${arrivalTime}:00`).toISOString();
      const { data: linked, error: linkError } = await supabase
        .from("insurance_claims" as any)
        .update({
          vehicle_entry_id: result.entry.id,
          workshop_arrival_date: arrivalDate,
          vehicle_presence_status: "in_workshop",
          vehicle_location_section: "داخل الورشة",
          vehicle_received_at: receivedAt,
          vehicle_location_updated_at: new Date().toISOString(),
          vehicle_location_updated_by: userId,
        } as any)
        .eq("tenant_id", tenantId)
        .eq("id", claim.id)
        .is("deleted_at", null)
        .is("vehicle_entry_id", null)
        .is("delivered_at", null)
        .in("status", ["pending", "approved"])
        .select("id,vehicle_entry_id,workshop_arrival_date,vehicle_presence_status")
        .maybeSingle();
      if (linkError) throw linkError;
      if (!linked || (linked as any).vehicle_entry_id !== result.entry.id) {
        throw new Error("تغيرت المطالبة أثناء الربط؛ افتح كرت الدخول وراجع الربط قبل المتابعة");
      }
      await upsertUnifiedOperationalState({
        tenantId,
        claimId: claim.id,
        workOrderId: claim.job_order_id,
        vehicleId: claim.vehicle_id,
        customerId: claim.customer_id,
        changedFrom: "claim",
        changedBy: userId,
        patch: {
          vehicle_received_at: receivedAt,
          vehicle_presence_status: "in_workshop",
          vehicle_location_section: "داخل الورشة",
          vehicle_location_updated_at: new Date().toISOString(),
          vehicle_location_updated_by: userId,
        },
      });
      report.created.push({ claimNumber, entryNumber: createdEntryNumber });
    } catch (error) {
      const detail = (error as Error)?.message || String(error);
      report.errors.push({
        claimNumber,
        reason: createdEntryNumber
          ? i18n.t("insuranceBulkEntry.partialLink", { number: createdEntryNumber, detail })
          : detail,
      });
    }
  }
  return report;
}
