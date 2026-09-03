import { describe, expect, it } from "vitest";
import { applyAuthoritativeSalesPayments, type SalesDoc } from "@/lib/salesStore";

function invoice(overrides: Partial<SalesDoc> = {}): SalesDoc {
  return {
    id: "9aa5f93f-a49c-45cb-b857-c9fba58a2245",
    number: "INV-26-000160",
    type: "invoice",
    status: "paid",
    invoiceStatus: "issued",
    customerName: "Customer",
    date: "2026-07-01",
    currency: "OMR",
    items: [],
    subtotal: 100,
    discountTotal: 0,
    taxTotal: 5,
    total: 105,
    paidTotal: 105,
    balanceDue: 0,
    payments: [],
    attachments: [],
    noteEntries: [],
    appointments: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    activity: [],
    ...overrides,
  };
}

describe("sales invoice payment status SSOT", () => {
  it("clears a stale paid badge when no payment rows remain", () => {
    const result = applyAuthoritativeSalesPayments(invoice(), []);
    expect(result.status).toBe("unpaid");
    expect(result.paidTotal).toBe(0);
    expect(result.balanceDue).toBe(105);
  });

  it("derives partial and paid states from actual payment rows", () => {
    const partial = applyAuthoritativeSalesPayments(invoice(), [
      { id: "p1", date: "2026-07-02", amount: 50, method: "cash" },
    ]);
    expect(partial.status).toBe("partial");
    expect(partial.paidTotal).toBe(50);
    expect(partial.balanceDue).toBe(55);

    const paid = applyAuthoritativeSalesPayments(invoice(), [
      { id: "p2", date: "2026-07-02", amount: 105, method: "cash" },
    ]);
    expect(paid.status).toBe("paid");
    expect(paid.balanceDue).toBe(0);
  });

  it("does not revive a cancelled invoice", () => {
    const result = applyAuthoritativeSalesPayments(invoice({ status: "cancelled" }), []);
    expect(result.status).toBe("cancelled");
  });
});
