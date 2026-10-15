// Deterministic, synthetic-only OCR smoke corpus. Never copy customer documents here.
import { createCanvas } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = resolve(process.argv[2] || ".temo-ocr-golden");
await mkdir(output, { recursive: true });
const manifest = { version: "synthetic-1", sanitized: true, representative: false, cases: [] };

async function add(name, lines, expected, options = {}) {
  const canvas = createCanvas(1700, 330 + lines.length * 105);
  const context = canvas.getContext("2d");
  context.fillStyle = options.lowLight ? "#89857e" : "#fefdf9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (options.skew) { context.translate(95, 30); context.rotate(-0.035); context.scale(0.93, 0.97); }
  context.fillStyle = options.lowLight ? "#343434" : "#111827";
  context.font = "bold 51px Arial";
  lines.forEach((line, index) => context.fillText(line, 60, 135 + index * 105));
  context.restore();
  const file = `${name}.png`;
  await writeFile(join(output, file), canvas.toBuffer("image/png"));
  manifest.cases.push({ name, file, mime: "image/png", expected });
}

const claim = ["مطالبة تأمين", "رقم المطالبة: C/004/01/26/9999/00001", "شركة التأمين: شركة تجريبية", "رقم اللوحة: ٤٧٧٨٢ B", "تاريخ الحادث: ٢٧/٠٤/٢٠٢٦"];
const claimExpected = { claim_number: "C/004/01/26/9999/00001", insurance_company: "شركة تجريبية", plate_number: "47782", accident_date: "27/04/2026" };
await add("arabic_claim", claim, claimExpected);
await add("arabic_claim_low_light", claim, claimExpected, { lowLight: true });
await add("arabic_claim_skew", claim, claimExpected, { skew: true });
await add("vehicle_registration", ["Vehicle Registration Card", "Plate No: 47782 B", "VIN: 1HGCM82633A004352", "Make: BYD", "Model: Song Plus", "Owner Name: TEST OWNER"],
  { plate_number: "47782", vin: "1HGCM82633A004352", make: "BYD", model: "Song Plus" });
await add("supplier_mixed", ["فاتورة ضريبية / TAX INVOICE", "اسم المورد: شركة تجريبية", "VATIN: OM123456789", "Invoice No: TEST-2026-41", "Invoice Date: 18/08/2026", "Subtotal: 100.000 OMR", "VAT Amount: 5.000 OMR", "Grand Total: 105.000 OMR"],
  { supplier_name: "شركة تجريبية", supplier_vatin: "OM123456789", invoice_number: "TEST-2026-41", invoice_date: "18/08/2026", subtotal: "100.000", vat: "5.000", total: "105.000" });
await add("parts_table", ["TAX INVOICE", "Invoice No: DEMO-88", "Description        Qty      Rate       Total", "Oil Filter                2       10.000      20.000", "Brake Pads            1       25.000      25.000", "Grand Total: 47.250 OMR"],
  { invoice_number: "DEMO-88", line_1: "Oil Filter", line_2: "Brake Pads", total: "47.250" });

const pdf = new jsPDF({ unit: "pt", format: "a4" });
pdf.setFontSize(19); pdf.text("Insurance Approval", 40, 60); pdf.text("Claim No: C/004/01/26/9999/00001", 40, 100);
pdf.addPage(); pdf.text("Approved Amount: 150.000 OMR", 40, 80); pdf.text("LPO No: DEMO-LPO-12", 40, 120);
await writeFile(join(output, "approval_multipage.pdf"), Buffer.from(pdf.output("arraybuffer")));
manifest.cases.push({ name: "approval_multipage", file: "approval_multipage.pdf", mime: "application/pdf", expected: { claim_number: "C/004/01/26/9999/00001", approved_amount: "150.000", lpo_number: "DEMO-LPO-12" } });

await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`Synthetic OCR dataset: ${manifest.cases.length} cases in ${output}\n`);
