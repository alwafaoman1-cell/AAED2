// Synthetic Development benchmark only. Never source real customer documents.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

const output = resolve(process.argv[2] || "output/ocr-speed-development-2026-11-24/dataset");
const golden = resolve(process.argv[3] || join(tmpdir(), "temo-ocr-golden-synthetic-1"));
const sourceManifest = JSON.parse(await readFile(join(golden, "manifest.json"), "utf8"));
if (sourceManifest.sanitized !== true || !sourceManifest.version?.startsWith("synthetic-")) {
  throw new Error("A verified synthetic source corpus is required");
}
await mkdir(output, { recursive: true });
const manifest = {
  version: "synthetic-claim-speed-1",
  sanitized: true,
  representative: false,
  purpose: "Same-document Development latency and critical-identifier comparison; not customer-corpus accuracy",
  sourceVersion: sourceManifest.version,
  cases: [],
};
const critical = new Set(["claim_number", "plate_number", "plate_letters", "vin"]);
async function add(name, file, mime, bytes, expectedType, expected, extra = {}) {
  if (basename(file) !== file) throw new Error("Fixture file must remain in the synthetic dataset");
  await writeFile(join(output, file), bytes);
  manifest.cases.push({
    name, file, mime, expectedType,
    expected: Object.fromEntries(Object.entries(expected).filter(([key]) => critical.has(key))),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...extra,
  });
}
for (const name of ["arabic_claim", "arabic_claim_low_light", "arabic_claim_skew", "vehicle_registration", "approval_multipage"]) {
  const sample = sourceManifest.cases.find(item => item.name === name);
  if (!sample || basename(sample.file) !== sample.file) throw new Error("Synthetic source fixture is missing or invalid");
  const expected = { ...sample.expected };
  // All four source images visibly contain the B plate letter. Evaluate it as
  // well as the digits; do not silently reduce accuracy coverage to the digits.
  if (name !== "approval_multipage") expected.plate_letters = "B";
  await add(name, sample.file, sample.mime, await readFile(join(golden, sample.file)),
    name === "vehicle_registration" ? "vehicle_registration" : name === "approval_multipage" ? "insurance_approval" : "insurance_claim",
    expected, { copiedOriginal: true });
}

const claimLines = [
  "INSURANCE CLAIM - SYNTHETIC TEST ONLY",
  "Claim No: C/004/01/26/9999/00001",
  "Insurance Company: TEST INSURANCE",
  "Plate No: 47782",
  "Plate Letters: B",
  "VIN: 1HGCM82633A004352",
  "Make: Toyota",
  "Model: Camry",
  "Owner Name: TEST OWNER",
];
const expectedClaim = { claim_number: "C/004/01/26/9999/00001", plate_number: "47782", plate_letters: "B", vin: "1HGCM82633A004352" };
const canvas = createCanvas(1700, 1150);
const context = canvas.getContext("2d");
context.fillStyle = "#ffffff";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "#111827";
context.font = "bold 46px Arial";
claimLines.forEach((line, index) => context.fillText(line, 65, 120 + index * 105));
const image = canvas.toBuffer("image/png");
await add("english_claim_identifiers", "english_claim_identifiers.png", "image/png", image, "insurance_claim", expectedClaim);

function pdfDocument(id) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  pdf.setCreationDate(new Date("2026-11-24T00:00:00Z"));
  pdf.setFileId(id.padStart(32, "0"));
  pdf.setProperties({ title: "Synthetic claim speed fixture", author: "TEMO Development benchmark" });
  return pdf;
}
function nativePage(pdf) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(16);
  claimLines.forEach((line, index) => pdf.text(line, 38, 65 + index * 38));
}
function scannedPage(pdf) {
  const width = pdf.internal.pageSize.getWidth() - 76;
  pdf.addImage(image, "PNG", 38, 50, width, width * canvas.height / canvas.width);
}
const native = pdfDocument("1");
nativePage(native);
await add("native_claim_identifiers", "native_claim_identifiers.pdf", "application/pdf", Buffer.from(native.output("arraybuffer")), "insurance_claim", expectedClaim,
  { expectedMethods: ["native_pdf"] });
const scanned = pdfDocument("2");
scannedPage(scanned);
await add("scanned_claim_identifiers", "scanned_claim_identifiers.pdf", "application/pdf", Buffer.from(scanned.output("arraybuffer")), "insurance_claim", expectedClaim,
  { expectedMethods: ["ocr"] });
const mixed = pdfDocument("3");
nativePage(mixed);
mixed.addPage();
scannedPage(mixed);
await add("mixed_claim_identifiers", "mixed_claim_identifiers.pdf", "application/pdf", Buffer.from(mixed.output("arraybuffer")), "insurance_claim", expectedClaim,
  { expectedMethods: ["native_pdf", "ocr"] });

await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`Synthetic claim benchmark dataset: ${manifest.cases.length} cases in ${output}\n`);
