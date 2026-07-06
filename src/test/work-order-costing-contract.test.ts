import { describe, expect, it } from "vitest";
import { splitVatInclusiveAmount, classifyWorkOrderCosts, normalizeInsuranceApprovalAmount, roundMoney } from "@/lib/workOrderCosting";

describe("work order insurance costing", () => {
  it("keeps exact entered money values stable", () => {
    expect(roundMoney(100)).toBe(100);
    expect(roundMoney("100.00")).toBe(100);
    expect(roundMoney(1200)).toBe(1200);
    expect(roundMoney("1,200.00")).toBe(1200);
    expect(roundMoney(1200.0000000001)).toBe(1200);
  });

  it("does not classify lump sum approved amount as spare parts", () => {
    const costs = classifyWorkOrderCosts({
      partsCost: 1200.01,
      laborCost: 0,
      claim: {
        approvedAmount: 1200,
        estimatedAmount: 1200,
        estimationType: "lump_sum",
      },
      partsNeeded: [],
    });

    expect(costs.insuranceApprovedAmount).toBe(1200);
    expect(costs.partsCost).toBe(0);
    expect(costs.laborCost).toBe(0);
    expect(costs.totalCost).toBe(0);
    expect(costs.lumpSumNotItemized).toBe(true);
  });

  it("normalizes one-cent whole approval drift without changing normal decimals", () => {
    expect(normalizeInsuranceApprovalAmount(1200.01)).toBe(1200);
    expect(normalizeInsuranceApprovalAmount(100.01)).toBe(100);
    expect(normalizeInsuranceApprovalAmount(99.95)).toBe(99.95);
    expect(normalizeInsuranceApprovalAmount(1200.5)).toBe(1200.5);
  });

  it("keeps explicit labour and parts categories separate", () => {
    expect(classifyWorkOrderCosts({
      laborCost: 1200,
      partsCost: 0,
      claim: { approvedAmount: 1200, estimationType: "lump_sum" },
    }).laborCost).toBe(1200);

    const withExplicitPart = classifyWorkOrderCosts({
      laborCost: 0,
      partsCost: 1200,
      claim: { approvedAmount: 1200, estimationType: "lump_sum" },
      partsNeeded: [{ id: "p1", name: "Part", quantity: 1, estimatedUnitPrice: 1200 }],
    });
    expect(withExplicitPart.partsCost).toBe(1200);
    expect(withExplicitPart.totalCost).toBe(1200);
  });

  it("treats entered claim approval amounts as VAT-exclusive subtotals", () => {
    expect(splitVatInclusiveAmount(2500)).toEqual({
      subtotalBeforeVat: 2500,
      vatAmount: 125,
      totalIncludingVat: 2625,
    });
    expect(splitVatInclusiveAmount("1,200.00")).toEqual({
      subtotalBeforeVat: 1200,
      vatAmount: 60,
      totalIncludingVat: 1260,
    });
    expect(splitVatInclusiveAmount(100)).toEqual({
      subtotalBeforeVat: 100,
      vatAmount: 5,
      totalIncludingVat: 105,
    });
  });
});
