// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultVehicleEntryForm,
  formFromVehicleEntry,
  getVehicleEntryPresence,
  getVehicleEntryVisitPurpose,
  vehicleEntryMatchesSearch,
  vehicleEntryStatusKey,
} from "@/lib/vehicleEntryService";

const entry = { arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Draft" };

describe("vehicle entry custody tabs", () => {
  it("keeps a new inspection visit in the workshop until release, without changing its document status", () => {
    const inspection = { ...entry, vehicle_condition: { visit_purpose: "inspection" } };
    expect(getVehicleEntryPresence(inspection)).toBe("in_workshop");
    expect(getVehicleEntryVisitPurpose(inspection)).toBe("inspection");
    expect(inspection.status).toBe("Draft");
  });

  it("moves a signed temporary release to with-customer and allows return", () => {
    expect(getVehicleEntryPresence({ ...entry, vehicle_location: "مع العميل", claim: { vehicle_presence_status: "with_customer" } })).toBe("with_customer");
    expect(getVehicleEntryPresence({ ...entry, claim: { vehicle_presence_status: "in_workshop" } })).toBe("in_workshop");
  });

  it("uses final delivery evidence even if the old entry card still says inside", () => {
    expect(getVehicleEntryPresence({ ...entry, claim: { vehicle_presence_status: "with_customer", delivered_at: "2026-10-25T14:00:00Z" } })).toBe("with_customer");
    expect(getVehicleEntryPresence({ ...entry, work_order: { vehicle_presence_status: "with_customer", vehicle_delivered_at: "2026-10-25T14:00:00Z" } })).toBe("with_customer");
    expect(getVehicleEntryPresence({ ...entry, converted_work_order_id: "linked-order", converted_work_order: { vehicle_delivered_at: "2026-10-25T14:00:00Z" } })).toBe("with_customer");
  });

  it("does not mistake a delivery from before the visit for the exit of the current visit", () => {
    expect(getVehicleEntryPresence({ ...entry, work_order: { vehicle_delivered_at: "2026-10-19T14:00:00Z" } })).toBe("in_workshop");
    expect(getVehicleEntryPresence({ ...entry, arrival_time: "16:00", work_order: { vehicle_delivered_at: "2026-10-20T08:00:00Z" } })).toBe("in_workshop");
    expect(getVehicleEntryPresence({ ...entry, arrival_time: "00:30", work_order: { vehicle_delivered_at: "2026-10-19T21:00:00Z" } })).toBe("with_customer");
  });

  it("quarantines contradictory or unknown locations instead of silently classifying them", () => {
    expect(getVehicleEntryPresence({ ...entry, claim: { vehicle_presence_status: "with_customer" } })).toBe("needs_review");
    expect(getVehicleEntryPresence({ ...entry, claim: { vehicle_presence_status: "in_workshop", delivered_at: "2026-10-25T14:00:00Z" } })).toBe("needs_review");
    expect(getVehicleEntryPresence({ ...entry, vehicle_location: "ساحة الورشة الخارجية" })).toBe("needs_review");
    expect(getVehicleEntryPresence({ ...entry, vehicle_location: null })).toBe("needs_review");
    expect(getVehicleEntryPresence({ ...entry, insurance_claim_id: "hidden-claim", claim: null })).toBe("needs_review");
    expect(getVehicleEntryPresence({ ...entry, insurance_claim_id: "claim-a", converted_claim_id: "claim-b" })).toBe("needs_review");
  });

  it("does not rewrite the purpose of historical records when opened for editing", () => {
    const historical = { ...entry, id: "test-entry", vehicle_condition: { flags: [] } };
    expect(getVehicleEntryVisitPurpose(historical)).toBeNull();
    expect(formFromVehicleEntry(historical).condition.visit_purpose).toBeUndefined();
    expect(defaultVehicleEntryForm().condition.visit_purpose).toBe("workshop");
  });

  it("searches snapshots and related references, and maps every stored status to a translated key", () => {
    const row = { ...entry, entry_number: "ENT-2026-0002", customer_snapshot: { name: "Amal" }, vehicle_snapshot: { plate_number: "90413" }, claim: { claim_number: "C/123" } };
    expect(vehicleEntryMatchesSearch(row, "90413")).toBe(true);
    expect(vehicleEntryMatchesSearch(row, "amal")).toBe(true);
    expect(vehicleEntryMatchesSearch(row, "C/123")).toBe(true);
    expect(vehicleEntryMatchesSearch(row, "NO MATCH")).toBe(false);
    expect(["Draft", "Received", "Issued", "Converted to Claim", "Converted to Work Order", "Cancelled"].every((value) => vehicleEntryStatusKey(value))).toBe(true);
  });

  it("guards stale edit saves and queries custody evidence without modifying legacy data", () => {
    const service = readFileSync(join(process.cwd(), "src/lib/vehicleEntryService.ts"), "utf8");
    const list = readFileSync(join(process.cwd(), "src/pages/vehicle-entry/VehicleEntryList.tsx"), "utf8");
    expect(service).toContain('update.eq("vehicle_location", locationBeforeEdit)');
    expect(service).toContain('update.is("vehicle_location", null)');
    expect(service).toContain('(current.data as any).vehicle_location !== locationBeforeEdit');
    expect(service).toContain("vehicle_delivered_at,delivered_at");
    expect(list).toContain('navigate(`/vehicle-entry/new?purpose=${purpose}`)');
    expect(list).toContain("rowsByPresence.needs_review");
  });
});
