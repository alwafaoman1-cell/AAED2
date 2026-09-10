import { describe, expect, it } from "vitest";
import { getWorkOrderHtml } from "@/lib/pdfGenerator";

const base = {
  orderNumber: "WO-00126",
  date: "2026-09-10",
  customerName: "Test Customer",
  customerPhone: "+968 90000000",
  vehicleType: "Toyota",
  model: "Camry",
  year: "2022",
  plateNumber: "OM A 12345",
  vin: "VIN12345678901234",
  insurance: "Dhofar Insurance",
  claimNumber: "206/0502/2026/C/000069",
  serviceType: "Body repair",
  technician: "Workshop Technician",
  status: "تحت الإصلاح",
  totalCost: 250,
  laborCost: 200,
  partsCost: 50,
  depositApplied: 20,
  description: "Stored diagnosis",
  workItems: [{ title: "Front bumper repair", note: "Stored work note" }],
  partsNeeded: [{ name: "Front bumper", quantity: 1, notes: "Stored part note" }],
};

describe("unified work-order print contract", () => {
  it("uses the canonical header and stored work-order fields", () => {
    const html = getWorkOrderHtml({ ...base, workOrderType: "general_customer" });

    expect(html).toContain('class="wo-header"');
    expect(html).toContain("WO-00126");
    expect(html).toContain("Test Customer");
    expect(html).toContain("VIN12345678901234");
    expect(html).toContain("Front bumper repair");
    expect(html).toContain("Front bumper");
    expect(html).not.toContain("Repair Status Timeline");
    expect(html).not.toContain("مسار حالة الإصلاح");
    expect(html).not.toContain("Service Advisor Signature");
  });

  it("never exposes prices, labor charges, VAT, totals, or payments on insurance work orders", () => {
    const html = getWorkOrderHtml({ ...base, workOrderType: "insurance" });

    expect(html).toContain("Dhofar Insurance");
    expect(html).toContain("206/0502/2026/C/000069");
    expect(html).toContain("لا يتضمن أمر عمل التأمين أي أسعار أو أجور أو مبالغ");
    expect(html).not.toContain("Financial Agreement");
    expect(html).not.toContain("Agreed labor charge");
    expect(html).not.toContain("Advance received");
    expect(html).not.toContain("Labor balance");
    expect(html).not.toContain("250.000 OMR");
    expect(html).not.toContain("200.000 OMR");
    expect(html).not.toContain("50.000 OMR");
  });

  it("keeps the same literal header structure for cash and insurance variants", () => {
    const cash = getWorkOrderHtml({ ...base, workOrderType: "general_customer" });
    const insurance = getWorkOrderHtml({ ...base, workOrderType: "insurance" });
    const header = (html: string) => html.match(/<header class="wo-header">[\s\S]*?<\/header>/)?.[0]
      ?.replace("عميل كاش / CASH CUSTOMER", "ORDER TYPE")
      .replace("تأمين / INSURANCE", "ORDER TYPE");

    expect(header(cash)).toBe(header(insurance));
  });
});
