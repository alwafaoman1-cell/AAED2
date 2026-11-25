import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimEngineerGeneratedDocument } from "@/lib/claimEngineerEmail";
const pdf = vi.hoisted(() => ({ capture: vi.fn(), technical: vi.fn(), intake: vi.fn(), media: vi.fn(), estimate: vi.fn(), claimEstimate: vi.fn(), order: vi.fn(), quote: vi.fn(), invoice: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/htmlToPdf", () => ({ generatePdfFromHtml: pdf.capture }));
vi.mock("@/lib/vehicleTechnicalDeclarationPdf", () => ({ buildTechnicalDeclarationPdfBlob: pdf.technical }));
vi.mock("@/lib/vehicleEntryService", () => ({ buildVehicleEntryHtml: pdf.intake }));
vi.mock("@/lib/vehicleMediaUrls", () => ({ resolveVehicleMediaUrls: pdf.media }));
vi.mock("@/lib/estimatePdf", () => ({ buildEstimatePdfHtml: pdf.estimate }));
vi.mock("@/lib/insurancePdfTemplates", () => ({ getClaimEstimateHtml: pdf.claimEstimate }));
vi.mock("@/lib/pdfGenerator", () => ({ getTemplateSettingsAsync: pdf.settings, getWorkOrderHtml: pdf.order, getQuoteHtml: pdf.quote, getInsuranceTaxInvoiceHtml: pdf.invoice }));
import { buildClaimEngineerDocumentPdf } from "@/lib/claimEngineerEmailDocuments";

function descriptor(renderer: ClaimEngineerGeneratedDocument["renderer"], data: Record<string, unknown>): ClaimEngineerGeneratedDocument {
  return { id: "saved:1", kind: "repair_estimate", sourceKind: "saved", sourceId: "1", sourceHash: "source", fileName: "saved-document.pdf", mimeType: "application/pdf", renderer, data, defaultSelected: false };
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const renderer of [pdf.intake, pdf.estimate, pdf.claimEstimate, pdf.order, pdf.quote, pdf.invoice]) renderer.mockReturnValue("<html>canonical</html>");
  pdf.settings.mockResolvedValue({});
  pdf.media.mockReset().mockImplementation(async rows => rows.map(row => ({ ...row, url: "https://storage.example.test/fresh-signed-photo" })));
  pdf.capture.mockResolvedValue(new Blob(["%PDF canonical"]));
});

describe("saved engineer email PDF adapters", () => {
  it.each(["ar", "en"] as const)("uses the fixed technical renderer and signature unchanged in %s", async language => {
    const form = Object.freeze({ signature_data_url: "data:image/png;base64,c2lnbmVk", authorized_person: "Saved author" });
    const exact = new Blob(["%PDF signed"]); pdf.technical.mockResolvedValue(exact);
    expect(await buildClaimEngineerDocumentPdf(descriptor("technical_declaration", { formData: form, entryNumber: "ENT-1" }), language)).toBe(exact);
    expect(pdf.technical).toHaveBeenCalledExactlyOnceWith(form, "ENT-1", language);
    expect(pdf.capture).not.toHaveBeenCalled();
  });
  it("refreshes frozen intake media URLs on a clone while preserving its saved identity, fields and signature", async () => {
    const media = Object.freeze({ id: "frozen-photo", storage_bucket: "insurance-docs", storage_path: "tenant/frozen-photo.jpg", url: "https://storage.example.test/expired-signed-photo" });
    const signatures = Object.freeze([{ signature_role: "delivered_by", signature_data_url: "data:image/png;base64,c2lnbmVk", intake_revision: 2 }]);
    const frozen = Object.freeze({ id: "frozen-entry", entry_number: "ENT-1", mileage: 123456, intake_revision: 2, vehicle_entry_signatures: signatures, vehicle_media: Object.freeze([media]), custody_print_settings: Object.freeze({ logoUrl: "saved-logo" }) });
    const sourceBefore = JSON.stringify(frozen);
    await buildClaimEngineerDocumentPdf(descriptor("vehicle_entry", { entry: frozen, entryNumber: "ENT-1" }), "en");
    expect(pdf.media).toHaveBeenCalledExactlyOnceWith(frozen.vehicle_media);
    const printable = pdf.intake.mock.calls[0][0];
    expect(printable).not.toBe(frozen);
    expect(printable).toEqual({ ...frozen, vehicle_media: [{ ...media, url: "https://storage.example.test/fresh-signed-photo" }] });
    expect(printable.vehicle_entry_signatures).toBe(signatures);
    expect(printable.custody_print_settings).toBe(frozen.custody_print_settings);
    expect(pdf.intake).toHaveBeenCalledExactlyOnceWith(printable, "en");
    expect(JSON.stringify(frozen)).toBe(sourceBefore);
    expect(pdf.capture).toHaveBeenCalledExactlyOnceWith({ htmlContent: "<html>canonical</html>", fileName: "saved-document", download: false });
    expect(pdf.settings).not.toHaveBeenCalled();
  });
  it.each([
    ["estimate", "estimate"], ["claim_estimate", "claimEstimate"], ["work_order", "order"], ["quote", "quote"], ["insurance_invoice", "invoice"],
  ] as const)("renders %s with the canonical layout and explicit language without recalculating saved amounts", async (renderer, key) => {
    const data = Object.freeze({ subtotal: 99.123, taxTotal: 4.956, total: 104.079, items: [{ description: "Saved line", quantity: 1, unitPrice: 99.123, total: 99.123 }] });
    await buildClaimEngineerDocumentPdf(descriptor(renderer, data), "en");
    expect(pdf[key]).toHaveBeenCalledExactlyOnceWith(data, "en");
    expect(pdf.capture).toHaveBeenCalledWith({ htmlContent: "<html>canonical</html>", fileName: "saved-document", download: false });
    expect(data.total).toBe(104.079);
  });
  it("stops a failed canonical renderer before producing or downloading an incomplete PDF", async () => {
    pdf.intake.mockImplementation(() => { throw new Error("saved signature unavailable"); });
    await expect(buildClaimEngineerDocumentPdf(descriptor("vehicle_entry", { entry: {} }), "ar")).rejects.toThrow("saved signature unavailable");
    expect(pdf.capture).not.toHaveBeenCalled();
  });
  it("does not render or capture a signed intake when frozen media resolution fails", async () => {
    pdf.media.mockRejectedValue(new Error("saved photo unavailable"));
    await expect(buildClaimEngineerDocumentPdf(descriptor("vehicle_entry", { entry: { vehicle_media: [{ storage_path: "tenant/frozen.jpg" }] } }), "en")).rejects.toThrow("saved photo unavailable");
    expect(pdf.intake).not.toHaveBeenCalled();
    expect(pdf.capture).not.toHaveBeenCalled();
  });
});
