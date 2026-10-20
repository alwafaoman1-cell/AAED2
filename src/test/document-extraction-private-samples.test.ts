import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { normalizeCandidate, parseDocumentPages } from "@/lib/documentExtraction/parsers";
import { defaultReviewSelection } from "@/lib/documentExtraction/autofill";
import type { DocumentExtractionResult, DocumentPage, DocumentType } from "@/lib/documentExtraction/types";

interface PrivateSample {
  path: string;
  expectedType: DocumentType;
  expected: Record<string, string>;
  warningFields?: string[];
}

// Opt-in only: representative customer files and ground truth stay outside Git.
// Pass TEMO_PRIVATE_OCR_SAMPLES as JSON at runtime; never print values or pages.
describe.skipIf(process.env.RUN_PRIVATE_OCR_SAMPLES !== "1")("private insurer document OCR", () => {
  it("compares Worker OCR -> browser parser -> review field selection on the same files", async () => {
    const samples = JSON.parse(process.env.TEMO_PRIVATE_OCR_SAMPLES || "[]") as PrivateSample[];
    expect(samples.length).toBeGreaterThan(0);
    const script = `
import json, pathlib, sys
sys.path.insert(0, "services/document-ocr")
from ocr_core import PaddleProvider, process_document
provider = PaddleProvider()
for index, name in enumerate(sys.argv[1:]):
    path = pathlib.Path(name)
    result = process_document(path.read_bytes(), path.name,
        "application/pdf" if path.suffix.lower() == ".pdf" else "image/jpeg", provider)
    print("TEMO_PRIVATE_PAGE " + json.dumps({"index": index, "pages": result["pages"],
        "duration_ms": result["duration_ms"]}, ensure_ascii=False), flush=True)
`;
    const python = process.env.TEMO_OCR_PYTHON || "python";
    const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(python, ["-u", "-c", script, ...samples.map((sample) => sample.path)], {
        cwd: process.cwd(), env: { ...process.env, PYTHONIOENCODING: "utf-8", PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True" },
      });
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(output.code, output.stderr.slice(0, 1000)).toBe(0);
    const rows = output.stdout.split(/\r?\n/).filter((line) => line.startsWith("TEMO_PRIVATE_PAGE "))
      .map((line) => JSON.parse(line.slice("TEMO_PRIVATE_PAGE ".length)) as {
        index: number; pages: DocumentPage[]; duration_ms: number;
      });
    expect(rows.length).toBe(samples.length);
    const metrics: Array<{ sample: number; correct: number; total: number; missed: string[]; duration_ms: number }> = [];
    for (const row of rows) {
      const sample = samples[row.index];
      const parsed = parseDocumentPages(row.pages, sample.expectedType);
      const matches = Object.entries(sample.expected).filter(([key, expected]) =>
        parsed.fields[key]?.normalizedValue === normalizeCandidate(key, expected).value);
      const missed = Object.keys(sample.expected).filter((key) => !matches.some(([matched]) => matched === key));
      metrics.push({ sample: row.index + 1, correct: matches.length, total: Object.keys(sample.expected).length,
        missed, duration_ms: row.duration_ms });
      for (const key of sample.warningFields || []) expect(parsed.fields[key]?.validation, key).toBe("warning");
      const selected = defaultReviewSelection({ status: "needs_review", fields: parsed.fields, issues: parsed.issues } as DocumentExtractionResult);
      for (const key of ["claim_number", "lpo_number", "plate_number", "owner_phone", "accident_date", "approved_amount"]) {
        if (parsed.fields[key]?.method === "ocr") expect(selected[key], key).toBe(false);
      }
    }
    process.stdout.write(`TEMO_PRIVATE_OCR_METRICS ${JSON.stringify(metrics)}\n`);
    for (const item of metrics) expect(item.missed, `Sample ${item.sample} has incorrect fields`).toEqual([]);
  }, 600_000);
});
