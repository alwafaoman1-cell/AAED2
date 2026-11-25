// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PDF_TEMPLATE_SETTINGS, getInsuranceTaxInvoiceHtml, getQuoteHtml, getWorkOrderHtml, stampSignatureHtml } from "@/lib/pdfGenerator";
import { getClaimEstimateHtml } from "@/lib/insurancePdfTemplates";

vi.mock("@/lib/printTemplates/resolver", () => ({ renderWithCustomTemplate: () => null }));

const workOrder = {
  orderNumber: "WO-100", workOrderType: "insurance" as const, date: "2026-11-25",
  customerName: "Test Customer", customerPhone: "+96890000000", vehicleType: "Toyota", model: "Camry",
  year: "2024", plateNumber: "12345/T", vin: "VIN12345678901234", insurance: "Test Insurance",
  claimNumber: "CL-100", serviceType: "Body repair", technician: "Technician", status: "تحت الإصلاح",
  totalCost: 250, laborCost: 200, partsCost: 50, color: "White", mileage: "12345",
  workItems: [{ title: "Repair bumper", note: "Keep original note" }],
};
const quote = {
  invoiceNumber: "Q-100", quoteNumber: "Q-100", date: "2026-11-25", customerName: "Test Customer",
  vehicleInfo: "Toyota Camry", plateNumber: "12345/T", subtotal: 100, vat: 5, total: 105,
  items: [{ description: "Repair bumper", quantity: 1, unitPrice: 100, total: 100 }],
};
const estimate = {
  claimNumber: "CL-100", estimateNumber: "EST-100", date: "2026-11-25", insuranceCompany: "Test Insurance",
  vehicle: { make: "Toyota", model: "Camry", year: 2024, plate: "12345/T", color: "White", vin: "VIN123" },
  estimationType: "upl" as const, uplItems: [{ description: "Repair bumper", quantity: 2, unit_price: 50 }],
  deductibleAmount: 10, approvedAmount: 90, customerName: "Test Customer", incidentDate: "2026-11-24",
  incidentLocation: "Muscat", policyExpiry: "2027-01-01", adjusterName: "Engineer", notes: "Stored note",
};
const insuranceInvoice: Parameters<typeof getInsuranceTaxInvoiceHtml>[0] = {
  docType: "invoice" as const, template: "default", number: "INV-100", invoiceNumber: "INV-100",
  issueDate: "2026-11-25", customerName: "Test Insurance", insuranceCompany: "Test Insurance",
  claimNumber: "CL-100", vehicleInfo: "Toyota Camry - 2024", vehiclePlate: "12345/T", lpoNumber: "LPO-100",
  customFields: [],
  items: [{ description: "Repair bumper", quantity: 1, unitPrice: 100, discount: 0, tax: 5 }],
  subtotal: 80, discountTotal: 0, taxTotal: 4, total: 84,
};
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (html: string) => parse(html).body.textContent || "";

describe("explicit language for new canonical PDF fallbacks", () => {
  it.each([
    ["work order", () => getWorkOrderHtml(workOrder, "en"), "Authorized Work"],
    ["quote", () => getQuoteHtml(quote, "en"), "Quotation Details"],
    ["claim estimate", () => getClaimEstimateHtml(estimate, "en"), "Estimate Items (UPL)"],
    ["insurance invoice", () => getInsuranceTaxInvoiceHtml(insuranceInvoice, "en"), "TOTAL PAYABLE"],
  ] as const)("renders %s with English labels and LTR", (_name, render, heading) => {
    const html = render(); const document = parse(html);
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.body.textContent).toContain(heading);
    expect(document.body.textContent).not.toMatch(/[\u0600-\u06ff]/);
    expect(document.body.textContent).toContain("12345/T");
  });

  it.each([
    ["work order", () => getWorkOrderHtml(workOrder), () => getWorkOrderHtml(workOrder, "ar")],
    ["quote", () => getQuoteHtml(quote), () => getQuoteHtml(quote, "ar")],
    ["claim estimate", () => getClaimEstimateHtml(estimate), () => getClaimEstimateHtml(estimate, "ar")],
    ["insurance invoice", () => getInsuranceTaxInvoiceHtml(insuranceInvoice), () => getInsuranceTaxInvoiceHtml(insuranceInvoice, "ar")],
  ] as const)("keeps default and explicit Arabic %s content identical and RTL", (name, legacy, arabic) => {
    // Explicit claim estimates add financial-layout protection; saved content
    // stays identical, while callers omitting language retain their old bytes.
    if (name === "claim estimate") expect(parse(arabic()).body.innerHTML).toBe(parse(legacy()).body.innerHTML);
    else expect(arabic()).toBe(legacy());
    const document = parse(arabic());
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.body.textContent).toMatch(/[\u0600-\u06ff]/);
  });

  it("translates controlled work-order status without changing stored names, notes or prices", () => {
    const html = getWorkOrderHtml({ ...workOrder, customerName: "عميل الاختبار", description: "ملاحظة محفوظة" }, "en");
    expect(text(html)).toContain("In repair");
    expect(text(html)).toContain("عميل الاختبار");
    expect(text(html)).toContain("ملاحظة محفوظة");
    expect(text(html)).not.toContain("Financial Agreement");
    expect(text(html)).not.toContain("200.000 OMR");
    expect(text(html)).not.toContain("250.000 OMR");
  });

  it("preserves the cash-work-order agreement and calculated labor balance", () => {
    const html = getWorkOrderHtml({ ...workOrder, workOrderType: "general_customer", depositApplied: 20 }, "en");
    expect(text(html)).toContain("Financial Agreement");
    expect(text(html)).toContain("180.000 OMR");
    expect(text(html)).not.toMatch(/[\u0600-\u06ff]/);
  });

  it("uses persisted insurance totals and original lines instead of recomputing from them", () => {
    const document = parse(getInsuranceTaxInvoiceHtml(insuranceInvoice, "en"));
    expect(document.querySelector(".items .desc")?.textContent).toBe("Repair bumper");
    expect(document.querySelector(".payable .amount")?.textContent).toContain("84.000");
    expect(document.querySelector(".total-line .amount")?.textContent).toBe("80.000");
    expect(document.querySelectorAll(".total-line .amount")[1]?.textContent).toBe("4.000");
    expect(document.body.textContent).toContain("LPO-100");
  });

  it.each(["auto", "lump_sum"] as const)("localizes %s estimate fallback without changing amounts", (estimationType) => {
    const html = getClaimEstimateHtml({ ...estimate, estimationType, lumpSumAmount: 100 }, "en");
    expect(text(html)).not.toMatch(/[\u0600-\u06ff]/);
    expect(text(html)).toContain("90.000 OMR");
    expect(text(html)).toContain(estimationType === "auto" ? "Initial Estimate" : "Lump Sum Estimate");
  });

  it.each(["en", "ar"] as const)("protects all financial rows from A4 flex shrink and clipping in %s", (language) => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    try {
      const frameDocument = iframe.contentDocument!;
      frameDocument.open();
      frameDocument.write(getClaimEstimateHtml(estimate, language));
      frameDocument.close();
      const page = frameDocument.querySelector<HTMLElement>(".claim-estimate-page")!;
      // The paginator applies this fixed height. JSDOM checks the effective
      // cascade, not pixel layout; the generated PDF is visually checked too.
      page.style.height = "1123px";
      const summary = page.querySelector<HTMLElement>(":scope > .totals-box")!;
      const computed = iframe.contentWindow!.getComputedStyle(summary);
      expect(iframe.contentWindow!.getComputedStyle(page).display).toBe("flex");
      expect(computed.flexShrink).toBe("0");
      expect(computed.minHeight).toBe("min-content");
      expect(computed.overflow).toBe("visible");
      // The dedicated estimate has three signing parties. Its explicit
      // language layout must protect those columns from global two-column UI
      // settings so signature wrapping cannot consume the summary's space.
      const signatureRule = Array.from(frameDocument.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
        .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
        .find(rule => rule.selectorText === ".claim-estimate-page > .signature-area");
      expect(signatureRule?.style.getPropertyValue("grid-template-columns")).toBe("repeat(3,minmax(0,1fr))");
      expect(signatureRule?.style.getPropertyPriority("grid-template-columns")).toBe("important");
      const rows = Array.from(summary.querySelectorAll(".totals-row .amount"));
      expect(rows.map(row => row.textContent?.trim())).toEqual(["100.000 OMR", "- 10.000", "90.000", "90.000 OMR"]);
    } finally {
      iframe.remove();
    }
  });

  it("keeps user-supplied quote content escaped", () => {
    const document = parse(getQuoteHtml({ ...quote, customerName: '<img src=x onerror="alert(1)">' }, "en"));
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("uses English stamp titles and image alternatives in explicit English mode", () => {
    const settings = { ...DEFAULT_PDF_TEMPLATE_SETTINGS, stampEnabled: true, stampUrl: "https://example.com/stamp.png" };
    const block = parse(stampSignatureHtml(settings, "quote", "en"));
    expect(block.body.textContent).toContain("SIGNATURE");
    expect(block.body.textContent).toContain("COMPANY STAMP");
    const watermark = parse(stampSignatureHtml({ ...settings, stampPosition: "watermark-center" }, "quote", "en"));
    expect(watermark.querySelector("img")?.alt).toBe("Company stamp");
  });
});
