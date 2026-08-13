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
});
