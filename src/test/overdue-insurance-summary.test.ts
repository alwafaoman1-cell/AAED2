import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchOverdueInsuranceSummary, summarizeOverdueInsurance, OVERDUE_MAX_INVOICES, OVERDUE_PAGE_SIZE,
  type OverdueClaimProjection, type OverdueInvoiceProjection,
} from "@/lib/overdueInsuranceSummary";

type Request = { table: string; projection?: string; count?: string; filters: unknown[][]; range?: number[]; ids?: string[]; signal?: AbortSignal };
const backend = vi.hoisted(() => ({
  requests: [] as Request[],
  reply: (_request: Request): { data: unknown[] | null; error: unknown; count?: number | null } => ({ data: [], error: null, count: 0 }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from(table: string) {
    const request: Request = { table, filters: [] };
    backend.requests.push(request);
    return {
      select(projection: string, options?: { count: string }) { request.projection = projection; request.count = options?.count; return this; },
      eq(...filter: unknown[]) { request.filters.push(["eq", ...filter]); return this; },
      neq(...filter: unknown[]) { request.filters.push(["neq", ...filter]); return this; },
      is(...filter: unknown[]) { request.filters.push(["is", ...filter]); return this; },
      in(_column: string, ids: string[]) { request.ids = ids; return this; },
      order() { return this; },
      range(...range: number[]) { request.range = range; return this; },
      abortSignal(signal: AbortSignal) { request.signal = signal; return Promise.resolve(backend.reply(request)); },
    };
  },
} }));

const now = Date.parse("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const claim = (id = "c1", days = 91, companyId: string | null = "co1"): OverdueClaimProjection => ({
  id, insurance_company_id: companyId, insurance_company: "Legacy name", approved_at: daysAgo(days), created_at: daysAgo(200),
});
const invoice = (id = "i1", claimId = "c1", total = 100): OverdueInvoiceProjection => ({
  id, claim_id: claimId, total, paid_amount: 0, settlement_discount_amount: 0, status: "issued",
});

describe("overdue insurance eligibility", () => {
  it("preserves company terms, strict approval age, grouping and oldest-first order", () => {
    const claims = [claim(), claim("c2", 30), claim("c3", 31), claim("c4", 100, null)];
    const invoices = claims.map((c, index) => invoice(`i${index}`, c.id));
    const result = summarizeOverdueInsurance(claims, invoices, [{ id: "co1", name: "Insurer", payment_terms_days: 30 }], now);
    expect(result).toEqual([
      { companyId: null, name: "Legacy name", termsDays: 90, remaining: 100, oldestDays: 100, claimsCount: 1 },
      { companyId: "co1", name: "Insurer", termsDays: 30, remaining: 200, oldestDays: 91, claimsCount: 2 },
    ]);
  });

  it("subtracts all payments and settlement discounts, includes paid credits and excludes cancellations", () => {
    const invoices = [
      { ...invoice(), paid_amount: 30, settlement_discount_amount: 10 },
      { ...invoice("i2"), status: "cancelled", total: 900 },
      { ...invoice("i3", "c1", 0), status: "paid", paid_amount: 20 },
      invoice("orphan", "invisible-claim", 800),
    ];
    expect(summarizeOverdueInsurance([claim()], invoices, [], now)[0].remaining).toBe(40);
    expect(summarizeOverdueInsurance([claim()], [{ ...invoice(), settlement_discount_amount: 100 }], [], now)).toEqual([]);
    expect(summarizeOverdueInsurance([claim()], [invoice("negative", "c1", -10)], [], now)).toEqual([]);
  });

  it("retains created-at fallback, 90-day default and zero-day terms", () => {
    const c = { ...claim(), approved_at: null, created_at: daysAgo(90) };
    expect(summarizeOverdueInsurance([c], [invoice()], [], now)).toEqual([]);
    expect(summarizeOverdueInsurance([{ ...c, created_at: daysAgo(91) }], [invoice()], [], now)).toHaveLength(1);
    expect(summarizeOverdueInsurance([claim("c1", 1)], [invoice()], [{ id: "co1", name: "Insurer", payment_terms_days: 0 }], now)).toHaveLength(1);
  });

  it("keeps the original one-cent threshold and does not turn invalid input into zero", () => {
    expect(summarizeOverdueInsurance([claim()], [invoice("tiny", "c1", 0.01)], [], now)).toEqual([]);
    expect(summarizeOverdueInsurance([claim()], [invoice("tiny", "c1", 0.011)], [], now)).toHaveLength(1);
    expect(() => summarizeOverdueInsurance([claim()], [{ ...invoice(), total: "unknown" }], [], now)).toThrow("Invalid overdue insurance amount");
    expect(() => summarizeOverdueInsurance([{ ...claim(), approved_at: "bad date" }], [invoice()], [], now)).toThrow("Invalid overdue insurance date");
  });

  it("matches the original nested-loop calculation on representative mixed invoices", () => {
    const claims = Array.from({ length: 15 }, (_, n) => claim(`c${n}`, 20 + n * 10, n % 2 ? "co1" : null));
    const invoices = Array.from({ length: 45 }, (_, n) => ({ ...invoice(`i${n}`, `c${n % 15}`, n + 10),
      paid_amount: n % 5, settlement_discount_amount: n % 3, status: n % 7 ? "issued" : "cancelled" }));
    const expected = new Map<string, { remaining: number; claimsCount: number; oldestDays: number }>();
    for (const c of claims) {
      const rows = invoices.filter((row) => row.claim_id === c.id && row.status !== "cancelled");
      const invoiced = rows.reduce((sum, row) => sum + Number(row.total), 0);
      const remaining = invoiced - rows.reduce((sum, row) => sum + row.paid_amount, 0) - rows.reduce((sum, row) => sum + row.settlement_discount_amount, 0);
      const days = Math.floor((now - Date.parse(c.approved_at!)) / 86_400_000);
      if (invoiced <= 0 || remaining <= 0.01 || days <= 90) continue;
      const key = c.insurance_company_id || c.insurance_company;
      const group = expected.get(key) ?? { remaining: 0, claimsCount: 0, oldestDays: 0 };
      group.remaining += remaining; group.claimsCount++; group.oldestDays = Math.max(group.oldestDays, days); expected.set(key, group);
    }
    const actual = summarizeOverdueInsurance(claims, invoices, [], now);
    expect(actual.map(({ remaining, claimsCount, oldestDays }) => ({ remaining, claimsCount, oldestDays })))
      .toEqual([...expected.values()].sort((a, b) => b.oldestDays - a.oldestDays));
  });
});

describe("bounded RLS-protected overdue projection", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    backend.requests.length = 0;
    backend.reply = () => ({ data: [], error: null, count: 0 });
  });
  afterEach(() => vi.restoreAllMocks());

  it("pages scalar invoices and looks up only their claims/companies in batches", async () => {
    const rows = Array.from({ length: OVERDUE_PAGE_SIZE + 1 }, (_, n) => invoice(`i${n}`, `c${n}`));
    backend.reply = (request) => {
      if (request.table === "insurance_invoices") return { data: rows.slice(request.range![0], request.range![1] + 1), error: null, count: rows.length };
      if (request.table === "insurance_claims") return { data: request.ids!.map((id) => claim(id)), error: null };
      return { data: [{ id: "co1", name: "Insurer", payment_terms_days: 30 }], error: null };
    };
    const controller = new AbortController();
    const result = await fetchOverdueInsuranceSummary("tenant-1", controller.signal);
    expect(result[0].claimsCount).toBe(rows.length);
    expect(backend.requests.filter((r) => r.table === "insurance_invoices")).toHaveLength(2);
    expect(backend.requests.filter((r) => r.table === "insurance_claims").map((r) => r.ids!.length)).toEqual([100, 100, 1]);
    expect(backend.requests.filter((r) => r.table === "insurance_companies")).toHaveLength(1);
    for (const request of backend.requests) {
      expect(request.projection).not.toContain("*");
      expect(request.projection).not.toMatch(/documents|photos|items|customer|vehicle|notes/);
      expect(request.filters).toContainEqual(["eq", "tenant_id", "tenant-1"]);
      expect(request.signal).toBe(controller.signal);
    }
    expect(backend.requests[0].filters).toContainEqual(["neq", "status", "cancelled"]);
    expect(backend.requests.find((r) => r.table === "insurance_claims")!.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("returns confirmed empty without unrelated claim/company reads", async () => {
    expect(await fetchOverdueInsuranceSummary("tenant-1")).toEqual([]);
    expect(backend.requests).toHaveLength(1);
  });

  it("fails visibly at the cap instead of returning a truncated healthy summary", async () => {
    backend.reply = () => ({ data: [], error: null, count: OVERDUE_MAX_INVOICES + 1 });
    await expect(fetchOverdueInsuranceSummary("tenant-1")).rejects.toThrow("safe read limit");
    expect(backend.requests).toHaveLength(1);
  });

  it("rejects missing counts, short pages and duplicate/changing rows", async () => {
    backend.reply = () => ({ data: [], error: null, count: null });
    await expect(fetchOverdueInsuranceSummary("tenant-1")).rejects.toThrow("invoice count");
    backend.reply = () => ({ data: [invoice()], error: null, count: 2 });
    await expect(fetchOverdueInsuranceSummary("tenant-1")).rejects.toThrow("Incomplete");
    backend.reply = () => ({ data: [invoice(), invoice()], error: null, count: 2 });
    await expect(fetchOverdueInsuranceSummary("tenant-1")).rejects.toThrow("changed during the read");
  });

  it.each(["insurance_invoices", "insurance_claims", "insurance_companies"])("propagates %s permission/network errors without a fallback", async (table) => {
    const error = { code: "42501", message: "permission denied" };
    backend.reply = (request) => request.table === table ? { data: null, error } :
      request.table === "insurance_invoices" ? { data: [invoice()], error: null, count: 1 } : { data: [claim()], error: null };
    await expect(fetchOverdueInsuranceSummary("tenant-1")).rejects.toBe(error);
  });

  it("does not escalate RLS-hidden claims into warnings or request company details", async () => {
    backend.reply = (request) => request.table === "insurance_invoices" ? { data: [invoice()], error: null, count: 1 } : { data: [], error: null };
    expect(await fetchOverdueInsuranceSummary("tenant-1")).toEqual([]);
    expect(backend.requests.map((r) => r.table)).toEqual(["insurance_invoices", "insurance_claims"]);
  });
});
