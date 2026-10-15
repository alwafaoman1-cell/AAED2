import { chromium, devices } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const baseUrl = process.env.DOCUMENT_SMOKE_URL || "http://127.0.0.1:4174";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function syntheticImage(label) {
  const canvas = createCanvas(1000, 1400);
  const context = canvas.getContext("2d");
  context.fillStyle = "#666"; context.fillRect(0, 0, 1000, 1400);
  context.fillStyle = "#fff"; context.fillRect(80, 60, 840, 1280);
  context.fillStyle = "#111"; context.font = "bold 50px Arial";
  context.fillText(`TEMO TEST ${label}`, 130, 230);
  context.fillText("CLAIM: SYN-001", 130, 320);
  return canvas.toBuffer("image/jpeg", { quality: 0.95 });
}

function syntheticArabicClaim() {
  const canvas = createCanvas(1700, 705);
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black"; context.font = "bold 48px Arial";
  ["مطالبة تأمين", "رقم المطالبة: C/004/01/26/9999/00001", "شركة التأمين: شركة تجريبية", "رقم اللوحة: ٤٧٧٨٢ B", "تاريخ الحادث: ٢٧/٠٤/٢٠٢٦"]
    .forEach((line, index) => context.fillText(line, 60, 120 + index * 95));
  return canvas.toBuffer("image/png");
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const cases = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
      permissions: ["camera"], acceptDownloads: true,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/src/test/fixtures/document-scanner-harness.html`);
    await page.getByRole("dialog").waitFor();
    const camera = page.locator("video");
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth > 0, null, { timeout: 15000 });
    await page.getByRole("button", { name: "Capture" }).click();
    await page.getByRole("button", { name: "Keep page" }).waitFor();
    await page.getByRole("button", { name: "Retake" }).click();
    await camera.waitFor();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth > 0);
    const image1 = syntheticImage("ONE");
    const image2 = syntheticImage("TWO");
    const baseline = await page.evaluate(async (bytes) => {
      const { processDocumentLocally } = await import("/src/lib/documentExtraction/engine.ts");
      const file = new File([new Uint8Array(bytes)], "synthetic-before.jpg", { type: "image/jpeg" });
      const result = await processDocumentLocally(file, "image/jpeg", "a".repeat(64), {
        tenantId: "synthetic-only", expectedType: "insurance_claim", policy: { allowAiFallback: false },
        match: async () => ({ matches: [], issues: [] }),
      });
      const normalized = result.rawText.replace(/[^a-z0-9]/gi, "").toLowerCase();
      return ["temo", "syn001"].filter((value) => normalized.includes(value)).length;
    }, [...image1]);
    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-one.jpg", mimeType: "image/jpeg", buffer: image1 });
    await page.getByRole("button", { name: "Keep page" }).waitFor();
    const corners = await page.getByRole("button", { name: /Corner \d/ }).count();
    const buttonLabels = await page.locator('button[aria-label]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    if (corners !== 4) throw new Error(`CORNERS_MISSING: ${JSON.stringify(buttonLabels)}; ${pageErrors.join(' | ')}`);
    const initialLeft = await page.evaluate(() => document.querySelector('button[aria-label="Corner 1"]')?.getAttribute('style'));
    const cornerBox = await page.evaluate(() => { const box = document.querySelector('button[aria-label="Corner 1"]')?.getBoundingClientRect(); return box && { x: box.x, y: box.y, width: box.width, height: box.height }; });
    if (!cornerBox) throw new Error("CORNER_NOT_VISIBLE");
    await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
    await page.mouse.down(); await page.mouse.move(cornerBox.x + 45, cornerBox.y + 35, { steps: 5 }); await page.mouse.up();
    const movedLeft = await page.evaluate(() => document.querySelector('button[aria-label="Corner 1"]')?.getAttribute('style'));
    await page.getByRole("button", { name: "Enhanced color" }).click();
    const started = Date.now();
    await page.getByRole("button", { name: "Keep page" }).click();
    await camera.waitFor();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth > 0);
    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-two.jpg", mimeType: "image/jpeg", buffer: image2 });
    await page.getByRole("button", { name: "Keep page" }).click();
    await page.getByRole("button", { name: "Move left" }).last().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const download = await downloadPromise;
    const pdfBytes = await readFile(await download.path());
    const pdf = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;
    const pdfPages = pdf.numPages;
    await pdf.destroy();
    await page.evaluate(() => window.__setScannerLanguage("ar"));
    const rtl = await page.getByRole("dialog").getAttribute("dir");
    await page.evaluate(() => window.__setScannerLanguage("en"));
    await page.getByRole("button", { name: "Extract to form" }).click();
    await page.waitForFunction(() => Boolean(window.__scannerExtracted || window.__scannerError), null, { timeout: 120000 });
    const scannerError = await page.evaluate(() => window.__scannerError);
    if (scannerError) throw new Error(`SCANNER_EXTRACTION_TEST_FAILED ${scannerError}`);
    const extracted = await page.evaluate(() => window.__scannerExtracted);
    await page.evaluate(() => { window.__scannerExtracted = undefined; window.__scannerError = undefined; });
    await page.getByRole("button", { name: "Reopen scanner" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-arabic-claim.png", mimeType: "image/png", buffer: syntheticArabicClaim() });
    await page.getByRole("button", { name: "Keep page" }).click();
    await page.getByRole("button", { name: "Extract to form" }).click();
    await page.waitForFunction(() => Boolean(window.__scannerExtracted || window.__scannerError), null, { timeout: 120000 });
    const arabicError = await page.evaluate(() => window.__scannerError);
    if (arabicError) throw new Error(`SCANNER_ARABIC_CLAIM_FAILED ${arabicError}`);
    const arabicClaim = await page.evaluate(() => window.__scannerExtracted);
    cases.push({ mode: mobile ? "Chrome mobile emulation" : "Chrome desktop", camera: true, gallery: true,
      corners, cornerMoved: initialLeft !== movedLeft, multiPage: pdfPages, pdfBytes: pdfBytes.length,
      extracted, arabicClaim: { ocrPages: arabicClaim?.ocrPages, claimReferenceCorrect: arabicClaim?.claimNumber === "C/004/01/26/9999/00001" },
      baselineMarkerMatches: baseline, rtl, processingMs: Date.now() - started, pageErrors });
    await context.close();
  }
  process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
  if (cases.some((entry) => entry.pageErrors.length || entry.corners !== 4 || !entry.cornerMoved ||
    entry.multiPage !== 2 || !entry.extracted?.pdfMagic || entry.extracted?.ocrPages !== 2 || entry.rtl !== "rtl" ||
    entry.baselineMarkerMatches !== 2 || entry.extracted?.markerMatches !== entry.baselineMarkerMatches ||
    !entry.arabicClaim?.claimReferenceCorrect || entry.arabicClaim?.ocrPages !== 1)) process.exitCode = 1;
} finally { await browser.close(); }
