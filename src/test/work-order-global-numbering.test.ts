import { describe, expect, it } from "vitest";
import {
  extractWorkOrderNumber,
  formatWorkOrderNumber,
  isCurrentWorkOrderNumber,
  isSupportedWorkOrderNumber,
  workOrderSequence,
} from "@/lib/workOrderNumber";

describe("global work-order numbering", () => {
  it("formats the approved five-digit sequence", () => {
    expect(formatWorkOrderNumber(1)).toBe("WO-00001");
    expect(formatWorkOrderNumber(101)).toBe("WO-00101");
    expect(formatWorkOrderNumber(99999)).toBe("WO-99999");
  });

  it("accepts legacy numbers only for alias compatibility", () => {
    expect(isCurrentWorkOrderNumber("WO-00001")).toBe(true);
    expect(isCurrentWorkOrderNumber("WO-2026-0946")).toBe(false);
    expect(isSupportedWorkOrderNumber("WO-2026-0946")).toBe(true);
    expect(extractWorkOrderNumber("/work-orders/WO-2026-0946?tab=parts")).toBe("WO-2026-0946");
    expect(extractWorkOrderNumber("/work-orders/WO-00101")).toBe("WO-00101");
  });

  it("never treats legacy years as current sequence values", () => {
    expect(workOrderSequence("WO-00101")).toBe(101);
    expect(workOrderSequence("WO-2026-0101")).toBeNull();
  });

  it("fails closed outside the approved sequence range", () => {
    expect(() => formatWorkOrderNumber(0)).toThrow();
    expect(() => formatWorkOrderNumber(100000)).toThrow();
  });
});
