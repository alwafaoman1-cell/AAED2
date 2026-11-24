import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCandidate, parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { parseEnglishDocumentPages } from "@/lib/documentExtraction/englishOnly";
import { buildAutofillPayload, defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import type { DocumentExtractionResult, DocumentPage, DocumentType } from "@/lib/documentExtraction/types";

interface Fixture {
  name: string;
  expectedType: DocumentType;
  expected: Record<string, string>;
  expectedMethods?: Array<"ocr" | "native_pdf">;
  expectedNoFields?: boolean;
  sha256: string;
}
interface Manifest { sanitized: boolean; representative: boolean; version: string; cases: Fixture[] }
interface CaseResult {
  name: string;
  run: number | string;
  pages: DocumentPage[];
  wall_ms: number;
  sha256: string;
}
interface Artifact { complete: boolean; runs: number; cases: CaseResult[] }
const directory = resolve(process.env.TEMO_ENGLISH_OCR_ARTIFACT_DIR || "output/ocr-english-development-2026-11-24");
const arabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const critical = ["claim_number", "plate_number", "plate_letters", "vin"] as const;
const load = async <T,>(name: string): Promise<T> => JSON.parse(await readFile(join(directory, name), "utf8")) as T;
const key = (row: CaseResult) => `${row.name}:${String(row.run)}`;
const outcome = (parsed: ReturnType<typeof parseEnglishDocumentPages>) => ({ status: "needs_review", fields: parsed.fields, issues: parsed.issues } as DocumentExtractionResult);

function validateManifest(manifest: Manifest, prefix: string) {
  expect(manifest.sanitized).toBe(true);
  expect(manifest.representative).toBe(false);
  expect(manifest.version.startsWith(prefix)).toBe(true);
  expect(new Set(manifest.cases.map(row => row.name)).size).toBe(manifest.cases.length);
}
function containsArabicEvidence(row: CaseResult) {
  return row.pages.some(page => arabic.test(page.text) || page.segments?.some(segment => arabic.test(segment.text)));
}

describe.skipIf(process.env.RUN_ENGLISH_OCR_COMPARE !== "1")("English-only real OCR exact identifiers and latency", () => {
  it("compares the same generated English files without hiding baseline misses or new false positives", async () => {
    const manifest = await load<Manifest>("dataset/manifest.json");
    validateManifest(manifest, "synthetic-english-claim-speed-");
    const before = await load<Artifact>("before.json"), after = await load<Artifact>("after.json");
    expect(before.complete && after.complete, "Both real benchmark runs must finish").toBe(true);
    expect(Number.isInteger(before.runs) && before.runs >= 2).toBe(true);
    expect(after.runs).toBe(before.runs);
    expect(before.cases.length).toBe(manifest.cases.length * before.runs);
    expect(after.cases.length).toBe(manifest.cases.length * after.runs);
    const oldRows = new Map(before.cases.map(row => [key(row), row]));
    expect(oldRows.size).toBe(before.cases.length);
    expect(new Set(after.cases.map(key)).size).toBe(after.cases.length);
    expect(after.cases.map(key).sort()).toEqual([...oldRows.keys()].sort());
    const comparisons: Array<{
      case: string; run: number | string; fields: Record<string, { beforeExact: boolean; afterExact: boolean }>;
      beforeWallMs: number; afterWallMs: number; methodsPreserved: boolean; arabicEvidence: boolean; arabicFields: boolean;
      unexpectedFields: string[]; selectedOcrIdentifiers: string[];
    }> = [];
    for (const row of after.cases) {
      const previous = oldRows.get(key(row))!;
      const fixture = manifest.cases.find(item => item.name === row.name);
      expect(!!fixture, "Every result must have verified synthetic ground truth").toBe(true);
      if (!fixture) continue;
      expect(previous.sha256 === fixture.sha256 && row.sha256 === fixture.sha256, "The bytes changed between versions").toBe(true);
      expect(Number.isFinite(previous.wall_ms) && previous.wall_ms >= 0).toBe(true);
      expect(Number.isFinite(row.wall_ms) && row.wall_ms >= 0).toBe(true);
      const oldParsed = parseDocumentPages(previous.pages, fixture.expectedType);
      const parsed = parseEnglishDocumentPages(row.pages, fixture.expectedType);
      const selected = defaultReviewSelection(outcome(parsed));
      const fields: Record<string, { beforeExact: boolean; afterExact: boolean }> = {};
      for (const [name, truth] of Object.entries(fixture.expected)) {
        expect(critical.includes(name as typeof critical[number])).toBe(true);
        const canonical = normalizeCandidate(name, truth).value;
        fields[name] = { beforeExact: oldParsed.fields[name]?.normalizedValue === canonical,
          afterExact: parsed.fields[name]?.normalizedValue === canonical };
      }
      comparisons.push({ case: row.name, run: row.run, fields,
        beforeWallMs: previous.wall_ms, afterWallMs: row.wall_ms,
        methodsPreserved: JSON.stringify(previous.pages.map(page => page.method)) === JSON.stringify(row.pages.map(page => page.method)) &&
          (!fixture.expectedMethods || JSON.stringify(row.pages.map(page => page.method)) === JSON.stringify(fixture.expectedMethods)),
        arabicEvidence: containsArabicEvidence(row),
        arabicFields: Object.values(parsed.fields).some(field => arabic.test(field.rawValue) || arabic.test(field.normalizedValue)),
        unexpectedFields: critical.filter(name => !(name in fixture.expected) && !!parsed.fields[name]?.normalizedValue),
        selectedOcrIdentifiers: critical.filter(name => parsed.fields[name]?.method === "ocr" && selected[name]),
      });
    }
    const fields = comparisons.flatMap(row => Object.entries(row.fields).map(([field, value]) => ({ case: row.case, run: row.run, field, ...value })));
    const report = {
      synthetic: true, representative: false, source: "Real worker OCR pages and the actual English-only application parser",
      cases: comparisons.length, uniqueCases: new Set(comparisons.map(row => row.case)).size,
      fields: fields.length, beforeCorrect: fields.filter(field => field.beforeExact).length,
      afterCorrect: fields.filter(field => field.afterExact).length,
      regressions: fields.filter(field => field.beforeExact && !field.afterExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      baselineMisses: fields.filter(field => !field.beforeExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      candidateMisses: fields.filter(field => !field.afterExact).map(({ case: name, run, field }) => ({ case: name, run, field })),
      comparisons,
    };
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "accuracy.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`TEMO_ENGLISH_OCR_ACCURACY ${JSON.stringify({ cases: report.cases, fields: report.fields, beforeCorrect: report.beforeCorrect, afterCorrect: report.afterCorrect, regressions: report.regressions.length })}\n`);
    // Assertions disclose field keys and booleans only, never OCR text or values.
    for (const field of fields) {
      expect(field.beforeExact && !field.afterExact, `Regression for ${field.case}/${field.run}/${field.field}`).toBe(false);
      if (process.env.TEMO_ENGLISH_OCR_REQUIRE_EXACT === "1") expect(field.afterExact, `Reference mismatch for ${field.case}/${field.run}/${field.field}`).toBe(true);
    }
    for (const row of comparisons) {
      expect(row.arabicEvidence, `Arabic evidence remains in ${row.case}/${row.run}`).toBe(false);
      expect(row.arabicFields, `Arabic field remains in ${row.case}/${row.run}`).toBe(false);
      expect(row.methodsPreserved, `Native/scanned method changed for ${row.case}/${row.run}`).toBe(true);
      expect(row.unexpectedFields, `Unexpected identifier for ${row.case}/${row.run}`).toEqual([]);
      expect(row.selectedOcrIdentifiers, `OCR identifiers were auto-selected for ${row.case}/${row.run}`).toEqual([]);
    }
  });
});

describe.skipIf(process.env.RUN_ENGLISH_OCR_NEGATIVES !== "1")("English-only negative document real OCR", () => {
  it("does not extract or autofill Arabic-only documents even when Latin identifiers are printed", async () => {
    const manifest = await load<Manifest>("dataset/negative/manifest.json");
    validateManifest(manifest, "synthetic-english-negative-");
    const result = await load<Artifact>("negatives.json");
    expect(result.complete).toBe(true);
    expect(Number.isInteger(result.runs) && result.runs >= 1).toBe(true);
    expect(result.cases.length).toBe(manifest.cases.length * result.runs);
    expect(new Set(result.cases.map(key)).size).toBe(result.cases.length);
    const cases: Array<{ case: string; run: number | string; fields: string[]; autofillFields: string[]; arabicEvidence: boolean }> = [];
    for (const row of result.cases) {
      const fixture = manifest.cases.find(item => item.name === row.name);
      expect(!!fixture).toBe(true);
      if (!fixture) continue;
      expect(fixture.expectedNoFields).toBe(true);
      expect(row.sha256 === fixture.sha256).toBe(true);
      const parsed = parseEnglishDocumentPages(row.pages, fixture.expectedType);
      const reviewed = Object.fromEntries(Object.entries(parsed.fields).map(([name, field]) => [name, field.normalizedValue]));
      cases.push({ case: row.name, run: row.run, fields: Object.keys(parsed.fields),
        autofillFields: Object.keys(buildAutofillPayload(outcome(parsed), "insurance_claim", reviewed)),
        arabicEvidence: containsArabicEvidence(row) });
    }
    await writeFile(join(directory, "negative-accuracy.json"), JSON.stringify({ synthetic: true, representative: false, cases }, null, 2));
    for (const row of cases) {
      expect(row.fields, `Arabic-only extraction in ${row.case}/${row.run}`).toEqual([]);
      expect(row.autofillFields, `Arabic-only autofill in ${row.case}/${row.run}`).toEqual([]);
      expect(row.arabicEvidence, `Arabic evidence remains in ${row.case}/${row.run}`).toBe(false);
    }
  });
});
