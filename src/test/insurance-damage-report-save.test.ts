import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { saveInsuranceDamageReport } from "@/lib/insuranceDamageReportService";
import type { InsuranceInspectionData } from "@/lib/insuranceInspectionPdf";

const report = {
  reportNo: "DR-00002",
  date: "2026-10-21",
  claimNo: "QA-1",
  regNo: "QA-1",
  sections: [],
} as InsuranceInspectionData;

describe("insurance damage report cloud save", () => {
  beforeEach(() => rpc.mockReset());

  it("uses the confirmed server number, not the provisional preview", async () => {
    rpc.mockResolvedValue({ data: "DR-00039", error: null });
    const saved = await saveInsuranceDamageReport({
      requestId: "00000000-0000-4000-8000-000000000001",
      report,
    });
    expect(rpc).toHaveBeenCalledWith("save_insurance_damage_report", {
      p_existing_code: null,
      p_request_id: "00000000-0000-4000-8000-000000000001",
      p_work_order_number: null,
      p_report: report,
    });
    expect(saved.id).toBe("DR-00039");
    expect(saved.report.reportNo).toBe("DR-00039");
  });

  it("rejects failed or unconfirmed saves instead of showing success", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("database unavailable") });
    await expect(saveInsuranceDamageReport({ requestId: "retry", report }))
      .rejects.toThrow("database unavailable");
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(saveInsuranceDamageReport({ requestId: "retry", report }))
      .rejects.toThrow("INSPECTION_SAVE_NOT_CONFIRMED");
  });
});
