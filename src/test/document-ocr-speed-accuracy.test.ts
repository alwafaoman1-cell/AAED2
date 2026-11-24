import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCandidate, parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import type { DocumentExtractionResult, DocumentPage, DocumentType } from "@/lib/documentExtraction/types";

interface Fixture {
  name: string;
  expectedType: DocumentType;
  expected: Record<string, string>;
  expectedMethods?: Array<"ocr" | "native_pdf">;
  sha256: string;
}
interface CaseResult {
  name: string;
  run: string | number;
  pages: DocumentPage[];
  wall_ms: number;
  sha256?: string;
}
interface BenchmarkArtifact { complete: boolean; runs: number; cases: CaseResult[] }
const enabled = process.env.RUN_OCR_SPEED_COMPARE === "1";
const directory = resolve(process.env.TEMO_OCR_SPEED_ARTIFACT_DIR || "output/ocr-speed-development-2026-11-24");
const critical = new Set(["claim_number", "plate_number", "plate_letters", "vin"]);

describe.skipIf(!enabled)("same-document Development OCR speed and identifier accuracy", () => {
  it("compares exact parser values and keeps baseline ground-truth misses visible without logging identifiers", async () => {
    const manifest = JSON.parse(await readFile(join(directory, "dataset/manifest.json"), "utf8")) as {
      sanitized: boolean; representative: boolean; version: string; cases: Fixture[];
    };
    expect(manifest.sanitized).toBe(true);
    expect(manifest.representative).toBe(false);
    expect(manifest.version.startsWith("synthetic-claim-speed-")).toBe(true);
    const before = JSON.parse(await readFile(join(directory, "before.json"), "utf8")) as BenchmarkArtifact;
    const after = JSON.parse(await readFile(join(directory, "after.json"), "utf8")) as BenchmarkArtifact;
    expect(before.complete && after.complete, "Both real OCR runs must finish before comparison").toBe(true);
    expect(Number.isInteger(before.runs) && before.runs >= 2, "At least two measured runs are required").toBe(true);
    expect(after.runs).toBe(before.runs);
    expect(before.cases.length).toBe(manifest.cases.length * before.runs);
    expect(after.cases.length).toBe(manifest.cases.length * after.runs);
    const fixtures = new Map(manifest.cases.map(item => [item.name, item]));
    const key = (row: CaseResult) => `${row.name}:${String(row.run)}`;
    const previous = new Map(before.cases.map(row => [key(row), row]));
    expect(previous.size, "Duplicate baseline case/run keys").toBe(before.cases.length);
    expect(new Set(after.cases.map(key)).size, "Duplicate candidate case/run keys").toBe(after.cases.length);
    expect(after.cases.map(key).sort(), "Both versions must process the same cases and runs").toEqual([...previous.keys()].sort());
    expect(after.cases.length).toBeGreaterThan(0);
    const comparisons: Array<{
      case: string; run: string | number; total: number; beforeCorrect: number; afterCorrect: number;
      beforeWallMs: number; afterWallMs: number;
      fields: Record<string, { beforeExact: boolean; afterExact: boolean; unchanged: boolean }>;
      methodsPreserved: boolean;
    }> = [];
    const absent: Array<{ case: string; run: string | number; field: string; beforeUnexpected: boolean; afterUnexpected: boolean; unchanged: boolean }> = [];
    for (const candidate of after.cases) {
      const baseline = previous.get(key(candidate))!;
      const fixture = fixtures.get(candidate.name);
      expect(!!fixture, "Every benchmark row must belong to the verified synthetic manifest").toBe(true);
      if (!fixture) continue;
      if (baseline.sha256) expect(baseline.sha256 === fixture.sha256, "Baseline fixture bytes changed").toBe(true);
      if (candidate.sha256) expect(candidate.sha256 === fixture.sha256, "Candidate fixture bytes changed").toBe(true);
      expect(Number.isFinite(baseline.wall_ms) && baseline.wall_ms >= 0).toBe(true);
      expect(Number.isFinite(candidate.wall_ms) && candidate.wall_ms >= 0).toBe(true);
      const baselineParsed = parseDocumentPages(baseline.pages, fixture.expectedType);
      const candidateParsed = parseDocumentPages(candidate.pages, fixture.expectedType);
      const baselineFields = baselineParsed.fields;
      const candidateFields = candidateParsed.fields;
      const selection = (parsed: typeof baselineParsed) => defaultReviewSelection({ status: "needs_review", fields: parsed.fields, issues: parsed.issues } as DocumentExtractionResult);
      const baselineSelected = selection(baselineParsed), candidateSelected = selection(candidateParsed);
      const fields: Record<string, { beforeExact: boolean; afterExact: boolean; unchanged: boolean }> = {};
      for (const [field, truth] of Object.entries(fixture.expected)) {
        expect(critical.has(field), "Fixture expected map contains only critical identifiers").toBe(true);
        const canonical = normalizeCandidate(field, truth).value;
        const oldValue = baselineFields[field]?.normalizedValue ?? null;
        const newValue = candidateFields[field]?.normalizedValue ?? null;
        fields[field] = { beforeExact: oldValue === canonical, afterExact: newValue === canonical, unchanged: oldValue === newValue };
        expect(candidateFields[field]?.validation === baselineFields[field]?.validation, `Validation changed for ${fixture.name}/${field}`).toBe(true);
        expect(candidateSelected[field] === baselineSelected[field], `Review selection changed for ${fixture.name}/${field}`).toBe(true);
      }
      for (const field of critical) {
        if (field in fixture.expected) continue;
        const oldValue = baselineFields[field]?.normalizedValue ?? null;
        const newValue = candidateFields[field]?.normalizedValue ?? null;
        absent.push({ case: fixture.name, run: candidate.run, field,
          beforeUnexpected: !!oldValue, afterUnexpected: !!newValue, unchanged: oldValue === newValue });
      }
      const expectedMethods = fixture.expectedMethods;
      const methodsPreserved = JSON.stringify(baseline.pages.map(page => page.method)) === JSON.stringify(candidate.pages.map(page => page.method)) &&
        (!expectedMethods || JSON.stringify(candidate.pages.map(page => page.method)) === JSON.stringify(expectedMethods));
      comparisons.push({
        case: fixture.name, run: candidate.run, total: Object.keys(fields).length,
        beforeCorrect: Object.values(fields).filter(field => field.beforeExact).length,
        afterCorrect: Object.values(fields).filter(field => field.afterExact).length,
        beforeWallMs: baseline.wall_ms, afterWallMs: candidate.wall_ms, fields, methodsPreserved,
      });
    }
    const rows = comparisons.flatMap(item => Object.entries(item.fields).map(([field, result]) => ({ case: item.case, run: item.run, field, ...result })));
    const report = {
      synthetic: true, representative: false, source: "Actual OCR pages passed through the current application parser",
      exactTruthRequired: process.env.TEMO_OCR_SPEED_REQUIRE_EXACT === "1",
      cases: comparisons.length,
      uniqueCases: new Set(comparisons.map(item => item.case)).size,
      manifestCases: manifest.cases.length,
      notBenchmarked: manifest.cases.filter(item => !comparisons.some(comparison => comparison.case === item.name)).map(item => item.name),
      fields: rows.length,
      beforeCorrect: rows.filter(item => item.beforeExact).length,
      afterCorrect: rows.filter(item => item.afterExact).length,
      unchanged: rows.filter(item => item.unchanged).length,
      regressions: rows.filter(item => item.beforeExact && !item.afterExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      baselineMisses: rows.filter(item => !item.beforeExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      candidateMisses: rows.filter(item => !item.afterExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      absenceComparisons: absent.length,
      unexpectedBaseline: absent.filter(item => item.beforeUnexpected).map(({ case: name, run, field }) => ({ case: name, run, field })),
      unexpectedCandidate: absent.filter(item => item.afterUnexpected).map(({ case: name, run, field }) => ({ case: name, run, field })),
      comparisons,
      note: "Existing baseline misses remain failures against ground truth. The default comparison gate protects identical critical-field values; it does not label an unchanged incorrect value as correct.",
    };
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "accuracy.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`TEMO_OCR_SPEED_ACCURACY ${JSON.stringify({ cases: report.cases, fields: report.fields, beforeCorrect: report.beforeCorrect, afterCorrect: report.afterCorrect, unchanged: report.unchanged, regressions: report.regressions.length })}\n`);
    // Only booleans/counts/field names reach errors; never print OCR text or IDs.
    for (const row of rows) {
      expect(row.unchanged, `Critical value changed for ${row.case}/${row.run}/${row.field}`).toBe(true);
      expect(row.beforeExact && !row.afterExact, `Exact-match regression for ${row.case}/${row.run}/${row.field}`).toBe(false);
      if (report.exactTruthRequired) expect(row.afterExact, `Ground-truth miss for ${row.case}/${row.run}/${row.field}`).toBe(true);
    }
    for (const comparison of comparisons) expect(comparison.methodsPreserved, `PDF method changed for ${comparison.case}/${comparison.run}`).toBe(true);
    for (const field of absent) {
      expect(field.unchanged, `Unprinted identifier changed for ${field.case}/${field.run}/${field.field}`).toBe(true);
      if (report.exactTruthRequired) expect(field.afterUnexpected, `Unexpected identifier for ${field.case}/${field.run}/${field.field}`).toBe(false);
    }
  });
});
