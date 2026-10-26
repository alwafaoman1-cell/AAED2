import { describe, expect, it } from "vitest";
import { normalizeLegacyImportDate } from "@/lib/legacyImportDate";

describe("legacy spreadsheet date normalization", () => {
  it.each([
    ["3/9/2026", "2026-09-03"],
    ["3-9-26", "2026-09-03"],
    ["3.9.2026", "2026-09-03"],
  ])("preserves the existing day-first conversion for %s", (input, expected) => {
    expect(normalizeLegacyImportDate(input)).toBe(expected);
  });

  it("does not guess at an unknown date format", () => {
    expect(normalizeLegacyImportDate("2026-09-03")).toBe("2026-09-03");
    expect(normalizeLegacyImportDate("unknown")).toBe("unknown");
  });
});
