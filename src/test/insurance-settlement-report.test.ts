import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildSettlementReport, filterSettlements, summarizeSettlements, EMPTY_SETTLEMENT_FILTERS,
  type SettlementInvoice, type SettlementPayment, type SettlementClaim } from "@/lib/insuranceSettlementReport";
import { readSettlementPages } from "@/lib/insuranceSettlementService";

const invoice = (p: Partial<SettlementInvoice> = {}): SettlementInvoice => ({ id: "i1", tenant_id: "t1", claim_id: "c1", invoice_number: "INV-26-000001",
  invoice_date: "2026-07-10", issued_at: "2026-09-01T01:00:00Z", insurance_company_name: "Insurer", vehicle_plate: "RW 1620", vehicle_make: "Mitsubishi", vehicle_model: "L200",
  total: 105, paid_amount: 95, settlement_discount_amount: 10, status: "paid", ...p });
const payment = (p: Partial<SettlementPayment> = {}): SettlementPayment => ({ id: "p1", tenant_id: "t1", claim_id: "c1", offset_against_invoice_id: "i1",
  payment_number: "IP-00001", payment_date: "2026-08-12", status: "cleared", settlement_discount_amount: 10, settlement_discount_reason: "Early settlement", settlement_approved_by: "manager1", ...p });
const claim = (p: Partial<SettlementClaim> = {}): SettlementClaim => ({ id: "c1", tenant_id: "t1", claim_number: "CLAIM-1", status: "paid", deleted_at: null, ...p });
const build = (invoices = [invoice()], payments = [payment()], claims = [claim()]) => buildSettlementReport("t1", invoices, payments, claims);

describe("insurance settlement discounts are a read-only invoice-level report", () => {
  it("separates cash from discounts without altering totals or VAT", () => {
    const inputs = [invoice()]; const original = structuredClone(inputs);
    const rows = build(inputs);
    expect(rows[0]).toMatchObject({ total: 105, paid: 95, recordedDiscount: 10, verifiedDiscount: 10, remaining: 0, difference: 0, issues: [] });
    expect(summarizeSettlements(rows)).toMatchObject({ invoices: 1, total: 105, paid: 95, recordedDiscount: 10 });
    expect(inputs).toEqual(original);
  });
  it("deduplicates invoices and payments, and adds no fake receipts", () => {
    expect(summarizeSettlements(build([invoice(), invoice()], [payment(), payment()]))).toMatchObject({ invoices: 1, verifiedDiscount: 10 });
  });
  it.each(["pending", "bounced"])("does not count %s cheque discounts", status => {
    expect(build([invoice()], [payment({ status })])[0]).toMatchObject({ verifiedDiscount: 0, issues: ["invoiceMismatch"] });
  });
  it("requires manager approval and reason", () => {
    expect(build([invoice()], [payment({ settlement_approved_by: null })])[0]).toMatchObject({ verifiedDiscount: 0, issues: ["missingApproval", "invoiceMismatch"] });
    expect(build([invoice()], [payment({ settlement_discount_reason: " " })])[0].issues).toContain("missingApproval");
  });
  it("matches legacy payment only when one active invoice exists", () => {
    expect(build([invoice(), invoice({ id: "old", status: "cancelled" })], [payment({ offset_against_invoice_id: null })])[0].verifiedDiscount).toBe(10);
    const rows = build([invoice(), invoice({ id: "i2", settlement_discount_amount: 0 })], [payment({ offset_against_invoice_id: null })]);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.issues.includes("ambiguousLink") && r.verifiedDiscount === 0)).toBe(true);
  });
  it("requires both invoice and claim to match explicitly", () => {
    expect(build([invoice()], [payment({ claim_id: "unrelated" })])[0].verifiedDiscount).toBe(0);
  });
  it("excludes wrong tenant records even if IDs match", () => {
    expect(build([invoice({ tenant_id: "other" })])).toEqual([]);
    expect(build([invoice()], [payment({ tenant_id: "other" })])[0].verifiedDiscount).toBe(0);
    expect(build([invoice()], [payment()], [claim({ tenant_id: "other" })])[0].issues).toContain("missingClaim");
    expect(() => buildSettlementReport("", [], [], [])).toThrow("TENANT_REQUIRED");
  });
  it.each(["cancelled", "void", "deleted", "draft"])("excludes %s invoices and claims", status => {
    expect(build([invoice({ status })])).toEqual([]);
    expect(build([invoice()], [payment()], [claim({ status })])).toEqual([]);
  });
  it("excludes deleted claims but shows unconfirmed links for review", () => {
    expect(build([invoice()], [payment()], [claim({ deleted_at: "2026-08-01" })])).toEqual([]);
    expect(build([invoice()], [payment()], [])[0].issues).toContain("missingClaim");
  });
  it("shows invoice/payment discrepancies, including discounts missing from invoice aggregate", () => {
    expect(build([invoice({ settlement_discount_amount: 0 })])[0]).toMatchObject({ recordedDiscount: 0, verifiedDiscount: 10, difference: -10, issues: ["invoiceMismatch"] });
  });
  it("sums multiple approved discount events once per invoice in OMR precision", () => {
    const row = build([invoice({ settlement_discount_amount: 0.3 })], [payment({ settlement_discount_amount: 0.1 }), payment({ id: "p2", settlement_discount_amount: 0.2 })])[0];
    expect(row.verifiedDiscount).toBe(0.3); expect(row.difference).toBe(0);
  });
  it("filters invoice date vs actual entered settlement payment date, not creation time", () => {
    const rows = build();
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, from: "2026-07-01", to: "2026-07-31" })).toHaveLength(1);
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, dateBasis: "settlement", from: "2026-07-01", to: "2026-07-31" })).toHaveLength(0);
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, dateBasis: "settlement", from: "2026-08-12", to: "2026-08-12" })).toHaveLength(1);
  });
  it("combines company, text, and review filters", () => {
    const rows = build();
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, search: "rw 1620", company: "Insurer" })).toHaveLength(1);
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, company: "Different" })).toEqual([]);
    expect(filterSettlements(rows, { ...EMPTY_SETTLEMENT_FILTERS, reviewOnly: true })).toEqual([]);
  });
});

describe("complete bounded cloud reads", () => {
  it("reads beyond Supabase's default limit instead of exporting a partial page", async () => {
    const records = Array.from({ length: 1201 }, (_, n) => ({ id: String(n) }));
    const read = vi.fn(async (from, to) => ({ data: records.slice(from, to + 1), error: null, count: records.length }));
    expect(await readSettlementPages(read)).toHaveLength(1201);
    expect(read).toHaveBeenCalledTimes(5);
  });
  it("fails visibly on permissions, missing counts, duplicate pages, and changed totals", async () => {
    await expect(readSettlementPages(async () => ({ data: null, error: { message: "permission denied" }, count: null }))).rejects.toThrow("permission denied");
    await expect(readSettlementPages(async () => ({ data: [], error: null, count: null }))).rejects.toThrow("READ_CHANGED");
    await expect(readSettlementPages(async () => ({ data: [{ id: "1" }, { id: "1" }], error: null, count: 2 }))).rejects.toThrow("READ_CHANGED");
    const rows = Array.from({ length: 250 }, (_, n) => ({ id: String(n) }));
    await expect(readSettlementPages(async from => ({ data: rows, error: null, count: from ? 251 : 300 }))).rejects.toThrow("READ_CHANGED");
  });
  it("aborts instead of publishing data after navigation", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(readSettlementPages(async () => ({ data: [], error: null, count: 0 }), ctrl.signal)).rejects.toThrow();
  });
});
