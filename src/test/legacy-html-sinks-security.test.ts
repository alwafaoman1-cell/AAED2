// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_HTML_SANDBOX } from "@/lib/safeHtml";

// Test the real security boundary, without canvas, fonts/network or PDF allocation.
vi.mock("jspdf", () => ({ default: vi.fn() }));
vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("@/lib/pdfLayoutSettings", () => ({
  buildHtmlWithPageMarginStyle: (html: string) => html,
  injectPageMarginStyle: vi.fn(),
}));
vi.mock("@/lib/pdfDocumentRenderer", () => ({
  preparePagedPdfDocument: vi.fn(), waitForPdfAssets: vi.fn(),
}));

import { generatePdfFromHtml } from "@/lib/htmlToPdf";
import { openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import { injectPageMarginStyle } from "@/lib/pdfLayoutSettings";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
afterEach(() => {
  vi.restoreAllMocks();
});

describe("legacy HTML render sinks", () => {
  it("sanitizes before document.write, sets the sandbox before parsing, and still cleans up on failure", async () => {
    const stop = new Error("stop-before-rasterization");
    let written = "";
    let sandbox: string | null = null;
    const write = vi.fn((...parts: string[]) => {
      written = parts.join("");
      sandbox = document.querySelector("iframe")?.getAttribute("sandbox") ?? null;
      throw stop;
    });
    vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockReturnValue({
      open: vi.fn(), write, close: vi.fn(),
    } as unknown as Document);
    await expect(generatePdfFromHtml({
      htmlContent: '<html><head><style>.page{padding:12mm}</style></head><body><main class="page"><img onerror="alert(1)" src="javascript:alert(1)">Repair</main><script>alert(1)</script></body></html>',
      fileName: "security-probe", download: false,
    })).rejects.toThrow(stop);
    expect(sandbox).toBe(PDF_HTML_SANDBOX);
    expect(write).toHaveBeenCalledTimes(1);
    expect(written).not.toMatch(/<script|onerror|javascript:/i);
    expect(written).toContain(".page{padding:12mm}");
    expect(written).toContain("Repair");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("keeps the existing sanitized popup path functional, including opener detachment and margins", () => {
    const popupDoc = document.implementation.createHTMLDocument("Preview");
    const popup = { document: popupDoc, opener: window } as unknown as Window;
    const result = openSanitizedPdfWindow('<html><head><style>.page{color:red}</style></head><body><main class="page">Preview</main><script>alert(1)</script><img src="x" onerror="alert(1)"></body></html>', popup);
    expect(result).toBe(popup);
    expect(popup.opener).toBeNull();
    expect(popupDoc.querySelector("script,[onerror]")).toBeNull();
    expect(popupDoc.querySelector(".page")?.textContent).toBe("Preview");
    expect(popupDoc.querySelector("style")?.textContent).toContain(".page{color:red}");
    expect(injectPageMarginStyle).toHaveBeenCalledWith(popupDoc);
  });

  it("uses the central sanitized HTML and same sandbox at both owned srcDoc previews", () => {
    const preview = read("src/components/PdfPreviewDialog.tsx");
    const sales = read("src/components/sales/SalesDocDetailPage.tsx");
    expect(preview).toContain("sanitizePdfHtml(buildHtmlWithPageMarginStyle(htmlContent, orientation))");
    expect(preview).toContain("sandbox={PDF_HTML_SANDBOX}");
    expect(preview).toContain("srcDoc={previewHtml}");
    expect(sales).toContain("sanitizePdfHtml(previewHtml)");
    expect(sales).toContain("sandbox={PDF_HTML_SANDBOX}");
    expect(sales).toContain("srcDoc={safePreviewHtml}");
    expect(sales).toContain("safePdfImageSrc(qrDataUrl)");
  });

  it("preserves parent pagination, assets and binary-PDF printing instead of enabling inline scripts", () => {
    const preview = read("src/components/PdfPreviewDialog.tsx");
    const engine = read("src/lib/htmlToPdf.ts");
    for (const source of [preview, engine]) {
      expect(source).toContain("waitForPdfAssets(doc)");
      expect(source).toContain("preparePagedPdfDocument(doc, orientation)");
    }
    expect(preview).toContain("onLoad={handlePreviewLoad}");
    expect(preview).toContain("measurePreview()");
    expect(preview).toContain("iframe.contentWindow?.print()");
    expect(preview).toContain('await import("@/lib/htmlToPdf")');
    expect(preview).not.toMatch(/import\s*\{[^}]+\}\s*from\s*["']@\/lib\/htmlToPdf["']/);
    expect(engine).toContain('iframe.setAttribute("sandbox", PDF_HTML_SANDBOX)');
    expect(engine).toContain("doc.write(fastHtmlContent)");
    expect(engine).toContain("sanitizePdfHtml(buildHtmlWithPageMarginStyle(htmlContent, orientation))");
    expect(engine.indexOf('iframe.setAttribute("sandbox", PDF_HTML_SANDBOX)'))
      .toBeLessThan(engine.indexOf("document.body.appendChild(iframe)"));
  });
});
