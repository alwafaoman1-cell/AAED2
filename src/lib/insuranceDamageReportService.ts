import { supabase } from "@/integrations/supabase/client";
import type { InsuranceInspectionData } from "@/lib/insuranceInspectionPdf";
import type { Json } from "@/integrations/supabase/types";

export interface SaveInsuranceDamageReportInput {
  existingCode?: string;
  requestId: string;
  workOrderNumber?: string;
  /** A confirmed visit opens the atomic entry/claim-linked save path. */
  vehicleEntryId?: string;
  claimId?: string;
  report: InsuranceInspectionData;
}

/** The database allocates a DR number and saves the report in one transaction. */
export async function saveInsuranceDamageReport(input: SaveInsuranceDamageReportInput) {
  if (input.vehicleEntryId) {
    const { data, error } = await supabase.rpc("save_vehicle_entry_damage_inspection", {
      p_entry_id: input.vehicleEntryId, p_existing_code: input.existingCode || null,
      p_request_id: input.requestId, p_report: input.report as unknown as Json,
    });
    if (error) throw error;
    const result = data as unknown as { code?: string; entryId?: string; claimId?: string; report?: InsuranceInspectionData };
    if (!result || !/^DR-\d{5}$/.test(result.code || "") || result.entryId !== input.vehicleEntryId
      || !input.claimId || result.claimId !== input.claimId || result.report?.reportNo !== result.code) {
      throw new Error("INSPECTION_SAVE_NOT_CONFIRMED");
    }
    return { id: result.code!, report: result.report! };
  }
  const { data, error } = await (supabase as any).rpc("save_insurance_damage_report", {
    p_existing_code: input.existingCode || null,
    p_request_id: input.requestId,
    p_work_order_number: input.workOrderNumber || null,
    p_report: input.report,
  });
  if (error) throw error;
  if (typeof data !== "string" || !/^DR-\d{5}$/i.test(data)) {
    throw new Error("INSPECTION_SAVE_NOT_CONFIRMED");
  }
  return { id: data, report: { ...input.report, reportNo: data } };
}
