import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const store = readFileSync(resolve(root, "src/lib/salesStore.ts"), "utf8");
const detail = readFileSync(resolve(root, "src/components/sales/SalesDocDetailPage.tsx"), "utf8");

describe("sales payment deletion persistence contract", () => {
  it("uses the atomic tenant-scoped deletion and reconciliation RPC", () => {
    expect(store).toContain('"delete_sales_payment_or_reconcile"');
    expect(store).toContain("p_document_id: docId");
    expect(store).toContain("p_payment_reference: paymentId");
  });

  it("keeps a compatibility delete for a real payment while the RPC rolls out", () => {
    expect(store).toContain('supabase.from("sales_payments")');
    expect(store).toContain('.eq("sales_document_id", docId)');
    expect(store).toContain('.eq("id", paymentId)');
    expect(store).toContain('.select("id")');
    expect(store).toContain('if (!data?.id)');
  });

  it("keeps Supabase authoritative and refreshes invoice totals after deletion", () => {
    const start = store.indexOf("async removePayment(docId: string, paymentId: string)");
    const removePaymentBody = store.slice(start, store.indexOf("  addNote(", start));
    expect(store).toContain("await deleteSalesPaymentCloud(docId, paymentId)");
    expect(store).toContain("await refreshSalesDocumentFromCloud(docId)");
    expect(removePaymentBody).not.toContain("salesStore.upsert");
    expect(removePaymentBody).not.toContain("write(");
  });

  it("never restores metadata-only ghost payments into the invoice cache", () => {
    expect(store).toContain("payments: []");
    expect(store).toContain("applyAuthoritativeSalesPayments(doc, cloudPayments || [])");
    expect(store).not.toContain("payments: doc.payments,");
  });

  it("derives the invoice badge and totals from actual payment rows", () => {
    expect(store).toContain("export function applyAuthoritativeSalesPayments");
    expect(store).toContain("const paidTotal = payments.reduce");
    expect(store).toContain('status = doc.invoiceStatus === "issued" ? "unpaid" : "draft"');
    expect(store).toContain('paid_amount: doc.type === "invoice" ? undefined : doc.paidTotal');
    expect(store).toContain('balance_due: doc.type === "invoice" ? undefined : doc.balanceDue');

    const triggerSql = readFileSync(resolve(root, "supabase/migrations/20260903123000_sales_invoice_collection_status_ssot.sql"), "utf8");
    expect(triggerSql).toContain("create or replace function public.refresh_sales_doc_last_payment()");
    expect(triggerSql).toContain("create or replace function public.enforce_sales_invoice_payment_summary()");
    expect(triggerSql).toContain("balance_due = greatest(coalesce(d.total, 0) - v_paid, 0)");
    expect(triggerSql).toContain("before update of total, paid_amount, balance_due, status, invoice_status");
    expect(triggerSql).toContain("when v_paid > 0 then 'partial'");
    expect(triggerSql).toContain("then 'unpaid'");
  });

  it("migration reverses accounting and recalculates invoice totals atomically", () => {
    const sql = readFileSync(resolve(root, "supabase/migrations/20260903110000_sales_payment_ssot_reconciliation.sql"), "utf8");
    expect(sql).toContain("delete_sales_payment_or_reconcile");
    expect(sql).toContain("reverse_accounting_journal_entry");
    expect(sql).toContain("delete from public.sales_payments");
    expect(sql).toContain("legacy_metadata_reconciled");
    expect(sql).toContain("public.get_user_tenant_id()");
    expect(sql).toContain("('admin', 'manager')");
  });

  it("shows success only after the asynchronous delete succeeds", () => {
    expect(detail).toContain("await salesStore.removePayment(doc.id, paymentId)");
    expect(detail).toContain("تم حذف الدفعة فعليًا");
    expect(detail).toContain("تعذر حذف الدفعة");
  });
});
