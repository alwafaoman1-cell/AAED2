import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("invoice receipt cascade contract", () => {
  it("removes sales and insurance receipts at the database boundary", () => {
    const sql = read("supabase/migrations/20260812100000_delete_invoice_linked_receipts.sql");
    expect(sql).toContain("trg_cleanup_insurance_invoice_receipts");
    expect(sql).toContain("trg_cleanup_soft_deleted_sales_invoice_receipts");
    expect(sql).toContain("delete from public.claim_payments");
    expect(sql).toContain("offset_against_invoice_id = old.id");
    expect(sql).toContain("delete from public.sales_payments");
    expect(sql).toContain("sales_document_id = new.id");
  });

  it("links new insurance receipts to the invoice and clears local sales payments", () => {
    const dialog = read("src/components/payments/UnifiedAddPaymentDialog.tsx");
    const sales = read("src/lib/salesStore.ts");
    expect(dialog).toContain("offset_against_invoice_id: selected.invoiceId");
    expect(dialog).toContain("invoiceId: linkedInvoice?.id || null");
    expect(sales).toContain("payments: []");
    expect(sales).toContain("paidTotal: 0");
  });

  it("reverses cloud postings and waits for atomic Supabase cleanup before local success", () => {
    const migration = read("supabase/migrations/20260825125000_sales_invoice_financial_delete_integrity.sql");
    const store = read("src/lib/salesStore.ts");
    const removeBlock = store.slice(store.indexOf("async remove(id: string)"), store.indexOf("async hardRemove(id: string)"));
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const list = read("src/components/sales/SalesDocList.tsx");

    expect(migration).toContain("reverse_accounting_journal_entry");
    expect(migration).toContain("source_type = 'sales_payment'");
    expect(migration).toContain("source_type in ('sales_invoice', 'cash_invoice')");
    expect(migration).toContain("delete from public.accounting_receipts");
    expect(migration).toContain("delete from public.sales_payments");
    expect(migration).toContain("repair_deleted_sales_invoice_financials");
    expect(migration).not.toMatch(/delete from public\.accounting_journal_(entries|lines)/i);
    expect(removeBlock.indexOf("await upsertSalesCloud(removed)")).toBeLessThan(removeBlock.indexOf("write(read().map"));
    expect(store).toContain("removeCustomerPaymentJournal(`${id}::${payment.id}`)");
    expect(detail).toContain("await salesStore.remove(doc.id)");
    expect(list).toContain("Promise.allSettled(ids.map((id) => salesStore.remove(id)))");
  });
});
