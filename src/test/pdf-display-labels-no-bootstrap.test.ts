import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";

// Importing a pure display helper must not initialize React, language detection,
// document direction or persisted app settings in a standalone PDF context.
const bootstrap = vi.hoisted(() => vi.fn(() => { throw new Error("PDF_IMPORTED_APP_BOOTSTRAP"); }));
vi.mock("@/i18n", bootstrap);

import { pdfControlledLabel } from "@/lib/pdfDisplayLabels";

const originalLanguage = i18n.language;
afterEach(() => { i18n.language = originalLanguage; });

describe("PDF controlled labels without app bootstrap side effects", () => {
  it("uses explicit language without importing the app initializer", () => {
    expect(pdfControlledLabel("تحت الإصلاح", "workOrderStatus", "en")).toBe("In repair");
    expect(pdfControlledLabel("تحت الإصلاح", "workOrderStatus", "ar")).toBe("تحت الإصلاح");
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "In repair"], ["en-GB", "In repair"], ["ar-OM", "تحت الإصلاح"], ["", "تحت الإصلاح"],
  ])("keeps the existing default language selection for %s", (language, expected) => {
    i18n.language = language;
    expect(pdfControlledLabel("تحت الإصلاح", "workOrderStatus")).toBe(expected);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
