import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("PDF pagination contract", () => {
  it("does not clip exported PDF pages to the first A4 viewport", () => {
    const htmlToPdf = read("src/lib/htmlToPdf.ts");
    const renderer = read("src/lib/pdfDocumentRenderer.ts");

    expect(htmlToPdf).toContain("overflow:visible!important");
    expect(htmlToPdf).toContain("max-height:none!important");
    expect(htmlToPdf).toContain("page-break-before:always");
    expect(htmlToPdf).not.toContain("html.pdf-export, html.pdf-export body{background:#fff!important;margin:0!important;padding:0!important;overflow:hidden!important");

    expect(renderer).toContain('page.style.overflow = "visible"');
    expect(renderer).toContain('page.style.maxHeight = "none"');
    expect(renderer).not.toContain('page.style.overflow = "hidden"');
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
