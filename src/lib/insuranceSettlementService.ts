import { supabase } from "@/integrations/supabase/client";
import { buildSettlementReport, type SettlementInvoice, type SettlementPayment, type SettlementClaim } from "./insuranceSettlementReport";

const INVOICE_FIELDS = "id,tenant_id,claim_id,invoice_number,invoice_date,issued_at,insurance_company_name,vehicle_plate,vehicle_make,vehicle_model,total,paid_amount,settlement_discount_amount,status";
const PAYMENT_FIELDS = "id,tenant_id,claim_id,offset_against_invoice_id,payment_number,payment_date,status,settlement_discount_amount,settlement_discount_reason,settlement_approved_by";
const CLAIM_FIELDS = "id,tenant_id,claim_number,status,deleted_at";
const PAGE_SIZE = 250;
type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

/** Exact count and deterministic pages: never present a silently truncated export. */
export async function readSettlementPages<T extends { id: string }>(
  page: (from: number, to: number) => PromiseLike<Page<T>>, signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let offset = 0; offset < 25000; offset += PAGE_SIZE) {
    signal?.throwIfAborted();
    const result = await page(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);
    if (result.count === null || (expected !== null && expected !== result.count)) throw new Error("SETTLEMENT_READ_CHANGED");
    expected = result.count;
    rows.push(...(result.data || []));
    if (rows.length >= expected || !result.data?.length) {
      if (rows.length !== expected || new Set(rows.map(r => r.id)).size !== expected) throw new Error("SETTLEMENT_READ_CHANGED");
      return rows;
    }
  }
  throw new Error("SETTLEMENT_REPORT_TOO_LARGE");
}

export async function fetchSettlementReport(tenant: string, signal?: AbortSignal) {
  if (!tenant) throw new Error("SETTLEMENT_TENANT_REQUIRED");
  const [discountInvoices, payments] = await Promise.all([
    readSettlementPages<SettlementInvoice>((from, to) => supabase.from("insurance_invoices")
      .select(INVOICE_FIELDS, { count: "exact" }).eq("tenant_id", tenant).gt("settlement_discount_amount", 0)
      .order("id").range(from, to).abortSignal(signal), signal),
    readSettlementPages<SettlementPayment>((from, to) => supabase.from("claim_payments")
      .select(PAYMENT_FIELDS, { count: "exact" }).eq("tenant_id", tenant).eq("status", "cleared")
      .gt("settlement_discount_amount", 0).order("id").range(from, to).abortSignal(signal), signal),
  ]);
  const claimIds = [...new Set([...discountInvoices.map(i => i.claim_id), ...payments.map(p => p.claim_id)])];
  const invoices: SettlementInvoice[] = [...discountInvoices];
  const claims: SettlementClaim[] = [];
  // Include all invoices of affected claims, so unique-invoice fallback cannot
  // accidentally attach a legacy payment when another active invoice exists.
  for (let n = 0; n < claimIds.length; n += 100) {
    const ids = claimIds.slice(n, n + 100);
    const [batchInvoices, batchClaims] = await Promise.all([
      readSettlementPages<SettlementInvoice>((from, to) => supabase.from("insurance_invoices")
        .select(INVOICE_FIELDS, { count: "exact" }).eq("tenant_id", tenant).in("claim_id", ids)
        .order("id").range(from, to).abortSignal(signal), signal),
      readSettlementPages<SettlementClaim>((from, to) => supabase.from("insurance_claims")
        .select(CLAIM_FIELDS, { count: "exact" }).eq("tenant_id", tenant).in("id", ids)
        .order("id").range(from, to).abortSignal(signal), signal),
    ]);
    invoices.push(...batchInvoices); claims.push(...batchClaims);
  }
  signal?.throwIfAborted();
  return buildSettlementReport(tenant, invoices, payments, claims);
}
