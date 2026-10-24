import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("historical insurance invoice number correction", () => {
  const migration = read("supabase/migrations/20261024074710_historical_insurance_invoice_number_correction.sql");
  const editor = read("src/components/insurance/EditInsuranceInvoiceDialog.tsx");
  const hook = read("src/hooks/useInsuranceInvoices.ts");

  it("does not renumber any existing invoice while installing the migration", () => {
    expect(migration).toContain("create or replace function public.correct_historical_insurance_invoice_number(");
    expect(migration).not.toMatch(/^update public\.insurance_invoices/im);
    expect(migration).not.toMatch(/^insert into public\.invoice_number_registry/im);
  });

  it("restricts a correction to one authenticated admin, tenant and unchanged numeric source", () => {
    expect(migration).toContain("public.get_user_role()::text <> 'admin'");
    expect(migration).toContain("ii.id = p_invoice_id and ii.tenant_id = v_tenant_id for update");
    expect(migration).toContain("v_invoice.invoice_number is distinct from v_old_number");
    expect(migration).toContain("v_old_number !~ '^[0-9]+$'");
    expect(migration).toContain("v_sequence <> ltrim(v_old_number, '0')::bigint");
  });

  it("reserves only an unused earlier sequence without moving the counter or changing money", () => {
    expect(migration).toContain("v_sequence >= v_next_value");
    expect(migration).toContain("from public.sales_documents");
    expect(migration).toContain("from public.insurance_invoices");
    expect(migration).toContain("from public.invoices");
    expect(migration).toContain("from public.invoice_number_audit_events");
    expect(migration).toContain("'renumbered'");
    expect(migration).toContain("'old_invoice_number', v_old_number");
    expect(migration).toContain("'reason', v_reason");
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.invoice_number_sequences\b/i);
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.invoice_number_registry\b/i);
    expect(migration).not.toMatch(/\b(set|update)\s+(subtotal|total|vat|paid_amount)\b/i);
  });

  it("keeps old-number lookup while preventing a false UI save success", () => {
    expect(migration).toContain("e.details->>'old_invoice_number'");
    expect(editor).toContain("correctNumber.mutateAsync");
    expect(editor).toContain("numberChangeReason.trim().length < 4");
    expect(editor).toContain("otherFieldsEdited");
    expect(hook).toContain("correct_historical_insurance_invoice_number");
    expect(hook).toContain('.select("id")');
    expect(hook).toContain("لم تؤكد قاعدة البيانات حفظ الفاتورة");
    expect(hook).not.toContain("invoice_number: trimmedNumber");
  });
});
