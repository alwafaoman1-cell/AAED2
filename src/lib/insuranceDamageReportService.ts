import { supabase } from "@/integrations/supabase/client";
import type { InsuranceInspectionData } from "@/lib/insuranceInspectionPdf";

export interface SaveInsuranceDamageReportInput {
  existingCode?: string;
  requestId: string;
  workOrderNumber?: string;
  report: InsuranceInspectionData;
}

/** The database allocates a DR number and saves the report in one transaction. */
export async function saveInsuranceDamageReport(input: SaveInsuranceDamageReportInput) {
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
