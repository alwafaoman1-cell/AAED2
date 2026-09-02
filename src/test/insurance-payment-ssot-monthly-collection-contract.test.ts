import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("insurance payment SSOT and monthly collection contract", () => {
  const migration = read("supabase/migrations/20260826100000_insurance_payment_ssot_and_monthly_collection.sql");
  const verifiedPaymentMigration = read("supabase/migrations/20260827100000_verified_payment_date_monthly_reporting.sql");
  const paymentMonthMigration = read("supabase/migrations/20260902110000_monthly_vehicle_profitability_payment_month_basis.sql");
  const monthly = read("supabase/migrations/20260813100000_monthly_vehicle_profitability_report.sql");
  const editor = read("src/components/insurance/EditInsuranceInvoiceDialog.tsx");
  const accounting = read("src/pages/insurance/InsuranceAccounting.tsx");
  const payments = read("src/hooks/useClaimPayments.ts");

  it("converts only positive legacy paid differences into idempotent payment records", () => {
    expect(migration).toContain("coalesce(i.paid_amount, 0) - coalesce(p.cleared_amount, 0) > 0.001");
    expect(migration).toContain("insert into public.claim_payments");
    expect(migration).toContain("offset_against_invoice_id");
    expect(migration).toContain("LEGACY-PAID:");
    expect(migration).toContain("uq_claim_payments_legacy_reconciliation");
    expect(migration).toContain("on conflict (tenant_id, offset_against_invoice_id, reference_number)");
  });

  it("keeps a traceable inferred collection date and audit entry", () => {
    expect(migration).toContain("i.last_payment_date::date, i.updated_at::date, i.invoice_date");
    expect(migration).toContain("insurance_payment_legacy_reconciled");
    expect(migration).toContain("method_provenance");
  });

  it("prevents invoice paid amount and paid status from bypassing payment SSOT", () => {
    expect(migration).toContain("protect_insurance_invoice_payment_ssot");
    expect(migration).toContain("INSURANCE_PAID_AMOUNT_REQUIRES_PAYMENT_RECORD");
    expect(migration).toContain("INSURANCE_PAYMENT_STATUS_REQUIRES_PAYMENT_RECORD");
    expect(migration).toContain("status = 'cleared'");
    expect(editor).not.toContain("paid_amount: paid");
    expect(editor).toContain("readOnly");
    expect(editor).toContain("يُحدّث تلقائيًا من سندات الدفعات الفعلية");
  });

  it("offers a real linked payment action from insurance invoices", () => {
    expect(accounting).toContain("UnifiedAddPaymentDialog");
    expect(accounting).toContain("openInvoicePayment");
    expect(accounting).toContain("invoiceId: invoice.id");
    expect(accounting).toContain("إضافة دفعة");
  });

  it("uses actual payment dates for insurance and cash collection and refreshes immediately", () => {
    expect(monthly).toContain("p.payment_date between p_from and p_to");
    expect(monthly).toContain("reports_payment_facts_v1");
    expect(monthly).toContain("p.business_type = p_business_type");
    expect(payments).toContain("queryKeys.monthlyVehicleProfitability.all");
  });

  it("does not treat inferred legacy amounts as real monthly collection", () => {
    expect(verifiedPaymentMigration).toContain("status = 'pending'::public.claim_payment_status");
    expect(verifiedPaymentMigration).toContain("not like 'LEGACY-PAID:%'");
    expect(verifiedPaymentMigration).toContain("LEGACY_INFERRED_PAYMENT_REQUIRES_REAL_VOUCHER");
    expect(verifiedPaymentMigration).not.toContain("delete from public.claim_payments");
  });

  it("keeps linked invoice references visible without moving invoice revenue between months", () => {
    expect(verifiedPaymentMigration).toContain("monthly_vehicle_profitability_v2_rpc");
    expect(verifiedPaymentMigration).toContain("monthly_vehicle_profitability_rpc(");
    expect(verifiedPaymentMigration).toContain("invoice_numbers");
    expect(verifiedPaymentMigration).toContain("invoice_dates");
    expect(read("src/lib/accounting/monthlyVehicleProfitability.ts"))
      .toContain('monthly_vehicle_profitability_v2_rpc');
  });

  it("supersedes invoice-date profitability with capped payment-month recognition", () => {
    expect(paymentMonthMigration).toContain("period_payment_recognition as (");
    expect(paymentMonthMigration).toContain("linked_invoice_id");
    expect(paymentMonthMigration).toContain("recognized_revenue_ex_vat");
    expect(paymentMonthMigration).toContain("net of VAT and capped at linked invoice total");
    expect(paymentMonthMigration).not.toContain("period_invoices as (");
  });
});
