// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("claim and vehicle center ownership", () => {
  it("does not re-save stale physical custody dates when claim details are saved", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");
    const save = source.slice(source.indexOf("const handleSave = async () =>"),
      source.indexOf("const handleDelete = () =>"));
    expect(save).toContain("const { workshop_arrival_date: _arrival, work_started_at: _started, ...claimDetails } = payload");
    expect(save).toContain("updates: claimDetails");
    expect(save).not.toContain("vehicle_received_at: workflowDates.arrival");
    expect(source).not.toContain("handleConfirmStageChange");
    expect(source).not.toContain("openStageDialog");
    expect(source).toContain("confirmedActualArrival");
    expect(source).toContain("if (!result.created) {");
  });
  it("uses the existing claim approval dialog instead of a second approval mutation", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");
    expect(source).toContain('["approve", "arrival", "undoDelivery"].includes(requestedVisitAction)');
    expect(source).toContain('openApproveDialog();');
    const quickAction = readFileSync(join(process.cwd(), "src/pages/vehicle-entry/VehicleVisitQuickActionDialog.tsx"), "utf8");
    expect(quickAction).toContain('visitAction=approve');
    expect(quickAction).not.toContain('status: "approved"');
  });
});
