import { beforeAll, describe, expect, it } from "vitest";
import { assessScanQuality, detectDocumentQuad, perspectiveCorrect, FULL_SCAN_QUAD } from "@/lib/documentExtraction/scannerCore";

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

describe("document scanner image safety", () => {
  it("detects a contrasted document conservatively", () => {
    const result = detectDocumentQuad(image(400, 500));
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.quad[0].x).toBeGreaterThan(0.08);
    expect(result.quad[2].x).toBeLessThan(0.92);
  });

  it("does not invent a crop for a blank image", () => {
    const result = detectDocumentQuad(image(400, 500, false));
    expect(result.confidence).toBe(0);
    expect(result.quad).toEqual(FULL_SCAN_QUAD);
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
