import { describe, expect, it } from "vitest";
import { invoiceNumberCorrectionError } from "@/lib/invoiceNumberCorrection";

describe("invoice number correction errors", () => {
  it("explains a posted accounting link from a plain PostgREST error object", () => {
    const error = {
      code: "55000",
      details: null,
      hint: null,
      message: "INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED",
    };
    expect(invoiceNumberCorrectionError(error, true))
      .toBe("الفاتورة مرتبطة بقيد محاسبي؛ يلزم مسار تصحيح محاسبي رسمي.");
    expect(invoiceNumberCorrectionError(error, false))
      .toBe("This invoice has an accounting entry; use a formal accounting correction.");
  });

  it("preserves the specific historical-insurance error mapping", () => {
    expect(invoiceNumberCorrectionError({
      code: "55000",
      message: "ONLY_PRE_CUTOVER_NUMERIC_INSURANCE_INVOICES",
    }, true)).toContain("الرقمي");
  });

  it("never renders an object as [object Object]", () => {
    const result = invoiceNumberCorrectionError({
      code: "PGRST203",
      message: "[object Object]",
      details: "internal database details",
    }, true);
    expect(result).toContain("تعذر تصحيح رقم الفاتورة");
    expect(result).toContain("PGRST203");
    expect(result).not.toContain("[object Object]");
    expect(result).not.toContain("internal database details");
  });
});
