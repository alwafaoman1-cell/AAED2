import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkOrder } from "../lib/workOrdersStore";

const queries: Array<{ table: string; filters: Array<[string, unknown, unknown?]> }> = [];
const rowsByTable = new Map<string, any[]>();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const record = { table, filters: [] as Array<[string, unknown, unknown?]> };
      queries.push(record);
      const builder: Record<string, any> = {};
      for (const method of ["select", "eq", "is", "in", "or"]) {
        builder[method] = (...args: unknown[]) => {
          record.filters.push([method, args[0], args[1]]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => void) => {
        let rows = rowsByTable.get(table) || [];
        for (const [method, field, value] of record.filters) {
          if (method === "eq" && field !== "tenant_id") rows = rows.filter((row) => row[field as string] === value);
          if (method === "in") rows = rows.filter((row) => (value as unknown[]).includes(row[field as string]));
          if (method === "is" && value === null) rows = rows.filter((row) => row[field as string] == null);
        }
        resolve({ data: rows, error: null });
      };
      return builder;
    },
  },
}));

import { fetchWorkOrderInvoiceIndicators, summarizeWorkOrderInvoices } from "../lib/workOrderInvoiceIndicators";

const cashId = "31c5cb43-d784-4302-93aa-d280d311539e";
const insuranceId = "bc87adc1-6b9c-4fb9-aec9-85b52daa798d";
const claimId = "441f0822-b8bf-4005-8e83-34b8aa53e09a";

function order(id: string, kind: "cash" | "insurance"): WorkOrder {
  return {
    id: kind === "cash" ? "WO-C-26-0100" : "WO-I-26-0100",
    cloudId: id,
    displayNumber: kind === "cash" ? "WO-C-26-0100" : "WO-I-26-0100",
    workOrderType: kind === "cash" ? "general_customer" : "insurance",
    claimId: kind === "insurance" ? claimId : undefined,
  } as WorkOrder;
}

describe("work-order invoice indicators", () => {
  it("distinguishes no invoice, issued/unpaid, part-paid and fully paid", () => {
    expect(summarizeWorkOrderInvoices([]).state).toBe("none");
    expect(summarizeWorkOrderInvoices([{ number: "INV", total: 20, paid: 0 }]).state).toBe("unpaid");
    expect(summarizeWorkOrderInvoices([{ number: "INV", total: 20, paid: 5 }]).state).toBe("partial");
    expect(summarizeWorkOrderInvoices([{ number: "INV", total: 20, paid: 20 }]).state).toBe("paid");
    expect(summarizeWorkOrderInvoices([{ number: "INV", total: 20, paid: 15, settlementDiscount: 5 }])).toMatchObject({ state: "paid", paid: 15, settlementDiscount: 5, remaining: 0 });
    expect(summarizeWorkOrderInvoices([
      { number: "INV-1", total: 10, paid: 10 },
      { number: "INV-2", total: 10, paid: 0 },
    ])).toMatchObject({ state: "partial", total: 20, paid: 10, remaining: 10 });
  });

  it("keeps cash sales payments separate from cleared insurance claim payments", async () => {
    queries.length = 0;
    rowsByTable.clear();
    rowsByTable.set("sales_documents", [{
      id: "cash-invoice", tenant_id: "tenant", doc_number: "INV-C", doc_type: "invoice",
      status: "partial", invoice_status: "issued", total: 30, work_order_id: cashId,
      metadata: {}, deleted_at: null,
    }]);
    rowsByTable.set("sales_payments", [{ tenant_id: "tenant", sales_document_id: "cash-invoice", amount: 10 }]);
    rowsByTable.set("insurance_claims", [{
      id: claimId, tenant_id: "tenant", status: "approved", deleted_at: null,
      job_order_id: insuranceId, auto_job_order_id: null,
    }]);
    rowsByTable.set("insurance_invoices", [{
      id: "insurance-invoice", tenant_id: "tenant", claim_id: claimId,
      invoice_number: "INV-I", status: "issued", total: 100, settlement_discount_amount: 0,
    }]);
    rowsByTable.set("claim_payments", [
      { tenant_id: "tenant", claim_id: claimId, amount: 40, status: "pending" },
      { tenant_id: "tenant", claim_id: claimId, amount: 100, status: "cleared" },
    ]);

    const indicators = await fetchWorkOrderInvoiceIndicators("tenant", [order(cashId, "cash"), order(insuranceId, "insurance")]);
    expect(indicators[cashId]).toMatchObject({ state: "partial", paid: 10, remaining: 20, invoiceNumbers: ["INV-C"] });
    expect(indicators[insuranceId]).toMatchObject({ state: "paid", paid: 100, remaining: 0, invoiceNumbers: ["INV-I"] });
    expect(queries.every((query) => query.filters.some(([method, field, value]) => method === "eq" && field === "tenant_id" && value === "tenant"))).toBe(true);
    expect(queries.some((query) => query.table === "sales_documents" && query.filters.some(([method]) => method === "or"))).toBe(true);
  });

  it("does not count cancelled claims or draft cash invoices as issued", async () => {
    queries.length = 0;
    rowsByTable.set("sales_documents", [
      {
        id: "draft", tenant_id: "tenant", doc_number: "DRAFT", doc_type: "invoice",
        status: "draft", invoice_status: "draft", total: 30, work_order_id: cashId,
        metadata: {}, deleted_at: null,
      },
      {
        id: "unissued-legacy", tenant_id: "tenant", doc_number: "UNISSUED", doc_type: "invoice",
        status: "unpaid", invoice_status: null, issued_at: null, total: 30, work_order_id: cashId,
        metadata: {}, deleted_at: null,
      },
    ]);
    rowsByTable.set("insurance_claims", [{
      id: claimId, tenant_id: "tenant", status: "cancelled", deleted_at: null,
      job_order_id: insuranceId, auto_job_order_id: null,
    }]);
    const indicators = await fetchWorkOrderInvoiceIndicators("tenant", [order(cashId, "cash"), order(insuranceId, "insurance")]);
    expect(indicators[cashId].state).toBe("none");
    expect(indicators[insuranceId].state).toBe("none");
  });

  it("fetches page-scoped financial rows and refreshes through the existing realtime channel", () => {
    const page = readFileSync(join(process.cwd(), "src/pages/WorkOrders.tsx"), "utf8");
    const realtime = readFileSync(join(process.cwd(), "src/hooks/useRealtimeSync.ts"), "utf8");
    expect(page).toContain("fetchWorkOrderInvoiceIndicators(profile!.tenant_id, paginatedOrders)");
    expect(page).toContain('key: "invoiceState"');
    expect(realtime).toContain('"claim_payments", "sales_documents", "sales_payments"');
  });
});
