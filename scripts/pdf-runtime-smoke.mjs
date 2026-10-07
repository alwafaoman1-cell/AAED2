// Generates a synthetic cash invoice through the same HTML -> PDF code path
// as PdfPreviewDialog. No customer or production data is read or written.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.PDF_SMOKE_ORIGIN || "http://127.0.0.1:4173";
const output = resolve("output/pdf/sales-invoice-smoke.pdf");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const pdfBase64 = await page.evaluate(async () => {
    const [{ getInvoiceHtml }, { generatePdfFromHtml }] = await Promise.all([
      import("/src/lib/pdfGenerator.ts"),
      import("/src/lib/htmlToPdf.ts"),
    ]);
    const html = getInvoiceHtml({
      invoiceNumber: "INV-TEST-000001",
      date: "2026-10-07",
      customerName: "SMOKE TEST CUSTOMER",
      vehicleInfo: "TEST VEHICLE",
      plateNumber: "TEST 1234",
      items: [{ description: "PDF generation check", quantity: 1, unitPrice: 10, total: 10 }],
      subtotal: 10,
      vat: 0.5,
      total: 10.5,
      paidTotal: 0,
      balanceDue: 10.5,
    });
    const blob = await generatePdfFromHtml({ htmlContent: html, fileName: "sales-invoice-smoke", download: false });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  const buffer = Buffer.from(pdfBase64, "base64");
  if (buffer.subarray(0, 5).toString() !== "%PDF-" || buffer.length < 5000) {
    throw new Error(`Invalid PDF (${buffer.length} bytes)`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  await mkdir(resolve("output/pdf"), { recursive: true });
  await writeFile(output, buffer);
  process.stdout.write(`PDF smoke PASS: ${buffer.length} bytes, ${output}\n`);
} finally {
  await browser.close();
}
