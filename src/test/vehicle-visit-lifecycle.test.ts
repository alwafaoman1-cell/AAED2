// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveVehicleVisit, type VehicleVisitWorkflow } from "@/lib/vehicleVisitLifecycle";

const vehicle = "vehicle-1";
const base = { id: "entry-1", vehicle_id: vehicle, arrival_date: "2026-10-20", arrival_time: "08:00", vehicle_location: "داخل الورشة", status: "Received" };
const workflow = (stage: VehicleVisitWorkflow["stage"], review_reason: string | null = null): VehicleVisitWorkflow => ({
  entry_id: base.id, tenant_id: "tenant-1", vehicle_id: vehicle, stage, revision: 2,
  review_reason, changed_at: "2026-10-20T10:00:00Z", changed_by: null,
});

describe("vehicle visit stage projection", () => {
  it("preserves the persisted stage of a healthy visit", () => {
    expect(resolveVehicleVisit(base, workflow("approved"), false).stage).toBe("approved");
  });
  it("does not classify a paper delivery as a completed handover", () => {
    const delivered = { ...base, vehicle_location: "مع العميل", work_order_id: "order-1", work_order: { id: "order-1", vehicle_id: vehicle, status: "delivered", vehicle_delivered_at: "2026-10-22T10:00:00Z", vehicle_presence_status: "with_customer" } };
    const projected = resolveVehicleVisit(delivered, workflow("ready"), false);
    expect(projected.stage).toBe("needs_review");
    expect(projected.reviewReason).toBe("delivery_without_signed_handover");
    expect(resolveVehicleVisit(delivered, workflow("delivered"), true).stage).toBe("delivered");
  });
  it("keeps inspection inside until a signed temporary release changes custody", () => {
    expect(resolveVehicleVisit({ ...base, vehicle_condition: { visit_purpose: "inspection" } }, workflow("arrived"), false).stage).toBe("arrived");
    expect(resolveVehicleVisit({ ...base, vehicle_location: "مع العميل" }, workflow("arrived"), false).stage).toBe("needs_review");
    expect(resolveVehicleVisit({ ...base, vehicle_location: "مع العميل" }, workflow("arrived"), false, true).stage).toBe("arrived");
  });
  it("quarantines mismatched links and regression flags without changing the workflow", () => {
    expect(resolveVehicleVisit({ ...base, work_order_id: "other", work_order: { vehicle_id: "different" } }, workflow("in_progress"), false).stage).toBe("needs_review");
    expect(resolveVehicleVisit(base, workflow("in_progress", "source_regressed"), false).stage).toBe("needs_review");
  });
  it("keeps historical entries as a read-only source projection", () => {
    expect(resolveVehicleVisit({ ...base, claim: { status: "approved" } }, null, false).stage).toBe("approved");
    expect(resolveVehicleVisit({ ...base, work_order: { status: "completed" } }, null, false).stage).toBe("ready");
  });
  it("uses tenant-scoped reads and a cloud-confirmed transition, never browser-local stage state", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/vehicleVisitLifecycle.ts"), "utf8");
    expect(source).toContain('supabase.rpc("advance_vehicle_visit"');
    expect(source).toContain('row.revision !== input.revision + 1');
    expect(source).toContain('.eq("tenant_id", tenantId)');
    expect(source).not.toContain("localStorage");
  });
});
