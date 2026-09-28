import { describe, expect, it } from "vitest";
import { getCashInvoiceInsuranceStyleHtml } from "@/lib/pdfGenerator";

describe("cash invoice insurance-style print template", () => {
  it("keeps cash customer data and removes insurance-only labels", () => {
    const html = getCashInvoiceInsuranceStyleHtml({
      docType: "invoice",
      template: "default",
      number: "INV-26-000200",
      invoiceNumber: "INV-26-000200",
      issueDate: "2026-09-27",
      dueDate: "2026-10-27",
      paymentDueDate: "2026-10-27",
      customerName: "Cash Customer",
      customerPhone: "99000000",
      customerAddress: "Muscat, Oman",
      customerTaxNumber: "OM123456789",
      customerCommercialRegistration: "1234567",
      referenceNumber: "WO-C-26-0099",
      vehiclePlate: "12345 AA",
      vehicleInfo: "Toyota - Camry - 2022",
      vehicleVin: "TESTVIN123456789",
      vehicleColor: "White",
      paymentTerms: "Cash",
      customFields: [],
      items: [
        { description: "Workshop service", quantity: 1, unitPrice: 100, discount: 0, tax: 5 },
        { description: "Complimentary inspection", quantity: 1, unitPrice: 0, discount: 0, tax: 0 },
      ],
      subtotal: 100,
      discountTotal: 0,
      taxTotal: 5,
      total: 105,
      qrDataUrl: "data:image/png;base64,TEST",
    });

    expect(html).toContain("INV-26-000200");
    expect(html).toContain("Cash Customer");
    expect(html).toContain("99000000");
    expect(html).toContain("WO-C-26-0099");
    expect(html).toContain("CUSTOMER");
    expect(html).toContain("INVOICE REFERENCE");
    expect(html).toContain("Workshop service");
    expect(html).toMatch(/Complimentary inspection<\/td>\s*<td class="c mono">1\.000<\/td>\s*<td class="c mono">0\.000<\/td>/);
    expect(html).not.toContain("INSURANCE PROVIDER");
    expect(html).not.toContain(">CLAIM<");
    expect(html).not.toContain("LPO -");
  });
});
