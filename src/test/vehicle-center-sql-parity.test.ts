import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getVehicleCenterTab, projectClaimWithoutEntry, resolveVehicleVisit } from "@/lib/vehicleVisitLifecycle";

const base = { id: "entry-1", tenant_id: "tenant-1", vehicle_id: "vehicle-1", status: "Received",
  arrival_date: "2026-11-01", arrival_time: "08:00:00", vehicle_location: "داخل الورشة" };
const claim = { id: "claim-1", tenant_id: "tenant-1", vehicle_id: base.vehicle_id, status: "approved", vehicle_presence_status: "in_workshop" };
const order = { id: "order-1", tenant_id: "tenant-1", vehicle_id: base.vehicle_id, status: "received", work_order_type: "cash", vehicle_presence_status: "in_workshop" };
const fixtures: any[] = [
  { name: "new_inspection_inside", entry: { ...base, vehicle_condition: { visit_purpose: "inspection" } } },
  { name: "temporary_exit_paper_no_image", entry: { ...base, vehicle_location: "مع العميل" }, temporary: true },
  { name: "unknown_exit_no_proof", entry: { ...base, vehicle_location: "مع العميل" } },
  { name: "client_held_delivery_no_handover", entry: { ...base, insurance_claim_id: claim.id,
    claim: { ...claim, vehicle_presence_status: "with_customer", delivered_at: "2026-11-02T08:00:00Z" } } },
  { name: "inside_delivery_conflict", entry: { ...base, insurance_claim_id: claim.id,
    claim: { ...claim, delivered_at: "2026-11-02T08:00:00Z" } } },
  { name: "pre_arrival_delivery_not_this_visit", entry: { ...base, insurance_claim_id: claim.id,
    claim: { ...claim, delivered_at: "2026-10-01T08:00:00Z" } } },
  { name: "cancelled_with_order", entry: { ...base, status: "Cancelled", work_order_id: order.id, work_order: order } },
  { name: "cancelled_alone", entry: { ...base, status: "Cancelled" } },
  { name: "wrong_vehicle_link", entry: { ...base, work_order_id: order.id, work_order: { ...order, vehicle_id: "wrong" } } },
  { name: "inferred_claim_review", entry: { ...base, __inferredClaimLink: true, claim } },
  { name: "repair_in_progress", entry: { ...base, work_order_id: order.id, work_order: { ...order, status: "in_progress" } }, evidenceStage: "in_progress" },
  { name: "repair_ready", entry: { ...base, work_order_id: order.id, work_order: { ...order, status: "completed" } }, evidenceStage: "ready" },
  { name: "signed_final_handover", entry: { ...base, vehicle_location: "مع العميل", work_order_id: order.id,
    work_order: { ...order, status: "delivered", vehicle_presence_status: "with_customer" } }, final: true, evidenceStage: "delivered" },
  { name: "persisted_review", entry: base, workflow: { tenant_id: "tenant-1", stage: "approved", review_reason: "source_regressed" } },
  ...["pending", "approved", "cancelled"].map((status) => ({ name: `claim_only_${status}`, entry: {
    ...projectClaimWithoutEntry({ ...claim, status, vehicle_presence_status: "with_customer", created_at: "2026-11-01T08:00:00Z" }, null).entry,
    tenant_id: "tenant-1",
  } })),
];

function expected(row: any) {
  const visit = row.entry._claimOnly ? projectClaimWithoutEntry(row.entry.claim, row.entry.work_order || null)
    : resolveVehicleVisit(row.entry, row.workflow || null, Boolean(row.final ?? row.hasFinalHandover), Boolean(row.temporary ?? row.hasSignedTemporaryRelease));
  visit.hasSignedTemporaryRelease = Boolean(row.temporary ?? row.hasSignedTemporaryRelease);
  if (row.duplicateOpenVisit) {
    visit.stage = "needs_review"; visit.operationalStage = "needs_review";
    visit.reviewReason ||= "duplicate_open_visit";
  }
  return { stage: visit.stage, operationalStage: visit.operationalStage, reviewReason: visit.reviewReason, centerTab: getVehicleCenterTab(visit) };
}

describe("SQL/frontend center parity fixtures", () => {
  it("derives expected SQL results from the canonical frontend, including paper acknowledgement without an image", () => {
    const rows = fixtures.map((row) => ({ ...row, expected: expected(row) }));
    expect(rows.find((row) => row.name === "temporary_exit_paper_no_image")?.expected.centerTab).toBe("with_customer");
    expect(rows.find((row) => row.name === "client_held_delivery_no_handover")?.expected.centerTab).toBe("delivered");
    if (process.env.VEHICLE_CENTER_WRITE_FIXTURES === "1") {
      const dir = resolve("output/vehicle-center-projection-trial");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "parity-fixtures.json"), JSON.stringify(rows));
    }
  });
  it.runIf(Boolean(process.env.VEHICLE_CENTER_SQL_PARITY_FILE))("compares the transaction's real Development projection to the canonical frontend", () => {
    const rows = JSON.parse(readFileSync(process.env.VEHICLE_CENTER_SQL_PARITY_FILE!, "utf8"));
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      const wanted = expected(row);
      expect({ stage: row.stage, operationalStage: row.operationalStage, reviewReason: row.reviewReason, centerTab: row.centerTab }).toEqual(wanted);
    }
  });
});
