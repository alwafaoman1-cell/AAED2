// Local synthetic PDF rendering probe. Never opens user documents or Production.
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const bundled = chromium.executablePath();
const systemChrome = process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "";
const executablePath = process.env.CHROME_PATH || (existsSync(bundled) ? bundled : systemChrome);
if (!executablePath || !existsSync(executablePath)) throw new Error("Chromium/Chrome binary unavailable");

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.LOCAL_APP_ORIGIN || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { generatePdfFromHtml } = await import("/src/lib/htmlToPdf.ts");
    const rows = Array.from({ length: 36 }, (_, index) => `<tr><td>${index + 1}</td><td>Workshop service ${index + 1}</td><td>1</td></tr>`).join("");
    const htmlContent = `<html><head><style>body{font-family:Arial}.page{width:794px;min-height:1123px;padding:32px;box-sizing:border-box;background:#fff}table{width:100%;border-collapse:collapse}td{border:1px solid #777;padding:8px}</style></head><body><div class="page"><h1>Work order PDF smoke</h1><table>${rows}</table></div></body></html>`;
    const started = performance.now();
    const blob = await generatePdfFromHtml({ htmlContent, fileName: "local-smoke", download: false });
    return { bytes: blob.size, elapsedMs: Math.round(performance.now() - started), type: blob.type };
  });
  if (result.type !== "application/pdf" || result.bytes < 1_000) throw new Error("PDF output is missing or invalid");
  console.log(`PASS local PDF render bytes=${result.bytes} elapsedMs=${result.elapsedMs}`);
} finally {
  await browser.close();
}
