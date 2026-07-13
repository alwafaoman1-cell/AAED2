import { describe, expect, it } from "vitest";
import { getClaimEstimateHtml } from "@/lib/insurancePdfTemplates";

const basePayload = {
  claimNumber: "CLAIM-PDF-001",
  estimateNumber: "ALW-26-00001",
  date: "2026-07-13",
  insuranceCompany: "Test Insurance",
  vehicle: {
    plate: "12345",
    make: "Toyota",
    model: "Camry",
    year: 2026,
    color: "White",
  },
  lumpSumAmount: 100,
};

describe("claim estimate PDF template", () => {
  it("does not stamp or badge automatic initial estimates as UPL or Lump Sum", () => {
    const html = getClaimEstimateHtml({
      ...basePayload,
      estimationType: "auto",
    });

    expect(html).toContain("Initial Estimate");
    expect(html).toContain("تقدير أولي تلقائي");
    expect(html).not.toContain('<div class="estimation-badge"><span>LUMP SUM</span></div>');
    expect(html).not.toContain('<div class="estimation-badge"><span>UPL</span></div>');
    expect(html).not.toContain("Workshop Stamp");
  });

  it("keeps badges and signature area for finalized UPL and Lump Sum estimate types", () => {
    const uplHtml = getClaimEstimateHtml({
      ...basePayload,
      estimationType: "upl",
      uplItems: [{ description: "Labour", quantity: 1, unit_price: 100 }],
    });
    const lumpHtml = getClaimEstimateHtml({
      ...basePayload,
      estimationType: "lump_sum",
    });

    expect(uplHtml).toContain('<div class="estimation-badge"><span>UPL</span></div>');
    expect(uplHtml).toContain("Workshop Stamp");
    expect(lumpHtml).toContain('<div class="estimation-badge"><span>LUMP SUM</span></div>');
    expect(lumpHtml).toContain("Workshop Stamp");
  });
});
