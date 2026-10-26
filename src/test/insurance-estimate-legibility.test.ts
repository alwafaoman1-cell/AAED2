import { describe, expect, it } from "vitest";
import { getAdvancedDocHtml, getInsuranceEstimateHtml } from "@/lib/pdfGenerator";
import type { InsuranceEstimateData } from "@/lib/pdfGenerator";

const estimate: InsuranceEstimateData = {
  docType: "quote",
  template: "default",
  number: "INS-EST-2026-00074",
  issueDate: "26/10/2026",
  customerName: "Insured Customer",
  insuranceCompany: "Al Madina Takaful",
  claimNumber: "C/004/01/26/2501/00472",
  vehicleInfo: "2022",
  vehiclePlate: "MY 7900",
  customFields: [],
  items: [
    { description: "Spare Parts", quantity: 1, unitPrice: 2400, discount: 0, tax: 0 },
    { description: "Labour Charges", quantity: 1, unitPrice: 200, discount: 0, tax: 0 },
  ],
  subtotal: 2600,
  discountTotal: 0,
  taxTotal: 0,
  total: 2600,
  customTerms: "The required spare parts need to be shipped, with an estimated delivery time of at least 10 days.",
};

describe("insurance estimate legibility", () => {
  it("keeps the exact estimate figures while improving only its own print layout", () => {
    const html = getInsuranceEstimateHtml(estimate);

    expect(html).toContain('class="page insurance-estimate-page"');
    expect(html).toContain(".insurance-estimate-page table{font-size:13px");
    expect(html).toContain(".insurance-estimate-page .totals-row.total .bi .en{color:#fff");
    expect(html).toContain("INS-EST-2026-00074");
    expect(html).toContain("C/004/01/26/2501/00472");
    expect(html).toContain("MY 7900");
    expect(html).toContain("Spare Parts");
    expect(html).toContain("Labour Charges");
    expect(html).toContain("2,400.000 OMR");
    expect(html).toContain("200.000 OMR");
    expect(html).toContain("2,600.000 OMR");
    expect(html).toContain('<div class="estimate-term" dir="auto">');
    expect(html).toContain(estimate.customTerms);
  });

  it("does not apply estimate-specific styling to other PDF documents", () => {
    const html = getAdvancedDocHtml({
      docType: "quote",
      template: "default",
      number: "Q-001",
      issueDate: "26/10/2026",
      customerName: "Customer",
      customFields: [],
      items: [],
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      total: 0,
    });

    expect(html).not.toContain("insurance-estimate-page");
    expect(html).not.toContain("getInsuranceEstimateStyles");
  });
});
