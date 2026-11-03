import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildVehicleTechnicalDeclarationHtml, emptyVehicleTechnicalDeclaration,
  initialTechnicalDeclarationForm, normalizeTechnicalDeclarationForm,
  validateTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";

describe("vehicle technical declaration", () => {
  it("prefills only known entry identity; inspection answers stay unselected", () => {
    const form = initialTechnicalDeclarationForm({
      claim: { claim_number: "C/123" },
      vehicle: { brand: "Toyota", model: "Corolla", plate_letters: "AB", plate_number: "1234" },
    });
    expect(form.claim_number).toBe("C/123");
    expect(form.registration_number).toBe("AB 1234");
    expect(form.make_model).toBe("Toyota Corolla");
    expect(form.cranking).toBe("");
    expect(form.non_gcc_vehicle).toBe("");
    expect(form.chassis_damage_lh).toBe(false);
    expect(form.date).toBe("");
  });

  it("retains exactly one English A4 sheet with source wording and blank signature/stamp", () => {
    const html = buildVehicleTechnicalDeclarationHtml(emptyVehicleTechnicalDeclaration);
    expect(html).toContain("@page{size:A4 portrait;margin:0}");
    expect(html).toContain("width:210mm;height:297mm");
    expect(html).toContain('lang="en" dir="ltr"');
    for (const wording of [
      "VEHICLE TECHNICAL DECLARATION", "Claim Number:", "Registration Number:",
      "Non GCC Vehicle:", "Towing :", "1. Engine Status:", "2. Gear Box Status",
      "Any Body crack Observed", "3. Previous Improper Repairs Observed:",
      "4.Dash board warning lamp", "ATM warning", "5. Chassis Status Observation:",
      "Chassis recommend replace", "6. Body&amp;Floor Deformation Observed:",
      "7. Any extra accessories/Modification:", "PPE:",
      "8. Other Observations and Remarks:", "Garage Name", "Authorized Person",
      "Signature", "Date:", "Stamp",
    ]) expect(html).toContain(wording);
    expect(html.match(/class="page"/g)).toHaveLength(1);
  });

  it("renders checked answers and escapes untrusted free text", () => {
    const html = buildVehicleTechnicalDeclarationHtml({
      ...emptyVehicleTechnicalDeclaration,
      cranking: "yes", engine_oil_level: "no", chassis_status: "deformed",
      chassis_damage_lh: true, claim_number: '<img src=x onerror="alert(1)">',
    });
    expect(html).toContain("Cranking: &nbsp;&nbsp;&nbsp; Yes [X] / No [ ]");
    expect(html).toContain("Engine Oil Level: OK [ ] / No [X]");
    expect(html).toContain("Chassis Status: OK [ ] / Deformed [X]");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });

  it("rejects invalid choices and overlong text instead of silently truncating", () => {
    expect(() => validateTechnicalDeclarationForm({
      ...emptyVehicleTechnicalDeclaration, cranking: "maybe" as any,
    })).toThrow();
    expect(() => validateTechnicalDeclarationForm({
      ...emptyVehicleTechnicalDeclaration, other_observations: "x".repeat(241),
    })).toThrow();
    expect(normalizeTechnicalDeclarationForm({ claim_number: "C/7" }).engine_warning).toBe("");
  });

  it("keeps one per entry with tenant RLS and revision-checked updates", () => {
    const migration = readFileSync("supabase/migrations/20261103134111_vehicle_technical_declaration.sql", "utf8");
    const service = readFileSync("src/lib/vehicleTechnicalDeclaration.ts", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(migration).toContain("vehicle_entry_id uuid not null unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("tenant_id = (select public.get_user_tenant_id())");
    expect(migration).toContain("grant update (form_data)");
    expect(migration).not.toContain("grant delete");
    expect(service).toContain('.eq("revision", expectedRevision)');
    expect(service).toContain("const confirmed = await getVehicleTechnicalDeclaration(entryId)");
    expect(app).toContain('path="/vehicle-entry/:id/technical-declaration"');
  });
});
