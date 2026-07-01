import { describe, expect, it } from "vitest";
import {
  formatCurrencyEnglish,
  formatDateEnglish,
  formatDateTimeEnglish,
  formatNumberEnglish,
  normalizeNumericInput,
  normalizePhoneInput,
  normalizePlateInput,
  toEnglishDigits,
} from "@/lib/formatters/numberFormat";
import { normalizePhone } from "@/lib/phoneUtils";
import { extractPlateDigits, formatPlate } from "@/lib/plateUtils";

describe("English digits formatting contract", () => {
  it("converts Arabic-Indic and Persian digits to ASCII English digits only", () => {
    expect(toEnglishDigits("١٢٣٤/٥٦")).toBe("1234/56");
    expect(toEnglishDigits("۱۲۳۴/۵۶")).toBe("1234/56");
    expect(toEnglishDigits("Amount ١٬٥٠٠٫٥٠ OMR")).toBe("Amount 1,500.50 OMR");
  });

  it("normalizes numeric, phone, and plate inputs before save", () => {
    expect(normalizeNumericInput("١٥٠٠٫٥٠")).toBe("1500.50");
    expect(normalizePhoneInput("٩٢٠٥٩٧٠٧")).toBe("92059707");
    expect(normalizePhone("٩٢٠٥٩٧٠٧")).toBe("96892059707");
    expect(extractPlateDigits("١٢٣٤")).toBe("1234");
    expect(formatPlate({ plate_letters: "a", plate_number: "١٢٣٤" })).toBe("A 1234");
    expect(normalizePlateInput("ab ١٢٣٤")).toBe("AB 1234");
  });

  it("formats dates, times, currency, and numbers with English digits", () => {
    expect(formatNumberEnglish(1500.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("1,500.50");
    expect(formatCurrencyEnglish(1500.5)).toBe("1,500.500 OMR");
    expect(formatDateEnglish("2026-07-01")).toBe("01/07/2026");
    expect(formatDateTimeEnglish("2026-07-01T09:05:00Z")).toMatch(/2026/);
    expect(formatDateTimeEnglish("2026-07-01T09:05:00Z")).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  });
});
