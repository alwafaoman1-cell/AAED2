import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatDamageReportNumber,
  getNextDamageReportNumberFromRecords,
  parseDamageReportSequence,
} from "@/lib/inspectionsStore";

describe("inspection damage report numbering", () => {
  it("uses logical DR numbers instead of timestamp suffixes", () => {
    expect(formatDamageReportNumber(1)).toBe("DR-00001");
    expect(formatDamageReportNumber(27)).toBe("DR-00027");
    expect(parseDamageReportSequence("DR-00042")).toBe(42);
    expect(parseDamageReportSequence("DR-749145")).toBeNull();
  });

  it("uses the highest valid five-digit report code, never a legacy timestamp code", () => {
    expect(getNextDamageReportNumberFromRecords([])).toBe("DR-00001");
    expect(getNextDamageReportNumberFromRecords([
      { inspection_code: "DR-749145", inspection_kind: "insurance" },
    ])).toBe("DR-00001");
    expect(getNextDamageReportNumberFromRecords([
      { inspection_code: "DR-00001", inspection_kind: "insurance" },
      { inspection_code: "DR-00002", inspection_kind: "insurance" },
      { inspection_code: "DR-749145", inspection_kind: "insurance" },
    ])).toBe("DR-00003");
    expect(getNextDamageReportNumberFromRecords([
      { inspection_code: "DR-00038", inspection_kind: "insurance" },
      { inspection_code: "DR-749145", inspection_kind: "insurance" },
    ])).toBe("DR-00039");
  });

  it("uses a filtered preview and an atomic cloud save without rewriting old codes", () => {
    const root = process.cwd();
    const store = readFileSync(resolve(root, "src/lib/inspectionsStore.ts"), "utf8");
    const dialog = readFileSync(resolve(root, "src/components/inspection/InsuranceInspectionDialog.tsx"), "utf8");
    const list = readFileSync(resolve(root, "src/pages/Inspection.tsx"), "utf8");
    const migration = readFileSync(resolve(root, "supabase/migrations/20261021060721_atomic_insurance_damage_report_numbering.sql"), "utf8");
    expect(store).toContain('.like("inspection_code", "DR-_____")');
    expect(dialog).toContain("saveInsuranceDamageReport({");
    expect(dialog).not.toContain("findInspectionByPlate(");
    expect(list).toContain("insurance::${i.id}");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("insuranceInspectionReport");
    expect(migration).not.toMatch(/update\s+public\.inspections\s+set\s+inspection_code/i);
  });
});
