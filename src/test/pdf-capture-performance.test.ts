import { describe, expect, it } from "vitest";
import { pdfCaptureScale } from "@/lib/htmlToPdf";

describe("PDF capture performance", () => {
  it("keeps A4 readable and reduces oversized page raster work", () => {
    const a4 = pdfCaptureScale(794, 1123);
    const longPage = pdfCaptureScale(794, 3000);
    expect(a4).toBeGreaterThan(2.4);
    expect(longPage).toBeLessThan(a4);
    expect(longPage).toBeGreaterThanOrEqual(1.5);
    expect(794 * 3000 * longPage ** 2).toBeLessThanOrEqual(5_500_001);
  });
});
