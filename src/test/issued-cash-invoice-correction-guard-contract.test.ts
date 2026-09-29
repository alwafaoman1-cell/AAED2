import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("issued cash invoice correction safety", () => {
  it("never edits an issued invoice or official number through the ordinary editor", () => {
    const editor = read("src/components/sales/SalesDocEditorPage.tsx");
    const store = read("src/lib/salesStore.ts");
    expect(editor).toContain('existing.invoiceStatus === "issued"');
    expect(editor).toContain('existing.invoiceStatus === "credited"');
    expect(store).toContain('.select("invoice_status,issued_at,doc_number")');
    expect(store).toContain('existing.invoice_status === "issued"');
  });

  it("waits for the cloud write before reporting success", () => {
    const editor = read("src/components/sales/SalesDocEditorPage.tsx");
    const save = editor.split('async function save(mode: "draft" | "issue" = "draft") {')[1]
      .split("const docTypeForTemplate")[0];
    expect(save).toContain("saved = await salesStore.saveDraft(prepared)");
    expect(save).not.toContain("saved = salesStore.upsert(prepared)");
  });

  it("does not turn issued invoices back into drafts and confirms destructive deletion", () => {
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const list = read("src/components/sales/SalesDocList.tsx");
    const store = read("src/lib/salesStore.ts");
    expect(detail).toContain('doc.invoiceStatus === "issued" || doc.invoiceStatus === "credited"');
    expect(detail).toContain("!isLockedIssuedDocument && <DropdownMenuItem onClick={setDraft}");
    expect(list).toContain('type !== "invoice" && <Select onValueChange');
    expect(store).toContain('throw new Error("حالة الفاتورة الصادرة تُحتسب من الدفعات');
    expect(detail).not.toContain("<DropdownMenuItem onClick={doDelete}");
    expect(detail).toContain("onConfirm: () => { void doDelete(); }");
  });
});
