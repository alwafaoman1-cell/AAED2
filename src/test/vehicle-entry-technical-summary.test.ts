// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildTechnicalDeclarationConditionSummary, emptyVehicleTechnicalDeclaration,
  type VehicleTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";
import { buildVehicleEntryTechnicalDeclarationSummaryHtml } from "@/lib/vehicleEntryTechnicalDeclarationSummary";

function record(patch: Partial<VehicleTechnicalDeclarationForm> = {}) {
  return { id: "saved-technical-record", form_data: { ...emptyVehicleTechnicalDeclaration, ...patch } };
}

function parse(html: string) { return new DOMParser().parseFromString(html, "text/html"); }

describe("canonical saved declaration intake summary", () => {
  it("requires a saved record and never reads a draft, legacy flags or condition snapshots", () => {
    expect(buildTechnicalDeclarationConditionSummary(null, "en")).toEqual([]);
    expect(buildVehicleEntryTechnicalDeclarationSummaryHtml({}, "en")).toBe("");
    const draft = { form_data: { ...emptyVehicleTechnicalDeclaration, cranking: "yes" } };
    expect(buildVehicleEntryTechnicalDeclarationSummaryHtml({ vehicle_technical_declaration: draft as any }, "en")).toBe("");
    const alternate = {
      technical_declaration: { form: record({ cranking: "yes" }).form_data, revision: null },
      vehicle_condition: { condition_description: "Legacy", engine_running: true },
      condition_snapshot: { cranking: "yes" },
    };
    expect(buildVehicleEntryTechnicalDeclarationSummaryHtml(alternate as any, "en")).toBe("");
  });

  it("does not infer negative findings from blank choices and default false boxes", () => {
    expect(buildTechnicalDeclarationConditionSummary(record(), "en")).toEqual([]);
    const html = buildVehicleEntryTechnicalDeclarationSummaryHtml({ vehicle_technical_declaration: record() }, "en");
    expect(parse(html).body.textContent).toContain("No inspection answers recorded");
    expect(html).not.toContain("Chassis damage LH");
    expect(html).not.toContain("Cranking:");
  });

  it("summarizes all selected condition sections from form_data, excluding identity/signature", () => {
    const saved = record({
      claim_number: "IDENTITY-NOT-A-FINDING", authorized_person: "SIGNER-NOT-A-FINDING", signature_data_url: "SIGNATURE-NOT-A-FINDING",
      non_gcc_vehicle: "no", towing: "yes", cranking: "yes", engine_oil_level: "no", radiator_coolant: "no",
      gear_body_crack: "no", gear_oil_leak: "yes", gear_other_remarks: "Gear note",
      previous_improper_repairs: "yes", previous_improper_details: "Old repairs",
      airbag_warning: "yes", engine_warning: "no", atm_warning: "no", warning_other: "Lamp note",
      chassis_status: "deformed", chassis_damage_lh: true, chassis_replace_rh: true, chassis_notes: "Chassis note",
      floor_deformation: "yes", body_deformation: "no", body_floor_details: "Body note",
      accessories_modification: "yes", ppe: "no", accessories_details: "Accessory note", other_observations: "Checked at intake",
    });
    const before = JSON.stringify(saved);
    const groups = buildTechnicalDeclarationConditionSummary(saved, "en");
    expect(groups).toHaveLength(9);
    const items = groups.flatMap((group) => group.items);
    expect(items.find((item) => item.key === "engine_oil_level")?.value).toBe("No");
    expect(items.find((item) => item.key === "chassis_status")?.value).toBe("Deformed");
    expect(items.find((item) => item.key === "gear_oil_leak")?.value).toBe("Yes");
    expect(items.find((item) => item.key === "chassis_damage_rh")).toBeUndefined();
    const html = buildVehicleEntryTechnicalDeclarationSummaryHtml({ vehicle_technical_declaration: saved }, "en");
    const doc = parse(html);
    expect(doc.querySelector("table.technical-condition-summary")?.getAttribute("data-technical-declaration-id")).toBe(saved.id);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(doc.querySelectorAll("thead th")).toHaveLength(1);
    for (const content of ["Old repairs", "Gear note", "Lamp note", "Chassis note", "Body note", "Accessory note", "Checked at intake"]) {
      expect(doc.body.textContent).toContain(content);
    }
    expect(html).not.toContain("NOT-A-FINDING");
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("escapes free text and ids and preserves line breaks without clipping content", () => {
    const saved = { ...record({ other_observations: '<img src=x onerror="alert(1)">\nSecond line' }), id: '"><script>alert(1)</script>' };
    const html = buildVehicleEntryTechnicalDeclarationSummaryHtml({ vehicle_technical_declaration: saved }, "en");
    const doc = parse(html);
    expect(doc.querySelectorAll("script,img")).toHaveLength(0);
    expect(doc.body.textContent).toContain('<img src=x onerror="alert(1)">\nSecond line');
    expect(doc.querySelector("table")?.getAttribute("data-technical-declaration-id")).toBe(saved.id);
    expect(html).toContain("white-space:pre-wrap");
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
      expect(element.style.height).toBe("");
      expect(element.style.maxHeight).toBe("");
      expect(element.style.overflow).not.toBe("hidden");
    }
  });

  it("uses Arabic-first RTL labels and Arabic answers in Arabic mode", () => {
    const saved = record({ cranking: "no", engine_oil_level: "ok", chassis_status: "deformed", chassis_damage_lh: true });
    const html = buildVehicleEntryTechnicalDeclarationSummaryHtml({ vehicle_technical_declaration: saved }, "ar");
    const doc = parse(html);
    expect(doc.querySelector("table")?.getAttribute("dir")).toBe("rtl");
    expect(doc.body.textContent).toContain("ملخص حالة المركبة");
    expect(doc.body.textContent).toContain("يدور المحرك: لا");
    expect(doc.body.textContent).toContain("مستوى زيت المحرك: سليم");
    expect(doc.body.textContent).toContain("حالة الشاصي: متشوه");
    expect(doc.body.textContent).not.toMatch(/Cranking|Deformed|Yes/);
  });
});
