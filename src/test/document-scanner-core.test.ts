import { beforeAll, describe, expect, it } from "vitest";
import { assessScanQuality, detectDocumentQuad, isValidScanQuad, perspectiveCorrect, FULL_SCAN_QUAD, type ScanQuad } from "@/lib/documentExtraction/scannerCore";

beforeAll(() => {
  if (!globalThis.ImageData) {
    class TestImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    Object.defineProperty(globalThis, "ImageData", { value: TestImageData, configurable: true });
  }
});

function image(width: number, height: number, document = true): ImageData {
  const result = new ImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const isPaper = document && x >= 50 && x <= width - 50 && y >= 40 && y <= height - 40;
    const value = isPaper ? 228 : 45;
    const offset = (y * width + x) * 4;
    result.data[offset] = result.data[offset + 1] = result.data[offset + 2] = value;
    result.data[offset + 3] = 255;
  }
  return result;
}

function skewedPage(width: number, height: number, quad: ScanQuad): ImageData {
  const result = new ImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = { x: x / width, y: y / height };
    const inside = quad.every((corner, index) => {
      const next = quad[(index + 1) % 4];
      return (next.x - corner.x) * (point.y - corner.y) - (next.y - corner.y) * (point.x - corner.x) >= 0;
    });
    const offset = (y * width + x) * 4;
    result.data[offset] = result.data[offset + 1] = result.data[offset + 2] = inside ? 235 : 32;
    result.data[offset + 3] = 255;
  }
  return result;
}

describe("document scanner image safety", () => {
  it("detects a contrasted document conservatively", () => {
    const result = detectDocumentQuad(image(400, 500));
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.quad[0].x).toBeGreaterThan(0.08);
    expect(result.quad[2].x).toBeLessThan(0.92);
  });

  it("finds four skewed paper corners and rectifies the photographed page", () => {
    const expected: ScanQuad = [
      { x: .19, y: .13 }, { x: .78, y: .17 }, { x: .86, y: .89 }, { x: .12, y: .82 },
    ];
    const source = skewedPage(440, 560, expected);
    const detected = detectDocumentQuad(source);
    expect(detected.confidence).toBeGreaterThan(.35);
    for (let index = 0; index < 4; index++) {
      expect(detected.quad[index].x).toBeCloseTo(expected[index].x, 1);
      expect(detected.quad[index].y).toBeCloseTo(expected[index].y, 1);
    }
    const rectified = perspectiveCorrect(source, detected.quad, "original", 400);
    expect(rectified.width).toBeGreaterThan(200);
    expect(rectified.height).toBeGreaterThan(300);
    const center = (Math.floor(rectified.height / 2) * rectified.width + Math.floor(rectified.width / 2)) * 4;
    expect(rectified.data[center]).toBeGreaterThan(220);
  });

  it("does not mistake dark printed headings inside the paper for document edges", () => {
    const expected: ScanQuad = [
      { x: .19, y: .13 }, { x: .78, y: .17 }, { x: .86, y: .89 }, { x: .12, y: .82 },
    ];
    const source = skewedPage(440, 560, expected);
    for (let y = 165; y < 181; y++) for (let x = 120; x < 320; x++) {
      const offset = (y * source.width + x) * 4;
      source.data[offset] = source.data[offset + 1] = source.data[offset + 2] = 25;
    }
    for (let y = 310; y < 328; y++) for (let x = 145; x < 310; x++) {
      const offset = (y * source.width + x) * 4;
      source.data[offset] = source.data[offset + 1] = source.data[offset + 2] = 25;
    }
    const detected = detectDocumentQuad(source);
    expect(detected.confidence).toBeGreaterThan(.35);
    for (let index = 0; index < 4; index++) {
      expect(Math.abs(detected.quad[index].x - expected[index].x)).toBeLessThan(.06);
      expect(Math.abs(detected.quad[index].y - expected[index].y)).toBeLessThan(.06);
    }
  });

  it("never processes crossed or collapsed manually dragged corners", () => {
    const crossed: ScanQuad = [FULL_SCAN_QUAD[0], FULL_SCAN_QUAD[2], FULL_SCAN_QUAD[1], FULL_SCAN_QUAD[3]];
    expect(isValidScanQuad(crossed)).toBe(false);
    expect(() => perspectiveCorrect(image(400, 500), crossed, "original")).toThrow("SCAN_CORNERS_INVALID");
  });

  it("does not invent a crop for a blank image", () => {
    const result = detectDocumentQuad(image(400, 500, false));
    expect(result.confidence).toBe(0);
    expect(result.quad).toEqual(FULL_SCAN_QUAD);
  });

  it("keeps the full photo when paper is cut off at the frame edge", () => {
    const cutOff: ScanQuad = [
      { x: .005, y: .12 }, { x: .78, y: .14 }, { x: .83, y: .88 }, { x: .005, y: .83 },
    ];
    const detected = detectDocumentQuad(skewedPage(440, 560, cutOff));
    expect(detected.confidence).toBe(0);
    expect(detected.quad).toEqual(FULL_SCAN_QUAD);
  });

  it("does not crop to dark text when the paper and desk have the same colour", () => {
    const source = new ImageData(440, 560);
    for (let index = 0; index < source.data.length; index += 4) {
      source.data[index] = source.data[index + 1] = source.data[index + 2] = 235;
      source.data[index + 3] = 255;
    }
    for (let y = 100; y < 450; y += 28) for (let row = y; row < y + 9; row++) for (let x = 85; x < 355; x++) {
      const offset = (row * source.width + x) * 4;
      source.data[offset] = source.data[offset + 1] = source.data[offset + 2] = 20;
    }
    const detected = detectDocumentQuad(source);
    expect(detected.confidence).toBe(0);
    expect(detected.quad).toEqual(FULL_SCAN_QUAD);
  });

  it("creates a white-safe corrected image without extrapolating resolution", () => {
    const result = perspectiveCorrect(image(400, 500), FULL_SCAN_QUAD, "original", 300);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(300);
    expect(result.data[3]).toBe(255);
  });

  it("flags poor lighting instead of silently accepting it", () => {
    expect(assessScanQuality(image(400, 500, false)).warnings).toContain("low_light");
  });
});
