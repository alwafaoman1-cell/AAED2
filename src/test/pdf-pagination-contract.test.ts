import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("PDF pagination contract", () => {
  it("routes PDF generation through PDF v2 without the legacy screenshot renderer", () => {
    const htmlToPdf = read("src/lib/htmlToPdf.ts");
    const engine = read("src/lib/pdf-v2/pdfEngine.ts");
    const layout = read("src/lib/pdf-v2/pdfLayout.ts");
    const app = read("src/App.tsx");

    expect(htmlToPdf).toContain("downloadPdfV2");
    expect(htmlToPdf).not.toContain("html2canvas(");
    expect(htmlToPdf).not.toContain("import html2canvas");

    expect(engine).toContain("overflow:visible");
    expect(engine).toContain("break-inside:avoid");
    expect(engine).toContain("thead{display:table-header-group}");
    expect(layout).toContain("widthMm: 210");
    expect(layout).toContain("heightMm: 297");
    expect(layout).toContain("margins: { top: 12, right: 12, bottom: 14, left: 12 }");
    expect(app).toContain('path="/print/:documentType/:id"');
    expect(app).toContain('path="/pdf-preview/:documentType/:id"');
  });

  it("keeps work order PDF VAT and totals decimal-safe", () => {
    const generator = read("src/lib/pdfGenerator.ts");

    expect(generator).toContain("const vat = Number((subtotal * (s.vatRate / 100)).toFixed(3))");
    expect(generator).toContain("const grandTotal = Number((subtotal + vat).toFixed(3))");
    expect(generator).toContain("const balanceDue = Number(Math.max(0, grandTotal - deposit).toFixed(3))");
    expect(generator).not.toContain("Math.round(subtotal");
    expect(generator).not.toContain("Math.round(vat");
  });
});
