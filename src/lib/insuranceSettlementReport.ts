import { roundMoney } from "@/lib/money";

export interface SettlementInvoice {
  id: string; tenant_id: string; claim_id: string; invoice_number: string;
  invoice_date: string | null; issued_at: string; insurance_company_name: string;
  vehicle_plate: string | null; vehicle_make: string | null; vehicle_model: string | null;
  total: number; paid_amount: number; settlement_discount_amount: number; status: string;
}
export interface SettlementPayment {
  id: string; tenant_id: string; claim_id: string; offset_against_invoice_id: string | null;
  payment_number: string; payment_date: string; status: string;
  settlement_discount_amount: number; settlement_discount_reason: string | null;
  settlement_approved_by: string | null;
}
export interface SettlementClaim {
  id: string; tenant_id: string; claim_number: string; status: string; deleted_at: string | null;
}
export type SettlementIssue = "invoiceMismatch" | "missingApproval" | "ambiguousLink" | "missingClaim";
export interface SettlementReportRow {
  invoiceId: string; claimId: string; invoiceNumber: string; invoiceDate: string;
  claimNumber: string; company: string; plate: string; vehicle: string;
  total: number; paid: number; recordedDiscount: number; verifiedDiscount: number;
  difference: number; remaining: number; discountPercent: number;
  settlementDates: string[]; paymentNumbers: string; reasons: string; approvers: string;
  issues: SettlementIssue[];
}
export interface SettlementFilters {
  search: string; company: string; from: string; to: string;
  dateBasis: "invoice" | "settlement"; reviewOnly: boolean;
}
export const EMPTY_SETTLEMENT_FILTERS: SettlementFilters = {
  search: "", company: "all", from: "", to: "", dateBasis: "invoice", reviewOnly: false,
};
const excluded = new Set(["draft", "cancelled", "canceled", "void", "voided", "deleted", "ineligible"]);
const active = (status: string) => !excluded.has(String(status || "").toLowerCase());

/** Same explicit-invoice / unique-active-invoice association as the official report view.
 * No payment is invented and an ambiguous legacy association is never auto-linked. */
export function buildSettlementReport(
  tenant: string, invoices: SettlementInvoice[], payments: SettlementPayment[], claims: SettlementClaim[],
): SettlementReportRow[] {
  if (!tenant) throw new Error("SETTLEMENT_TENANT_REQUIRED");
  const ownInvoices = [...new Map(invoices.filter(i => i.tenant_id === tenant && active(i.status)).map(i => [i.id, i])).values()];
  const ownClaims = new Map(claims.filter(c => c.tenant_id === tenant).map(c => [c.id, c]));
  const counts = new Map<string, number>();
  ownInvoices.forEach(i => counts.set(i.claim_id, (counts.get(i.claim_id) || 0) + 1));
  const ownPayments = [...new Map(payments.filter(p => p.tenant_id === tenant && p.status === "cleared"
    && Number(p.settlement_discount_amount) > 0).map(p => [p.id, p])).values()];
  return ownInvoices.flatMap(i => {
    const claim = ownClaims.get(i.claim_id);
    if (claim && (!active(claim.status) || claim.deleted_at)) return [];
    const related = ownPayments.filter(p => p.claim_id === i.claim_id);
    const linked = related.filter(p => p.offset_against_invoice_id === i.id
      || (!p.offset_against_invoice_id && counts.get(i.claim_id) === 1));
    const approved = linked.filter(p => p.settlement_approved_by && p.settlement_discount_reason?.trim());
    const recordedDiscount = roundMoney(i.settlement_discount_amount);
    const verifiedDiscount = roundMoney(approved.reduce((n, p) => n + Number(p.settlement_discount_amount), 0));
    const ambiguous = related.some(p => !p.offset_against_invoice_id && counts.get(i.claim_id) !== 1);
    if (recordedDiscount <= 0 && linked.length === 0 && !ambiguous) return [];
    const issues: SettlementIssue[] = [];
    if (!claim) issues.push("missingClaim");
    if (ambiguous) issues.push("ambiguousLink");
    if (approved.length !== linked.length) issues.push("missingApproval");
    const difference = roundMoney(recordedDiscount - verifiedDiscount);
    if (difference !== 0) issues.push("invoiceMismatch");
    return [{
      invoiceId: i.id, claimId: i.claim_id, invoiceNumber: i.invoice_number,
      invoiceDate: i.invoice_date || i.issued_at?.slice(0, 10) || "",
      claimNumber: claim?.claim_number || "", company: i.insurance_company_name || "",
      plate: i.vehicle_plate || "", vehicle: [i.vehicle_make, i.vehicle_model].filter(Boolean).join(" "),
      total: roundMoney(i.total), paid: roundMoney(i.paid_amount), recordedDiscount, verifiedDiscount, difference,
      // This is the stored current invoice balance, not a historical period-end balance.
      remaining: roundMoney(Math.max(0, Number(i.total) - Number(i.paid_amount) - recordedDiscount)),
      discountPercent: Number(i.total) > 0 ? roundMoney(recordedDiscount / Number(i.total) * 100) : 0,
      settlementDates: [...new Set(linked.map(p => p.payment_date))].sort(),
      paymentNumbers: linked.map(p => p.payment_number).join(" / "),
      reasons: [...new Set(linked.map(p => p.settlement_discount_reason?.trim()).filter(Boolean))].join(" / "),
      approvers: [...new Set(linked.map(p => p.settlement_approved_by).filter(Boolean))].join(" / "), issues,
    }];
  }).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.invoiceNumber.localeCompare(a.invoiceNumber));
}

export function filterSettlements(rows: SettlementReportRow[], f: SettlementFilters) {
  const needle = f.search.trim().toLocaleLowerCase();
  const inRange = (date: string) => !!date && (!f.from || date >= f.from) && (!f.to || date <= f.to);
  return rows.filter(r => (!f.company || f.company === "all" || r.company === f.company)
    && (!f.reviewOnly || r.issues.length > 0)
    && (!needle || [r.invoiceNumber, r.claimNumber, r.plate, r.company, r.vehicle, r.reasons, r.paymentNumbers]
      .some(s => s.toLocaleLowerCase().includes(needle)))
    && (!(f.from || f.to) || (f.dateBasis === "invoice" ? inRange(r.invoiceDate) : r.settlementDates.some(inRange))));
}

export function summarizeSettlements(rows: SettlementReportRow[]) {
  const sum = (key: "total" | "paid" | "recordedDiscount" | "verifiedDiscount" | "remaining") =>
    roundMoney(rows.reduce((n, r) => n + r[key], 0));
  return { invoices: rows.length, review: rows.filter(r => r.issues.length > 0).length,
    total: sum("total"), paid: sum("paid"), recordedDiscount: sum("recordedDiscount"),
    verifiedDiscount: sum("verifiedDiscount"), remaining: sum("remaining") };
}
