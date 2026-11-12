import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as Array<Record<string, any>>, failClaims: false, rows: {} as Record<string, Array<Record<string, any>>> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from(table: string) {
  const q: Record<string, any> = { table, filters: [], fields: "", from: 0, to: 249 };
  state.queries.push(q);
  const builder = {
    select(fields: string, options: any) { q.fields = fields; q.count = options.count; return builder; },
    eq(k: string, v: any) { q.filters.push((r: any) => r[k] === v); return builder; },
    gt(k: string, v: any) { q.filters.push((r: any) => r[k] > v); return builder; },
    in(k: string, v: any[]) { q.filters.push((r: any) => v.includes(r[k])); return builder; },
    order(key: string) { q.order = key; return builder; },
    range(from: number, to: number) { q.from = from; q.to = to; return builder; },
    abortSignal(signal?: AbortSignal) { q.signal = signal; return builder; },
    then(resolve: (v: any) => any) {
      const rows = (state.rows[table] || []).filter(r => q.filters.every((f: any) => f(r))).sort((a, b) => a.id.localeCompare(b.id));
      return Promise.resolve(resolve({ data: rows.slice(q.from, q.to + 1), count: rows.length,
        error: state.failClaims && table === "insurance_claims" ? { message: "permission denied" } : null }));
    },
  }; return builder;
} } }));
import { fetchSettlementReport } from "@/lib/insuranceSettlementService";
beforeEach(() => {
  state.queries = []; state.failClaims = false;
  state.rows = {
    insurance_invoices: [{ id: "i1", tenant_id: "t1", claim_id: "c1", invoice_number: "INV-1", status: "paid", total: 105, paid_amount: 95,
      settlement_discount_amount: 10, invoice_date: "2026-07-01", insurance_company_name: "Insurer" }],
    claim_payments: [{ id: "p1", tenant_id: "t1", claim_id: "c1", status: "cleared", settlement_discount_amount: 10,
      settlement_approved_by: "a1", settlement_discount_reason: "Approved settlement", payment_date: "2026-07-20" }],
    insurance_claims: [{ id: "c1", tenant_id: "t1", claim_number: "C-1", status: "paid" }],
  };
});
describe("settlement report data path", () => {
  it("reads existing scoped sources with slim selects and no mutating operations", async () => {
    for (const rows of Object.values(state.rows)) rows.push({ ...rows[0], id: "other", tenant_id: "wrong" });
    const result = await fetchSettlementReport("t1");
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ verifiedDiscount: 10, issues: [] });
    expect(state.queries.every(q => q.count === "exact" && q.order === "id" && q.fields !== "*")).toBe(true);
    expect(new Set(state.queries.map(q => q.table))).toEqual(new Set(["insurance_invoices", "insurance_claims", "claim_payments"]));
    expect(state.queries.every(q => !q.fields.includes("archived_at"))).toBe(true);
  });
  it("reads zero-discount invoices of affected claims before deciding unique-invoice fallback", async () => {
    state.rows.insurance_invoices.push({ ...state.rows.insurance_invoices[0], id: "i2", settlement_discount_amount: 0 });
    const result = await fetchSettlementReport("t1");
    expect(result).toHaveLength(2);
    expect(result.every(r => r.issues.includes("ambiguousLink") && r.verifiedDiscount === 0)).toBe(true);
  });
  it("fails the entire report when any dependency cannot be confirmed", async () => {
    state.failClaims = true;
    await expect(fetchSettlementReport("t1")).rejects.toThrow("permission denied");
  });
  it("does not load claims or broad invoices when there are no discounts", async () => {
    state.rows = {};
    expect(await fetchSettlementReport("t1")).toEqual([]);
    expect(state.queries).toHaveLength(2);
  });
});
