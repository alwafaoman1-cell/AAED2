import { describe, expect, it } from "vitest";
import { fixedVehicleEntryCanvasPlacement } from "@/lib/htmlToPdf";

describe("bounded whole-canvas placement for fixed vehicle intake", () => {
  it("fits the actual Production raster including its 30px tail inside one A4 without cropping or distortion", () => {
    const widthPx = 1961, heightPx = 2803;
    const fit = fixedVehicleEntryCanvasPlacement(widthPx, heightPx, 210, 297)!;
    expect(fit).not.toBeNull();
    expect(fit.x).toBeGreaterThan(0);
    expect(fit.y).toBe(0);
    expect(fit.x + fit.width).toBeLessThanOrEqual(210);
    expect(fit.y + fit.height).toBeLessThanOrEqual(297);
    expect(fit.width / fit.height).toBeCloseTo(widthPx / heightPx, 12);
    expect(fit.x).toBeCloseTo((210 - fit.width) / 2, 12);
    expect(fit.width / 210).toBeGreaterThanOrEqual(1 / 1.02);
    // Image coordinates for all four raw raster corners remain on the page.
    for (const [x, y] of [[0, 0], [widthPx, 0], [0, heightPx], [widthPx, heightPx]]) {
      const pageX = fit.x + x * fit.width / widthPx, pageY = fit.y + y * fit.height / heightPx;
      expect(pageX).toBeGreaterThanOrEqual(0); expect(pageX).toBeLessThanOrEqual(210);
      expect(pageY).toBeGreaterThanOrEqual(0); expect(pageY).toBeLessThanOrEqual(297);
    }
  });
  it("accepts exactly 2% overshoot and leaves genuinely longer or already fitting sheets to normal pagination", () => {
    expect(fixedVehicleEntryCanvasPlacement(1000, 1020, 100, 100)).not.toBeNull();
    expect(fixedVehicleEntryCanvasPlacement(1000, 1021, 100, 100)).toBeNull();
    expect(fixedVehicleEntryCanvasPlacement(1000, 1000, 100, 100)).toBeNull();
    expect(fixedVehicleEntryCanvasPlacement(1941, 2832, 210, 297)).toBeNull(); // Different QA margins: 3.17% overflow.
    expect(fixedVehicleEntryCanvasPlacement(794, 1800, 210, 297)).toBeNull();
  });
  it.each([[0, 2803, 210, 297], [1961, -1, 210, 297], [1961, 2803, NaN, 297], [Infinity, 2803, 210, 297]])("rejects invalid dimensions", (width, height, pageWidth, pageHeight) => {
    expect(fixedVehicleEntryCanvasPlacement(width, height, pageWidth, pageHeight)).toBeNull();
  });
});
