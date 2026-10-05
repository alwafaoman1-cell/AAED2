import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("issued cash invoice correction safety", () => {
  it("routes an issued cash invoice through the audited correction RPC, not a draft upsert", () => {
    const editor = read("src/components/sales/SalesDocEditorPage.tsx");
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const store = read("src/lib/salesStore.ts");
    expect(detail).toContain('canCorrectIssuedCashInvoice = type === "invoice" && doc.invoiceStatus === "issued"');
    expect(detail).toContain('"sales_invoice_revisions"');
    expect(detail).toContain('.eq("tenant_id", tenantId)');
    expect(editor).toContain('salesStore.reviseIssuedInvoice(prepared, revisionReason)');
    expect(editor).toContain('doc.invoiceStatus === "credited"');
    expect(editor).toContain('readOnly={type === "invoice" && doc.invoiceStatus === "issued"}');
    expect(editor).toContain("{!revisingIssued && (");
    expect(editor).toContain("customerId: c.id");
    expect(store).toContain('"revise_issued_cash_invoice"');
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

  it("keeps corrections tenant-scoped, atomic, and separate from numbering and receipts", () => {
    const sql = read("supabase/migrations/20261004100000_issued_cash_invoice_revision.sql");
    expect(sql).toContain("d.tenant_id = v_tenant for update");
    expect(sql).toContain("INVOICE_REVISION_STALE");
    expect(sql).toContain("ISSUED_CASH_INVOICE_NUMBER_IMMUTABLE");
    expect(sql).toContain("v_total < v_paid");
    expect(sql).toContain("from public.sales_payments p");
    expect(sql).toContain("from public.accounting_source_links s");
    expect(sql).toContain("ap.status in ('closed', 'locked')");
    expect(sql).toContain("insert into public.sales_invoice_revisions");
    expect(sql).toContain("alter table public.sales_invoice_revisions enable row level security");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("return v_new;");
    expect(sql).not.toContain("update public.invoice_number_registry");
    expect(sql).not.toContain("update public.sales_payments");
  });
});
