import { describe, expect, it } from "vitest";
import { normalizeIntakeSignerIdentity } from "@/lib/intakeSignerIdentity";

describe("actual intake deliverer identity", () => {
  it("trims identity text while preserving leading zeros and alphanumeric passport content", () => {
    expect(normalizeIntakeSignerIdentity("  مُسلّم المركبة الفعلي  ", "  ۰۰٠A١٢-09  ")).toEqual({ fullName: "مُسلّم المركبة الفعلي", idNumber: "000A12-09", valid: true });
    expect(normalizeIntakeSignerIdentity("Actual Deliverer", "000AB001").idNumber).toBe("000AB001");
  });
  it("accepts the stated maximum lengths, counted as Unicode characters", () => {
    expect(normalizeIntakeSignerIdentity("أ".repeat(160), "0".repeat(80)).valid).toBe(true);
    expect(normalizeIntakeSignerIdentity("𐐀".repeat(160), "AB0001").valid).toBe(true);
    expect(normalizeIntakeSignerIdentity("أ".repeat(161), "AB0001").valid).toBe(false);
    expect(normalizeIntakeSignerIdentity("Actual Deliverer", "0".repeat(81)).valid).toBe(false);
  });
  it.each([["", "00A1"], ["   ", "00A1"], ["Actual Deliverer", ""], ["Actual Deliverer", "\u00a0  "]])("requires both non-whitespace fields (%j / %j)", (name, idNumber) => {
    expect(normalizeIntakeSignerIdentity(name, idNumber).valid).toBe(false);
  });
  it.each(["\u0000", "\u0009", "\u001f", "\u007f", "\u0085", "\u009f"])("rejects embedded C0/C1 control character %j in either identity field", control => {
    expect(normalizeIntakeSignerIdentity(`Actual${control}Deliverer`, "00AB1").valid).toBe(false);
    expect(normalizeIntakeSignerIdentity("Actual Deliverer", `00${control}AB1`).valid).toBe(false);
  });
});
