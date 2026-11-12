// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import "@/lib/i18n/insuranceSettlements";
import { paginateSettlementDocument, settlementExportMatrix, settlementReportHtml, type SettlementColumn } from "@/lib/insuranceSettlementExport";
import type { SettlementReportRow } from "@/lib/insuranceSettlementReport";
const row = (n: number): SettlementReportRow => ({ invoiceId: `i${n}`, claimId: `c${n}`, invoiceNumber: `INV-${n}`, invoiceDate: "2026-07-01", claimNumber: `C-${n}`, company: "Insurer",
  plate: String(n), vehicle: "Car", total: 105, paid: 95, recordedDiscount: 10, verifiedDiscount: 10, difference: 0, remaining: 0, discountPercent: 9.524,
  settlementDates: ["2026-07-20"], paymentNumbers: `IP-${n}`, reasons: "Early settlement", approvers: "manager", issues: [] });
const columns: SettlementColumn[] = ["invoiceNumber", "total", "paid", "recordedDiscount", "discountPercent", "status"];
describe("settlement exports", () => {
  it("exports every matching invoice, selected columns in order, numeric totals without summing percentages", () => {
    const rows = Array.from({ length: 57 }, (_, n) => row(n));
    const matrix = settlementExportMatrix(rows, columns, i18n.getFixedT("en"));
    expect(matrix).toHaveLength(59); expect(matrix[0]).toHaveLength(6);
    expect(matrix[57][0]).toBe("INV-56");
    expect(matrix[58]).toEqual(["Total", 5985, 5415, 570, "", ""]);
    expect(typeof matrix[1][1]).toBe("number");
    expect(() => settlementExportMatrix(rows, [], i18n.getFixedT("en"))).toThrow("COLUMNS_REQUIRED");
  });
  it.each(["en", "ar"])("prints matching columns and totals in %s with escaped data", lang => {
    const data = row(1); data.reasons = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    const html = settlementReportHtml([data], ["invoiceNumber", "reasons", "recordedDiscount", "status"], i18n.getFixedT(lang), lang === "ar", "July 2026");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
    expect(doc.querySelectorAll("script,img")).toHaveLength(0);
    expect(doc.querySelectorAll("thead th")).toHaveLength(4);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(doc.body.textContent).toContain(data.reasons);
    expect(doc.body.textContent).toContain("10.000");
    if (lang === "en") expect(doc.body.textContent).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("uses the shared page margin contract and repeats headers without duplicating totals", () => {
    const html = settlementReportHtml(Array.from({ length: 27 }, (_, n) => row(n)), columns, i18n.getFixedT("en"), false, "All dates");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll(".page")).toHaveLength(2);
    expect(doc.querySelectorAll("thead")).toHaveLength(2);
    expect(doc.querySelectorAll(".report-totals")).toHaveLength(1);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(28);
  });
  it("repaginates wrapped rows only while attached, preserving every row and one totals row", () => {
    const frame = document.createElement("iframe"); document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open(); doc.write(settlementReportHtml(Array.from({ length: 27 }, (_, n) => row(n)), columns, i18n.getFixedT("en"), false, "All dates")); doc.close();
    const proto = (frame.contentWindow as Window & typeof globalThis).HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      expect(this.isConnected).toBe(true);
      const element = this as HTMLElement;
      const height = element.tagName === "FOOTER" ? 100 + (element.closest(".page")?.querySelectorAll("tbody tr").length || 0) * 120 : 794;
      return { top: 0, bottom: height, left: 0, right: 1123, width: 1123, height, x: 0, y: 0, toJSON: () => ({}) };
    };
    try {
      const pages = paginateSettlementDocument(doc);
      expect(pages.length).toBeGreaterThan(2);
      expect(doc.querySelectorAll("tbody tr")).toHaveLength(28);
      expect(doc.querySelectorAll(".report-totals")).toHaveLength(1);
      expect(doc.documentElement.getAttribute("data-pdf-paginated")).toBe("1");
      expect(pages[0].querySelector("[data-settlement-page-number]")?.textContent).toBe(`1 / ${pages.length}`);
    } finally { proto.getBoundingClientRect = original; frame.remove(); }
  });
});
