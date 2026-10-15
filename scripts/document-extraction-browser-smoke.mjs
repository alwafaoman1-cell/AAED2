import { chromium } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

const baseUrl = process.env.DOCUMENT_SMOKE_URL || "http://127.0.0.1:4174";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function syntheticImage() {
  const canvas = createCanvas(1700, 830);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "bold 50px Arial";
  ["Vehicle Registration Card", "Plate No: 47782 B", "VIN: 1HGCM82633A004352", "Make: BYD", "Model: Song Plus", "Owner Name: TEST OWNER"]
    .forEach((line, index) => ctx.fillText(line, 55, 110 + index * 100));
  return canvas.toBuffer("image/png");
}

function syntheticArabicClaim() {
  const lines = ["مطالبة تأمين", "رقم المطالبة: C/004/01/26/9999/00001", "شركة التأمين: شركة تجريبية", "رقم اللوحة: ٤٧٧٨٢ B", "تاريخ الحادث: ٢٧/٠٤/٢٠٢٦"];
  const canvas = createCanvas(1700, 230 + lines.length * 95);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black"; ctx.font = "bold 48px Arial";
  lines.forEach((line, index) => ctx.fillText(line, 60, 120 + index * 95));
  return canvas.toBuffer("image/png");
}

function pdfBytes(kind, image) {
  const pdf = new jsPDF();
  if (kind === "scanned_pdf") {
    pdf.addImage(`data:image/png;base64,${image.toString("base64")}`, "PNG", 8, 10, 194, 95);
  } else {
    ["Vehicle Registration Card", "Plate No: 47782 B", "VIN: 1HGCM82633A004352", "Make: BYD", "Model: Song Plus", "Owner Name: TEST OWNER"]
      .forEach((line, index) => pdf.text(line, 18, 24 + index * 12));
    if (kind === "mixed_pdf") {
      pdf.addPage();
      pdf.addImage(`data:image/png;base64,${image.toString("base64")}`, "PNG", 8, 10, 194, 95);
    }
  }
  return [...new Uint8Array(pdf.output("arraybuffer"))];
}

const image = syntheticImage();
const samples = [
  { kind: "native_pdf", mime: "application/pdf", bytes: pdfBytes("native_pdf", image) },
  { kind: "image", mime: "image/png", bytes: [...image] },
  { kind: "scanned_pdf", mime: "application/pdf", bytes: pdfBytes("scanned_pdf", image) },
  { kind: "mixed_pdf", mime: "application/pdf", bytes: pdfBytes("mixed_pdf", image) },
  { kind: "arabic_claim", mime: "image/png", bytes: [...syntheticArabicClaim()], expectedType: "insurance_claim",
    expected: { claim_number: "C/004/01/26/9999/00001", insurance_company: "شركة تجريبية", plate_number: "47782", accident_date: "2026-04-27" } },
];

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/src/test/fixtures/document-engine-harness.html`);
  const report = [];
  for (const sample of samples) {
    const result = await page.evaluate(async (input) => {
      const { processDocumentLocally } = await import("/src/lib/documentExtraction/engine.ts");
      const file = new File([new Uint8Array(input.bytes)], `synthetic-${input.kind}.${input.mime === "application/pdf" ? "pdf" : "png"}`, { type: input.mime });
      const result = await processDocumentLocally(file, input.mime, "a".repeat(64), {
        tenantId: "synthetic-tenant", expectedType: input.expectedType || "vehicle_registration", policy: { allowAiFallback: false },
        match: async () => ({ matches: [], issues: [] }),
      });
      return {
        method: result.method, aiUsed: result.aiUsed, fields: Object.fromEntries(Object.entries(result.fields).map(([key, field]) => [key, field.normalizedValue])),
        issues: result.issues.map((issue) => issue.code), timings: result.timings, pages: result.pages.length,
        debug: input.kind === "arabic_claim" && input.debug ? { text: result.pages[0].text, segments: result.pages[0].segments } : undefined,
      };
    }, { ...sample, debug: process.env.OCR_DEBUG === "1" });
    const expected = sample.expected || { plate_number: "47782", vin: "1HGCM82633A004352", make: "BYD", model: "Song Plus" };
    const exact = Object.entries(expected).filter(([key, value]) => result.fields[key] === value).length;
    report.push({ kind: sample.kind, expected: 4, exact, method: result.method, aiUsed: result.aiUsed, issues: result.issues, timings: result.timings, pages: result.pages, debug: result.debug });
  }
  process.stdout.write(`${JSON.stringify({ report, pageErrors: errors }, null, 2)}\n`);
  if (errors.length || report[0].exact !== 4 || report[0].method !== "native_pdf" ||
      report[1].exact < 3 || report[2].exact < 3 || report[3].pages !== 2 ||
      report[3].method !== "ocr" || report[4].exact < 2 || report.some((row) => row.aiUsed)) process.exitCode = 1;
} finally { await browser.close(); }
