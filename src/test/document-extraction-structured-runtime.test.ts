import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import { normalizeCandidate, parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { extractPurchaseLineItems } from "@/lib/documentExtraction/lineItems";
import type { DocumentExtractionResult, DocumentPage, DocumentType } from "@/lib/documentExtraction/types";

// Opt-in native OCR benchmark. The only allowed corpus here is generated,
// synthetic, and explicitly not representative of customer documents.
describe.skipIf(process.env.RUN_REAL_OCR !== "1")("structured OCR field benchmark on synthetic documents", () => {
  it("compares parsed values, not just token presence, without auto-applying uncertain OCR IDs", async () => {
    const dataset = resolve(process.env.TEMO_OCR_DATASET || join(tmpdir(), "temo-ocr-golden-synthetic-1"));
    const manifest = JSON.parse(readFileSync(join(dataset, "manifest.json"), "utf8")) as {
      version: string;
      sanitized: boolean;
      representative: boolean;
      cases: Array<{ name: string; expected: Record<string, string> }>;
    };
    expect(manifest.version.startsWith("synthetic-")).toBe(true);
    expect(manifest.sanitized).toBe(true);
    expect(manifest.representative).toBe(false);

    const python = process.env.TEMO_OCR_PYTHON || "python";
    const run = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
      const child = spawn(python, ["services/document-ocr/benchmark.py", dataset, "--emit-pages", "paddleocr"], {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True" },
      });
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (status) => resolveRun({ status, stdout, stderr }));
    });
    expect(run.status, run.stderr).toBe(0);
    const rows = run.stdout.split(/\r?\n/).filter((line) => line.startsWith("TEMO_OCR_PAGE "))
      .map((line) => JSON.parse(line.slice("TEMO_OCR_PAGE ".length)) as { case: string; pages: DocumentPage[] });
    expect(rows).toHaveLength(manifest.cases.length);

    const expectedType = (name: string): DocumentType => name.startsWith("arabic_claim") ? "insurance_claim"
      : name === "vehicle_registration" ? "vehicle_registration"
        : name === "approval_multipage" ? "insurance_approval"
          : name === "parts_table" ? "purchase_invoice" : "supplier_invoice";
    const byName = new Map(manifest.cases.map((item) => [item.name, item]));
    const metrics = rows.map((row) => {
      const expected = byName.get(row.case)!;
      const parsed = parseDocumentPages(row.pages, expectedType(row.case));
      const comparable = Object.entries(expected.expected).filter(([key]) => !key.startsWith("line_"));
      const matchedFields = comparable.filter(([key, raw]) =>
        parsed.fields[key]?.normalizedValue === normalizeCandidate(key, raw).value).map(([key]) => key);
      const lines = row.case === "parts_table" ? extractPurchaseLineItems(row.pages) : null;
      const lineMatches = Object.entries(expected.expected).filter(([key, raw]) => {
        const index = key.match(/^line_(\d+)$/)?.[1];
        return !!index && lines?.fields[`line_item_${index}_name`]?.normalizedValue === raw;
      }).length;
      const selection = defaultReviewSelection({ fields: parsed.fields, status: "needs_review", issues: parsed.issues } as DocumentExtractionResult);
      if (parsed.fields.claim_number?.method === "ocr") expect(selection.claim_number).not.toBe(true);
      if (parsed.fields.plate_number?.method === "ocr") expect(selection.plate_number).not.toBe(true);
      if (parsed.fields.accident_date?.method === "ocr") expect(selection.accident_date).not.toBe(true);
      return { case: row.case, matched: matchedFields.length, fields: comparable.length,
        missed: comparable.map(([key]) => key).filter((key) => !matchedFields.includes(key)),
        lineMatches, lineFields: Object.keys(expected.expected).filter((key) => key.startsWith("line_")).length };
    });
    process.stdout.write(`TEMO_STRUCTURED_OCR_METRICS ${JSON.stringify(metrics)}\n`);
    for (const item of metrics.filter((entry) => entry.case.startsWith("arabic_claim"))) {
      expect(item.matched).toBeGreaterThanOrEqual(3);
    }
    expect(metrics.find((item) => item.case === "parts_table")).toMatchObject({ lineMatches: 2, lineFields: 2 });
  }, 600_000);
});
