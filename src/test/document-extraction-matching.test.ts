import { describe, expect, it } from "vitest";
import { nameSimilarity } from "@/lib/documentExtraction/matching";

describe("tenant-safe matching candidate scoring", () => {
  it("suggests close supplier names but does not treat a typo as an exact identity", () => {
    expect(nameSimilarity("BIN AL SIDDIO", "BIN AL SIDDIQ")).toBeGreaterThan(0.72);
    expect(nameSimilarity("BIN AL SIDDIO", "BIN AL SIDDIQ")).toBeLessThan(1);
    expect(nameSimilarity("شركة قطع الغيار", "شركة قطع الغيار")).toBe(1);
    expect(nameSimilarity("TEST PARTS", "UNRELATED INSURANCE COMPANY")).toBeLessThan(0.72);
  });
});
