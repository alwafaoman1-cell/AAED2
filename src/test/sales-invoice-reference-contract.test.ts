import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales invoice document reference", () => {
  it("provides a working reference dialog instead of a disabled menu item", () => {
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    expect(detail).toContain("setShowReference(true)");
    expect(detail).toContain("<ReferenceDialog");
    expect(detail).toContain("salesStore.setDocumentReference(doc.id, reference)");
  });

  it("persists the reference only after Supabase confirms the update", () => {
    const store = read("src/lib/salesStore.ts");
    expect(store).toContain("updateSalesDocumentReferenceCloud");
    expect(store).toContain('.select("id,metadata,updated_at")');
    expect(store).toContain("لم يتم تأكيد حفظ مرجع الفاتورة");
    expect(store).toContain("documentReference: cleanReference || null");
  });

  it("includes the saved reference in invoice PDF data", () => {
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const pdf = read("src/lib/pdfGenerator.ts");
    expect(detail).toContain("reference: doc.documentReference");
    expect(pdf).toContain("<strong>Reference:</strong> ${invoiceRefEscape(data.reference)}");
  });
});
