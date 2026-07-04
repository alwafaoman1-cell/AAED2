import type { PdfV2DocumentType, PdfV2Meta } from "./documentTypes";
import { escapeHtml } from "./pdfFormatters";

const titles: Record<PdfV2DocumentType, string> = {
  "cash-invoice": "Cash Invoice",
  "insurance-invoice": "Insurance Invoice",
  receipt: "Receipt",
  "work-order": "Work Order",
  "claim-report": "Claim Report",
  "vehicle-handover": "Vehicle Handover",
  "qr-label": "QR Label",
  statement: "Statement of Account",
  "vat-report": "VAT Report",
  "profit-loss": "Profit / Loss Report",
  report: "Report",
  generic: "Document",
};

export function normalizePdfV2Meta(partial: Partial<PdfV2Meta> = {}): PdfV2Meta {
  const documentType = partial.documentType || "generic";
  return {
    documentType,
    title: partial.title || titles[documentType],
    language: partial.language || "ar",
    layout: partial.layout || (documentType === "qr-label" ? "qr-label" : "a4-portrait"),
    documentNumber: partial.documentNumber,
    documentDate: partial.documentDate || new Date().toISOString().slice(0, 10),
    companyName: partial.companyName || "شركة الوفاء للأعمال المتكاملة",
    companyDetails: partial.companyDetails || [],
    footerNote: partial.footerNote,
  };
}

export function fallbackPdfV2Body(meta: PdfV2Meta) {
  return `<section class="pdf-v2-card"><h2>${escapeHtml(meta.title)}</h2><p>No document data was provided.</p></section>`;
}
