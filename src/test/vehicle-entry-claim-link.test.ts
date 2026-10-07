import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertVehicleEntryClaimLink, type LinkedClaimIdentity, type VehicleEntryClaimIdentity } from "../lib/vehicleEntryClaimLink";

const entry: VehicleEntryClaimIdentity = {
  id: "corolla-entry",
  tenant_id: "workshop-a",
  customer_id: "corolla-owner",
  vehicle_id: "corolla",
  insurance_snapshot: { claim_number: "COROLLA-CLAIM" },
};
const claim: LinkedClaimIdentity = {
  id: "claim-1",
  tenant_id: "workshop-a",
  claim_number: "COROLLA-CLAIM",
  customer_id: "corolla-owner",
  vehicle_id: "corolla",
  vehicle_entry_id: "corolla-entry",
  deleted_at: null,
};

describe("vehicle entry to insurance claim identity", () => {
  it("permits only the same vehicle, owner, tenant and entry", () => {
    expect(() => assertVehicleEntryClaimLink(entry, claim)).not.toThrow();
  });

  it("rejects the production collision: a Corolla entry carrying a Sonata claim number", () => {
    expect(() => assertVehicleEntryClaimLink(entry, {
      ...claim,
      vehicle_id: "sonata",
      vehicle_entry_id: "sonata-entry",
    })).toThrow(/مركبة أخرى/);
  });

  it("rejects a claim already bound to a different entry even for the same vehicle", () => {
    expect(() => assertVehicleEntryClaimLink(entry, { ...claim, vehicle_entry_id: "other-entry" })).toThrow(/نموذج دخول آخر/);
  });

  it("rejects a different customer, tenant, deleted claim or stale number", () => {
    expect(() => assertVehicleEntryClaimLink(entry, { ...claim, customer_id: "other-owner" })).toThrow(/عميل آخر/);
    expect(() => assertVehicleEntryClaimLink(entry, { ...claim, tenant_id: "other-workshop" })).toThrow(/غير متاحة/);
    expect(() => assertVehicleEntryClaimLink(entry, { ...claim, deleted_at: "2026-09-30" })).toThrow(/غير متاحة/);
    expect(() => assertVehicleEntryClaimLink(entry, { ...claim, claim_number: "OLD-NUMBER" })).toThrow(/لا يطابق/);
  });

  it("rejects two conflicting claim IDs already stored on the entry", () => {
    expect(() => assertVehicleEntryClaimLink({ ...entry, insurance_claim_id: "one", converted_claim_id: "two" }, claim)).toThrow(/مطالبتين مختلفتين/);
  });

  it("validates existing claims before linking or navigating and checks persistence", () => {
    const service = readFileSync(join(process.cwd(), "src/lib/vehicleEntryService.ts"), "utf8");
    const conversion = service.slice(service.indexOf("export async function convertVehicleEntryToClaim"), service.indexOf("export const VEHICLE_ENTRY_DECLARATION_AR"));
    expect(conversion.match(/assertVehicleEntryClaimLink/g)).toHaveLength(2);
    expect(conversion.indexOf("assertVehicleEntryClaimLink")).toBeLessThan(conversion.indexOf("return { existing: true"));
    expect(conversion.lastIndexOf("assertVehicleEntryClaimLink")).toBeLessThan(conversion.indexOf(".update({ insurance_claim_id:"));
    expect(conversion).toContain("if (linked.error) throw linked.error");
    expect(conversion).toContain("if (!linked.data) throw");
    expect(conversion).toContain("if (entryLink.error) throw");
    expect(conversion).toContain("if (!entryLink.data) throw");
  });
});
