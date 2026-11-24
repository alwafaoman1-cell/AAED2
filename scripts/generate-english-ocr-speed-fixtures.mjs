// New corpus for English-only extraction. Never alters the earlier bilingual benchmark.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";

const output = resolve(process.argv[2] || "output/ocr-english-development-2026-11-24/dataset");
await mkdir(output, { recursive: true });
await mkdir(join(output, "negative"), { recursive: true });
const manifest = {
  version: "synthetic-english-claim-speed-1", sanitized: true, representative: false,
  purpose: "Matched English-only Development OCR timing and exact identifier ground truth",
  cases: [],
};
const negative = {
  version: "synthetic-english-negative-1", sanitized: true, representative: false,
  purpose: "Arabic-only documents must not generate English-only fields or autofill",
  cases: [],
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function add(target, directory, name, mime, bytes, expectedType, expected, extra = {}) {
  const file = `${name}.${mime === "application/pdf" ? "pdf" : "png"}`;
  if (basename(file) !== file) throw new Error("Synthetic fixture path must be a basename");
  await writeFile(join(directory, file), bytes);
  target.cases.push({ name, file, mime, expectedType, expected, sha256: sha256(bytes), ...extra });
}
function claim(seed, plate, letters, vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error("Synthetic VIN must have a valid format");
  const expected = { claim_number: `C/004/01/26/${seed}/00001`, plate_number: plate, plate_letters: letters, vin };
  const lines = [
    "INSURANCE CLAIM - SYNTHETIC TEST ONLY",
    `Claim No: ${expected.claim_number}`,
    "Insurance Company: TEST INSURANCE",
    `Plate No: ${plate}`,
    `Plate Letters: ${letters}`,
    `VIN: ${vin}`,
    "Make: Toyota", "Model: Camry", "Owner Name: TEST OWNER",
  ];
  return { expected, lines };
}
function image(lines, options = {}) {
  const canvas = createCanvas(1700, Math.max(1150, 165 + lines.length * 105));
  const context = canvas.getContext("2d");
  context.fillStyle = options.lowLight ? "#b0ada7" : "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (options.skew) { context.translate(70, 30); context.rotate(-0.025); context.scale(0.94, 0.98); }
  context.fillStyle = options.lowLight ? "#333333" : "#111827";
  context.font = "bold 46px Arial";
  lines.forEach((line, index) => context.fillText(line, 65, 120 + index * 105));
  context.restore();
  return { bytes: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height };
}
function pdf(id) {
  const document = new jsPDF({ unit: "pt", format: "a4", compress: true });
  document.setCreationDate(new Date("2026-11-24T00:00:00Z"));
  document.setFileId(id.padStart(32, "0"));
  document.setProperties({ title: "Synthetic English-only claim fixture", author: "TEMO Development benchmark" });
  return document;
}
function nativePage(document, lines) {
  document.setFont("helvetica", "normal");
  document.setFontSize(16);
  lines.forEach((line, index) => document.text(line, 38, 65 + index * 38));
}
function scanPage(document, scan) {
  const width = document.internal.pageSize.getWidth() - 76;
  document.addImage(scan.bytes, "PNG", 38, 50, width, width * scan.height / scan.width);
}
function bytes(document) { return Buffer.from(document.output("arraybuffer")); }

const samples = [
  ["english_claim_clean", claim("9000", "47782", "B", "1HGCM82633A004352"), {}],
  ["english_claim_low_light", claim("9001", "39566", "AA", "1M8GDM9AXKP042788"), { lowLight: true }],
  ["english_claim_skew", claim("9002", "12345", "D", "WVWZZZ1JZXW000001"), { skew: true }],
];
for (const [name, sample, options] of samples) {
  await add(manifest, output, name, "image/png", image(sample.lines, options).bytes, "insurance_claim", sample.expected);
}
const registration = [
  "VEHICLE REGISTRATION - SYNTHETIC TEST ONLY", "Plate No: 91823", "Plate Letters: RS",
  "VIN: 1FTFW1ET1EFA00001", "Make: Toyota", "Model: Hilux", "Owner Name: TEST OWNER",
];
await add(manifest, output, "english_vehicle_registration", "image/png", image(registration).bytes, "vehicle_registration",
  { plate_number: "91823", plate_letters: "RS", vin: "1FTFW1ET1EFA00001" });

const nativeClaim = claim("9003", "58217", "C", "1M8GDM9AXKP042788");
const native = pdf("11"); nativePage(native, nativeClaim.lines);
await add(manifest, output, "english_native_claim", "application/pdf", bytes(native), "insurance_claim", nativeClaim.expected,
  { expectedMethods: ["native_pdf"] });
const scannedClaim = claim("9004", "67891", "F", "WVWZZZ1JZXW000001");
const scanned = pdf("12"); scanPage(scanned, image(scannedClaim.lines));
await add(manifest, output, "english_scanned_claim", "application/pdf", bytes(scanned), "insurance_claim", scannedClaim.expected,
  { expectedMethods: ["ocr"] });
const mixedClaim = claim("9005", "72913", "K", "1HGCM82633A004352");
const mixed = pdf("13"); nativePage(mixed, mixedClaim.lines); mixed.addPage(); scanPage(mixed, image(mixedClaim.lines));
await add(manifest, output, "english_mixed_claim", "application/pdf", bytes(mixed), "insurance_claim", mixedClaim.expected,
  { expectedMethods: ["native_pdf", "ocr"] });

// Embedded Unicode font makes Arabic really present in the native PDF layer,
// rather than testing mojibake produced by a Latin-only PDF font.
const fontPath = process.env.TEMO_SYNTHETIC_ARABIC_FONT || "C:/Windows/Fonts/arial.ttf";
const font = (await readFile(fontPath)).toString("base64");
function arabicFont(document) {
  document.addFileToVFS("synthetic-arial.ttf", font);
  document.addFont("synthetic-arial.ttf", "synthetic-arial", "normal");
  document.setFont("synthetic-arial", "normal");
}
const bilingualClaim = claim("9006", "81726", "L", "1M8GDM9AXKP042788");
const bilingual = pdf("14"); nativePage(bilingual, bilingualClaim.lines);
arabicFont(bilingual); bilingual.setFontSize(16);
bilingual.text("ملاحظة عربية لا تُستخرج في وضع الإنجليزية", 38, 460);
bilingual.text("اسم عميل عربي تجريبي فقط", 38, 500);
await add(manifest, output, "bilingual_english_labels", "application/pdf", bytes(bilingual), "insurance_claim", bilingualClaim.expected,
  { expectedMethods: ["native_pdf"], containsArabicBoilerplate: true });

const arabicLines = [
  "مطالبة تأمين تجريبية", "رقم المطالبة: C/004/01/26/9999/00001",
  "رقم اللوحة: ٤٧٧٨٢", "حروف اللوحة: ب", "رقم الشاصي: 1HGCM82633A004352",
  "اسم المالك: عميل تجريبي", "شركة التأمين: شركة تجريبية",
];
await add(negative, join(output, "negative"), "arabic_only_image", "image/png", image(arabicLines).bytes, "insurance_claim", {},
  { expectedNoFields: true });
const arabicNative = pdf("15"); arabicFont(arabicNative); arabicNative.setFontSize(16);
arabicLines.forEach((line, index) => arabicNative.text(line, 38, 65 + index * 42));
await add(negative, join(output, "negative"), "arabic_only_native_pdf", "application/pdf", bytes(arabicNative), "insurance_claim", {},
  { expectedNoFields: true });

await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(join(output, "negative/manifest.json"), JSON.stringify(negative, null, 2));
process.stdout.write(`English-only synthetic corpus: ${manifest.cases.length} positive and ${negative.cases.length} negative cases in ${output}\n`);
