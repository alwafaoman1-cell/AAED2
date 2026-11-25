import type { ClaimEngineerEmailPacket, ClaimEngineerGeneratedDocument } from "./claimEngineerEmail";
import type { VehicleTechnicalDeclarationForm } from "./vehicleTechnicalDeclaration";

/** Adapts authoritative saved snapshots to existing document renderers. Originals
 * and finalized stored PDFs never pass through this browser rendering path. */
export function claimEngineerGeneratedDocuments(packet: ClaimEngineerEmailPacket): ClaimEngineerGeneratedDocument[] {
  if (packet.generatedDocuments) return packet.generatedDocuments;
  const declaration = packet.technicalDeclaration;
  return declaration ? [{ id: `technical:${declaration.id}`, kind: "technical_declaration", sourceKind: "technical_declaration",
    sourceId: declaration.id, sourceHash: declaration.sourceHash, fileName: declaration.fileName, mimeType: "application/pdf",
    renderer: "technical_declaration", data: { formData: declaration.formData, entryNumber: packet.entryNumber }, defaultSelected: true }] : [];
}

export async function buildClaimEngineerDocumentPdf(document: ClaimEngineerGeneratedDocument, language: "ar" | "en"): Promise<Blob> {
  const data = document.data;
  if (document.renderer === "technical_declaration") {
    const { buildTechnicalDeclarationPdfBlob } = await import("./vehicleTechnicalDeclarationPdf");
    return buildTechnicalDeclarationPdfBlob(data.formData as VehicleTechnicalDeclarationForm, String(data.entryNumber || ""), language);
  }
  let htmlContent: string;
  switch (document.renderer) {
    case "vehicle_entry": {
      const [{ buildVehicleEntryHtml }, { resolveVehicleMediaUrls }] = await Promise.all([
        import("./vehicleEntryService"), import("./vehicleMediaUrls"),
      ]);
      if (!data.entry || typeof data.entry !== "object" || Array.isArray(data.entry)) throw new Error("claim_email_frozen_source_unavailable");
      const frozenEntry = data.entry as Record<string, unknown>;
      // The frozen snapshot stays authoritative. Refresh only its expiring
      // media URLs, exactly as canonical signed-intake reads do; never fetch
      // the current visit or replace a saved signature/revision.
      const printableEntry = { ...frozenEntry,
        vehicle_media: await resolveVehicleMediaUrls(Array.isArray(frozenEntry.vehicle_media) ? frozenEntry.vehicle_media : []),
      };
      htmlContent = buildVehicleEntryHtml(printableEntry, language);
      break;
    }
    case "estimate": {
      const { buildEstimatePdfHtml } = await import("./estimatePdf");
      htmlContent = buildEstimatePdfHtml(data as unknown as Parameters<typeof buildEstimatePdfHtml>[0], language);
      break;
    }
    case "claim_estimate": {
      const { getClaimEstimateHtml } = await import("./insurancePdfTemplates");
      htmlContent = getClaimEstimateHtml(data as unknown as Parameters<typeof getClaimEstimateHtml>[0], language);
      break;
    }
    case "work_order": case "quote": case "insurance_invoice": {
      const pdf = await import("./pdfGenerator");
      await pdf.getTemplateSettingsAsync();
      if (document.renderer === "work_order") htmlContent = pdf.getWorkOrderHtml(data as unknown as Parameters<typeof pdf.getWorkOrderHtml>[0], language);
      else if (document.renderer === "quote") htmlContent = pdf.getQuoteHtml(data as unknown as Parameters<typeof pdf.getQuoteHtml>[0], language);
      else htmlContent = pdf.getInsuranceTaxInvoiceHtml(data as unknown as Parameters<typeof pdf.getInsuranceTaxInvoiceHtml>[0], language);
      break;
    }
    default: throw new Error("claim_email_generated_pdf_invalid");
  }
  const { generatePdfFromHtml } = await import("./htmlToPdf");
  return generatePdfFromHtml({ htmlContent, fileName: document.fileName.replace(/\.pdf$/i, ""), download: false });
}
