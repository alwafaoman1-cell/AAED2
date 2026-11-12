import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");
const attachment = source.slice(source.indexOf("const applyInspection ="), source.indexOf("const openNewInspection ="));
const picker = source.slice(source.indexOf("function InspectionPickerDialog("), source.indexOf("// ── Payments Section"));

describe("claim inspection attachment summary/detail compatibility", () => {
  it("hydrates an explicitly selected summary before attaching the full report", () => {
    expect(attachment).toContain("async (summary: InspectionRecord)");
    expect(attachment).toContain("await inspectionsStore.loadById(summary.id)");
    expect(attachment).toContain("if (!ins) throw new Error");
    expect(attachment).toContain("setLinkedInspection(attached)");
    expect(attachment.indexOf("await inspectionsStore.loadById(summary.id)"))
      .toBeLessThan(attachment.indexOf("setLinkedInspection(attached)"));
    expect(attachment).not.toContain("setLinkedInspection(summary)");
  });

  it("awaits missing legacy insurance data and embeds it for the synchronous claim-PDF consumer", () => {
    expect(attachment).toContain('ins.kind === "insurance" && !ins.details?.insuranceInspectionReport');
    expect(attachment).toContain("await insuranceInspectionStore.load(ins.id)");
    expect(attachment).toContain("details: { ...ins.details, insuranceInspectionReport: legacyReport }");
    expect(source).toContain("ins?.details?.insuranceInspectionReport || (ins ? insuranceInspectionStore.get(ins.id) : null)");
    expect(source).toContain("buildInsuranceInspectionHtml(payload)");
  });

  it("retains the picker on read failure and only closes after attachment succeeds", () => {
    expect(attachment).toContain("catch (error");
    expect(attachment).toContain("toast.error");
    expect(attachment).toContain("return false");
    expect(source).toContain("if (await applyInspection(ins)) setShowInspectionPicker(false)");
    expect(picker).toContain("await onPick(ins)");
    expect(picker).toContain("disabled={pickingId !== null}");
    expect(picker).toContain("aria-busy={pickingId === ins.id}");
  });

  it("guards late route/cancelled selections and uses the same hydration for post-create attachment", () => {
    expect(attachment).toContain("const request = ++inspectionLinkRequest.current");
    expect(attachment).toContain("if (request !== inspectionLinkRequest.current) return false");
    expect(attachment.indexOf("if (request !== inspectionLinkRequest.current) return false"))
      .toBeLessThan(attachment.indexOf("setLinkedInspection(attached)"));
    expect(source).toContain("return () => { inspectionLinkRequest.current += 1; }");
    expect(source).toContain("if (!open) inspectionLinkRequest.current += 1");
    expect(source).toContain("if (created) void applyInspection(created)");
  });

  it("does not hydrate report details during picker listing or search", () => {
    expect(picker).toContain("inspectionsStore.getAll()");
    expect(picker).not.toContain("loadById");
    expect(picker).not.toContain("insuranceInspectionStore.load");
    expect(picker).toContain("onClick={async () =>");
  });
});
