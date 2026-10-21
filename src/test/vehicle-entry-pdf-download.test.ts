// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { generatePdfFromHtml } = vi.hoisted(() => ({ generatePdfFromHtml: vi.fn().mockResolvedValue(new Blob()) }));

vi.mock("@/lib/htmlToPdf", () => ({
  generatePdfFromHtml,
  DEFAULT_MARGINS: { top: 12, right: 10, bottom: 14, left: 10 },
}));

import { downloadSanitizedPdf } from "@/lib/safePdfWindow";

describe("vehicle entry PDF download", () => {
  it("downloads the sanitized print template with the entry number", async () => {
    await downloadSanitizedPdf(
      '<!doctype html><html><head><style>.page{color:red}</style></head><body><main class="page">Vehicle Entry</main><script>alert(1)</script></body></html>',
      "ENT-2026-00058",
    );

    expect(generatePdfFromHtml).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "ENT-2026-00058",
      download: true,
      margins: { top: 12, right: 10, bottom: 14, left: 10 },
      htmlContent: expect.stringContaining("Vehicle Entry"),
    }));
    const options = generatePdfFromHtml.mock.calls[0][0];
    expect(options.htmlContent).toContain(".page{color:red}");
    expect(options.htmlContent).not.toContain("<script");
  });

  it("refreshes saved entry media before converting the same template to PDF", () => {
    const page = readFileSync("src/pages/vehicle-entry/VehicleEntryDetail.tsx", "utf8");
    expect(page).toContain("await Promise.all([detail.refetch(), getTemplateSettingsAsync()])");
    expect(page).toContain("downloadSanitizedPdf(");
    expect(page).toContain("buildVehicleEntryHtml(refreshed.data)");
    expect(page).toContain('t("vehicleEntry.downloadPdf")');
  });
});
