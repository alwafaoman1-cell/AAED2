import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("cash invoice payment VAT invariant", () => {
  it("stores the entered payment amount without deriving or writing payment VAT", () => {
    const store = read("src/lib/salesStore.ts");
    const insert = store.slice(
      store.indexOf("async function insertSalesPaymentCloud"),
      store.indexOf("async function deleteSalesPaymentCloud"),
    );

    expect(insert).toContain("p_amount: roundMoney(payment.amount)");
    expect(insert).not.toMatch(/vat|tax_total|subtotal/i);
  });

  it("keeps invoice subtotal, VAT and gross total separate from partial payments", () => {
    const detail = read("src/components/sales/SalesDocDetailPage.tsx");
    const unified = read("src/components/payments/UnifiedAddPaymentDialog.tsx");

    expect(detail).toContain("doc.subtotal.toFixed(3)");
    expect(detail).toContain("doc.taxTotal.toFixed(3)");
    expect(detail).toContain("doc.total.toFixed(3)");
    expect(detail).toContain("الضريبة تخص إجمالي الفاتورة ولا يعاد احتسابها من الدفعة الجزئية");
    expect(unified).toContain("selected.subtotal");
    expect(unified).toContain("selected.vat");
    expect(unified).toContain("الدفعة الجزئية تغيّر المدفوع والمتبقي فقط");
  });

  it("database collection synchronization changes only paid, balance and status fields", () => {
    const migration = read("supabase/migrations/20260903123000_sales_invoice_collection_status_ssot.sql");
    const refresh = migration.slice(
      migration.indexOf("create or replace function public.refresh_sales_doc_last_payment"),
      migration.indexOf("comment on function public.refresh_sales_doc_last_payment"),
    );

    expect(refresh).toContain("paid_amount = v_paid");
    expect(refresh).toContain("balance_due = greatest(coalesce(d.total, 0) - v_paid, 0)");
    expect(refresh).not.toMatch(/set[\s\S]{0,500}(subtotal|tax_total)\s*=/i);
  });

  it("recognizes full cash-invoice VAT once from earliest partial collections", () => {
    const migration = read("supabase/migrations/20260907110000_cash_invoice_partial_payment_vat_basis.sql");

    expect(migration).toContain("payment_revenue_basis as (");
    expect(migration).toContain("when p_business_type = 'cash' then least(");
    expect(migration).toContain("coalesce(p.invoice_vat, 0)");
    expect(migration).toContain("least(coalesce(p.paid_before, 0), coalesce(p.invoice_vat, 0))");
    expect(migration).toContain("sum(p.recognized_net)::numeric recognized_revenue_ex_vat");
    expect(migration).toContain("sum(p.recognized_vat_amount)::numeric recognized_vat");
    expect(migration).toContain("partial payments change paid and outstanding only");
  });
});
