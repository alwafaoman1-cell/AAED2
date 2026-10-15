import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createWorker } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const directory = resolve(process.argv[2] || ".temo-ocr-golden");
const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
if (!manifest.sanitized || !manifest.version.startsWith("synthetic-")) throw new Error("Sanitized synthetic dataset required");
const normalize = (value) => String(value).replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) >= 0x06f0 ? digit.charCodeAt(0) - 0x06f0 : digit.charCodeAt(0) - 0x0660))
  .replace(/[\s\u200e\u200f:،,.-]/g, "").toLocaleLowerCase();
const worker = await createWorker("ara+eng", 1, { cachePath: tmpdir() });
let total = 0, matched = 0, duration = 0, peakRssMb = 0;
try {
  for (const item of manifest.cases) {
    const bytes = await readFile(join(directory, item.file));
    const started = performance.now();
    let text = "";
    if (item.mime === "application/pdf") {
      const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      try {
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number), content = await page.getTextContent();
          text += content.items.map((part) => "str" in part ? part.str : "").join(" ") + "\n";
        }
      } finally { await pdf.destroy(); }
    } else {
      text = (await worker.recognize(bytes)).data.text;
    }
    const normalized = normalize(text);
    const comparison = Object.fromEntries(Object.entries(item.expected).map(([key, value]) => [key, normalized.includes(normalize(value))]));
    const count = Object.values(comparison).filter(Boolean).length;
    const ms = Math.round(performance.now() - started);
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    peakRssMb = Math.max(peakRssMb, rssMb);
    total += Object.keys(comparison).length; matched += count; duration += ms;
    process.stdout.write(JSON.stringify({ engine: "tesseract.js", case: item.name, match: comparison, matched: count, fields: Object.keys(comparison).length, ms, rss_mb: rssMb }) + "\n");
  }
  process.stdout.write(JSON.stringify({ engine: "tesseract.js", model: "ara+eng", cases: manifest.cases.length,
    matched, fields: total, field_accuracy: matched / total, average_ms: Math.round(duration / manifest.cases.length), peak_rss_mb: peakRssMb }) + "\n");
} finally { await worker.terminate(); }
