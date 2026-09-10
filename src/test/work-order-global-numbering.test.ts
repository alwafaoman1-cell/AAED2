import { describe, expect, it } from "vitest";
import {
  extractWorkOrderNumber,
  formatWorkOrderNumber,
  isCurrentWorkOrderNumber,
  isSupportedWorkOrderNumber,
  parsedWorkOrderNumberChannel,
  workOrderNumberYear,
  workOrderSequence,
} from "@/lib/workOrderNumber";

describe("global work-order numbering", () => {
  it("formats independent cash and insurance yearly sequences", () => {
    expect(formatWorkOrderNumber(1, "cash", 2026)).toBe("WO-C-26-0001");
    expect(formatWorkOrderNumber(1, "insurance", 2026)).toBe("WO-I-26-0001");
    expect(formatWorkOrderNumber(101, "general_customer", 2027)).toBe("WO-C-27-0101");
    expect(formatWorkOrderNumber(9999, "insurance", 2027)).toBe("WO-I-27-9999");
  });

  it("accepts legacy numbers only for alias compatibility", () => {
    expect(isCurrentWorkOrderNumber("WO-C-26-0001")).toBe(true);
    expect(isCurrentWorkOrderNumber("WO-I-26-0001")).toBe(true);
    expect(isCurrentWorkOrderNumber("WO-00001")).toBe(false);
    expect(isCurrentWorkOrderNumber("WO-2026-0946")).toBe(false);
    expect(isSupportedWorkOrderNumber("WO-00001")).toBe(true);
    expect(isSupportedWorkOrderNumber("WO-2026-0946")).toBe(true);
    expect(extractWorkOrderNumber("/work-orders/WO-2026-0946?tab=parts")).toBe("WO-2026-0946");
    expect(extractWorkOrderNumber("/work-orders/WO-I-26-0101")).toBe("WO-I-26-0101");
  });

  it("parses only canonical typed numbers", () => {
    expect(workOrderSequence("WO-I-26-0101")).toBe(101);
    expect(workOrderNumberYear("WO-I-26-0101")).toBe(2026);
    expect(parsedWorkOrderNumberChannel("WO-I-26-0101")).toBe("insurance");
    expect(parsedWorkOrderNumberChannel("WO-C-27-0002")).toBe("cash");
    expect(workOrderSequence("WO-00101")).toBeNull();
    expect(workOrderSequence("WO-2026-0101")).toBeNull();
  });

  it("fails closed outside the approved sequence range", () => {
    expect(() => formatWorkOrderNumber(0, "cash", 2026)).toThrow();
    expect(() => formatWorkOrderNumber(10000, "cash", 2026)).toThrow();
    expect(() => formatWorkOrderNumber(1, "cash", 2100)).toThrow();
  });
});
