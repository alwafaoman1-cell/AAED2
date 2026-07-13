import { describe, expect, it } from "vitest";
import {
  formatDamageReportNumber,
  getNextDamageReportNumberFromRecords,
  parseDamageReportSequence,
} from "@/lib/inspectionsStore";

describe("inspection damage report numbering", () => {
  it("uses logical DR numbers instead of timestamp suffixes", () => {
    expect(formatDamageReportNumber(1)).toBe("DR-00001");
    expect(formatDamageReportNumber(27)).toBe("DR-00027");
    expect(parseDamageReportSequence("DR-00042")).toBe(42);
    expect(parseDamageReportSequence("DR-749145")).toBeNull();
  });

  it("starts from the count of existing reports while skipping used logical numbers", () => {
    expect(getNextDamageReportNumberFromRecords([])).toBe("DR-00001");
    expect(getNextDamageReportNumberFromRecords([
      { inspection_code: "DR-749145", inspection_kind: "insurance" },
    ])).toBe("DR-00002");
    expect(getNextDamageReportNumberFromRecords([
      { inspection_code: "DR-00001", inspection_kind: "insurance" },
      { inspection_code: "DR-00002", inspection_kind: "insurance" },
      { inspection_code: "DR-749145", inspection_kind: "insurance" },
    ])).toBe("DR-00004");
  });
});
