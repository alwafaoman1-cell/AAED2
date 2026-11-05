import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildVehicleTechnicalDeclarationHtml, emptyVehicleTechnicalDeclaration,
  initialTechnicalDeclarationForm, normalizeTechnicalDeclarationForm,
  TECHNICAL_GARAGE_NAME, validateTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";

describe("vehicle technical declaration", () => {
  it("uses the available signer column for the complete report author without shrinking or truncating it", () => {
    const name = "TEMO Document Preview Tester";
    const html = buildVehicleTechnicalDeclarationHtml({...emptyVehicleTechnicalDeclaration, authorized_person:name});
    expect(html).toContain(name);
    expect(html).toContain(".footer-row .write-line{width:100%;min-width:0}");
    expect(html).not.toContain(".footer-row .write-line{width:58mm}");
  });
  it("keeps the official form's preview text baselines in the raster download", () => {
    const source = readFileSync(new URL("../lib/vehicleTechnicalDeclarationPdf.ts", import.meta.url), "utf8");
    expect(source).toContain("foreignObjectRendering: true");
    expect(source).toContain("clonedPage.prepend(embeddedFontStyle.cloneNode(true))");
    expect(source).toContain("clonedDoc.fonts.load");
    expect(source).not.toMatch(/translateY|top:\s*-\d|marginTop:\s*-/);
  });
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

  it("retains exactly one A4 sheet without a workshop stamp", () => {
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
      "Signature", "Date:",
    ]) expect(html).toContain(wording);
    expect(html.match(/class="page"/g)).toHaveLength(1);
    expect(html).toContain(TECHNICAL_GARAGE_NAME);
    expect(html).not.toContain("<strong>Stamp</strong>");
    expect(html).toContain(".vehicle-data{color:#b42318");
    expect(html).toContain(".tick{color:#14532d");
  });

  it("renders checked answers and escapes untrusted free text", () => {
    const html = buildVehicleTechnicalDeclarationHtml({
      ...emptyVehicleTechnicalDeclaration,
      cranking: "yes", engine_oil_level: "no", chassis_status: "deformed",
      chassis_damage_lh: true, claim_number: '<img src=x onerror="alert(1)">',
    });
    const tick = '[<span class="tick" role="img" aria-label="Checked"><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8L6 12L14 3" fill="none" stroke="#14532d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>]';
    expect(html).toContain(`Cranking: &nbsp;&nbsp;&nbsp; Yes ${tick} / No [ ]`);
    expect(html).toContain(`Engine Oil Level: OK [ ] / No ${tick}`);
    expect(html).toContain(`Chassis Status: OK [ ] / Deformed ${tick}`);
    expect(html).not.toContain("[X]");
    expect(html).toContain('data:font/woff;base64,');
    expect(html).toContain('font-family:TemoTechnicalArabic,serif');
    // The rasterizer serializes .page, not the document head. The embedded
    // Arabic font must travel inside that same preview/export root.
    expect(html.indexOf('data-technical-font="embedded"')).toBeGreaterThan(html.indexOf('<div class="page">'));
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
    expect(normalizeTechnicalDeclarationForm({ garage_name: "Old Garage" }).garage_name).toBe(TECHNICAL_GARAGE_NAME);
  });

  it("fills the signer from report inputs and never fabricates a signature", () => {
    const form = initialTechnicalDeclarationForm({}, "Report Creator");
    expect(form.authorized_person).toBe("Report Creator");
    expect(form.signer_role).toBe("report_author");
    expect(form.signature_data_url).toBe("");
    const signed = { ...form, signature_data_url: "data:image/png;base64,aGVsbG8=" };
    expect(() => validateTechnicalDeclarationForm(signed)).not.toThrow();
    const html = buildVehicleTechnicalDeclarationHtml(signed);
    expect(html).toContain("Report Creator");
    expect(html).toContain("Report Author");
    expect(html).toContain('<img src="data:image/png;base64,aGVsbG8="');
    expect(() => validateTechnicalDeclarationForm({ ...form, signature_data_url: "javascript:alert(1)" })).toThrow("Invalid signature image");
    expect(() => validateTechnicalDeclarationForm({ ...signed, signer_role: "" })).toThrow();
    expect(() => validateTechnicalDeclarationForm({ ...form, signature_data_url: "data:image/png;base64," + "a".repeat(9000) })).toThrow();
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
