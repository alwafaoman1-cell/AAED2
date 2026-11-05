import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), data: {} as Record<string, unknown>, error: null as Error | null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc } }));

import { fetchAllMonthlyVehicleProfitabilityRows, fetchMonthlyVehicleProfitability } from "@/lib/accounting/monthlyVehicleProfitability";

const filters = { from: "2026-11-01", to: "2026-11-30", businessType: "cash" as const,
  search: "", page: 1, pageSize: 50 };

beforeEach(() => {
  db.rpc.mockReset();
  db.error = null;
  db.data = {
    rows: [{ parts_revenue: 0.305, parts_cost: 0.3, vat: 0.005, collected: 0.11,
      recognized_revenue_ex_vat: 0.1, gross_profit: 0.05 }],
    aggregates: { parts_revenue: 0.305, parts_cost: 0.31, vat: 0.005, collected: 0.11 },
    overheads: { total: 20 }, pagination: { totalRows: 1, totalPages: 1 }, basis: "payment month",
  };
  db.rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: db.data, error: db.error }) }));
});

describe("monthly profitability service boundaries", () => {
  it.each(["cash", "insurance"] as const)("passes the %s channel and period unchanged to the authoritative RPC", async (businessType) => {
    await fetchMonthlyVehicleProfitability({ ...filters, businessType });
    expect(db.rpc).toHaveBeenCalledWith("monthly_vehicle_profitability_v3_rpc", {
      p_from: filters.from, p_to: filters.to, p_business_type: businessType,
      p_search: null, p_page: 1, p_page_size: 50,
    });
  });

  it("rounds parts profit to baisa without re-recognizing collected money or VAT as profit", async () => {
    const result = await fetchMonthlyVehicleProfitability(filters);
    expect(result.rows[0]).toMatchObject({ parts_profit: 0.005, vat: 0.005, collected: 0.11,
      recognized_revenue_ex_vat: 0.1, gross_profit: 0.05 });
    expect(result.aggregates).toMatchObject({ parts_profit: -0.005, vat: 0.005, collected: 0.11 });
    expect(result.overheads.total).toBe(20);
    expect((db.data.rows as Array<Record<string, unknown>>)[0]).not.toHaveProperty("parts_profit");
  });

  it("propagates an RPC/RLS failure instead of returning an apparently empty successful report", async () => {
    db.error = new Error("report access denied");
    await expect(fetchMonthlyVehicleProfitability(filters)).rejects.toThrow("report access denied");
  });

  it("rejects malformed pagination instead of exporting a successful empty report", async () => {
    db.data = { rows: [] };
    await expect(fetchAllMonthlyVehicleProfitabilityRows(filters)).rejects.toThrow("MONTHLY_REPORT_INVALID_RESPONSE");
  });

  function pagedResponses(second: Record<string, unknown> = {}) {
    let call = 0;
    db.rpc.mockImplementation(() => ({ abortSignal: async () => {
      call += 1;
      return { error: null, data: {
        aggregates: { collected: 501 },
        rows: call === 1 ? Array.from({ length: 500 }, (_, i) => ({ operation_id: `operation-${i}` })) : [{ operation_id: "operation-500" }],
        pagination: { totalRows: 501, totalPages: 2 },
        ...(call === 1 ? {} : second),
      } };
    } }));
  }

  it("exports all pages and retains the original business/date filter", async () => {
    pagedResponses();
    expect(await fetchAllMonthlyVehicleProfitabilityRows(filters)).toHaveLength(501);
    expect(db.rpc).toHaveBeenLastCalledWith("monthly_vehicle_profitability_v3_rpc", expect.objectContaining({
      p_from: filters.from, p_to: filters.to, p_business_type: "cash", p_page: 2, p_page_size: 500,
    }));
  });
  it.each([
    [{ pagination: { totalRows: 502, totalPages: 2 } }, "MONTHLY_REPORT_SET_CHANGED_DURING_EXPORT"],
    [{ aggregates: { collected: 999 } }, "MONTHLY_REPORT_SET_CHANGED_DURING_EXPORT"],
    [{ rows: [] }, "MONTHLY_REPORT_EXPORT_INCOMPLETE"],
    [{ rows: [{ operation_id: "operation-0" }] }, "MONTHLY_REPORT_DUPLICATE_EXPORT_ROW"],
  ])("rejects changed, truncated or repeated financial exports", async (second, code) => {
    pagedResponses(second as Record<string, unknown>);
    await expect(fetchAllMonthlyVehicleProfitabilityRows(filters)).rejects.toThrow(code as string);
  });
  it("reports the safety limit explicitly rather than silently truncating a large export", async () => {
    db.data = { rows: [], aggregates: {}, pagination: { totalRows: 100001, totalPages: 201 } };
    await expect(fetchAllMonthlyVehicleProfitabilityRows(filters)).rejects.toThrow("MONTHLY_REPORT_EXPORT_LIMIT_EXCEEDED");
  });
});

