import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
describe("entry inspection persistence boundaries", () => {
  it("keeps UUID linking and DR allocation in one server transaction without creating a claim or order", () => {
    const sql = read("supabase/migrations/20261105094638_vehicle_entry_claim_inspection_link.sql");
    expect(sql).toContain("public.save_insurance_damage_report(");
    expect(sql).toContain("update public.insurance_claims set inspection_id = v_inspection.id");
    expect(sql).toContain("INSPECTION_ALREADY_EXISTS");
    expect(sql).toContain("for update");
    expect(sql).not.toMatch(/insert into public\.(insurance_claims|job_orders|vehicle_entries)\b/i);
    expect(sql).toContain("p.user_id = auth.uid()");
    expect(sql).toContain("p.disabled_at is null");
    expect(sql).toContain("inspector_id = coalesce(inspector_id, v_profile_id)");
  });
  it("protects first attachment and legacy edits, including direct table writes", () => {
    const sql = read("supabase/migrations/20261105094929_guard_entry_inspection_first_link.sql");
    expect(sql).toContain("before insert or update");
    expect(sql).toContain("old.created_at < transaction_timestamp()");
    expect(sql).toContain("new.details->>'claimId' is distinct from old.details->>'claimId'");
    expect(sql).toContain("v_claim.vehicle_id is distinct from v_entry.vehicle_id");
  });
  it("does not auto-overwrite a recovered visit report after a lost response", () => {
    const source = read("src/components/inspection/InsuranceInspectionDialog.tsx");
    expect(source).toContain("if (!entryContext && !existingCode && saveOutcomeUnknownRef.current)");
    expect(source).toContain("refetchType: \"none\"");
    expect(read("src/pages/insurance/InsuranceClaimDetail.tsx")).toContain("ins?.details?.insuranceInspectionReport");
  });
  it("exposes the same guarded action in desktop, mobile, kanban and the operational file", () => {
    expect(read("src/pages/vehicle-entry/VehicleEntryList.tsx").match(/<VehicleEntryInspectionAction entry=/g)).toHaveLength(3);
    expect(read("src/pages/vehicle-entry/VehicleVisitControlPanel.tsx")).toContain("<VehicleEntryInspectionAction entry={visit.entry}");
    expect(read("src/components/vehicle-entry/VehicleEntryInspectionAction.tsx")).toContain('<Can module="Insurance Inspection" action="Create/Edit">');
  });
});
