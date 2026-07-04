export type PdfV2DocumentType =
  | "cash-invoice"
  | "insurance-invoice"
  | "receipt"
  | "work-order"
  | "claim-report"
  | "vehicle-handover"
  | "qr-label"
  | "statement"
  | "vat-report"
  | "profit-loss"
  | "report"
  | "generic";

export type PdfV2Layout = "a4-portrait" | "a4-landscape" | "qr-label";

export interface PdfV2Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfV2Meta {
  documentType: PdfV2DocumentType;
  documentNumber?: string;
  documentDate?: string;
  title?: string;
  language?: "ar" | "en";
  layout?: PdfV2Layout;
  companyName?: string;
  companyDetails?: string[];
  footerNote?: string;
}

export interface PdfV2BuildInput {
  html: string;
  meta: PdfV2Meta;
}
