export type DocumentType =
  | "vehicle_registration"
  | "insurance_claim"
  | "insurance_approval"
  | "damage_report"
  | "lpo"
  | "customer_id"
  | "supplier_invoice"
  | "purchase_invoice"
  | "expense_receipt"
  | "workshop_document"
  | "quotation"
  | "invoice"
  | "unknown";

export type ExtractionMethod = "native_pdf" | "ocr" | "ai";
export type ProcessingStatus = "uploaded" | "queued" | "processing" | "extracted" | "needs_review" | "verified" | "failed" | "retryable_failed";
export type ValidationStatus = "valid" | "warning" | "invalid" | "unchecked";
export type MatchEntity = "customer" | "vehicle" | "supplier" | "insurance_company" | "invoice" | "claim";

export interface SourceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceSegment {
  text: string;
  box?: SourceBox;
  confidence?: number;
}

export interface DocumentPage {
  number: number;
  text: string;
  method: "native_pdf" | "ocr";
  confidence: number;
  width?: number;
  height?: number;
  segments?: SourceSegment[];
}

export interface ExtractedField {
  key: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  sourcePage: number;
  sourceBox?: SourceBox;
  method: ExtractionMethod;
  validation: ValidationStatus;
  evidence: string[];
  reviewStatus?: "pending" | "accepted" | "corrected" | "rejected";
  reviewedValue?: string | null;
}

export interface ExtractionIssue {
  code: string;
  severity: "info" | "warning" | "error";
  field?: string;
  message: string;
}

export interface EntityMatch {
  entity: MatchEntity;
  id: string;
  label: string;
  confidence: number;
  reason: string;
  exact: boolean;
}

export interface ProcessingTimings {
  nativeMs: number;
  ocrMs: number;
  parseMs: number;
  matchMs: number;
  totalMs: number;
}

export interface DocumentExtractionResult {
  extractionId?: string;
  fileId?: string;
  tenantId: string;
  sha256: string;
  fileName: string;
  mimeType: string;
  documentType: DocumentType;
  documentTypeConfidence: number;
  language: "ar" | "en" | "mixed" | "unknown";
  method: ExtractionMethod;
  rawText: string;
  pages: DocumentPage[];
  fields: Record<string, ExtractedField>;
  issues: ExtractionIssue[];
  matches: EntityMatch[];
  matchingStatus: "complete" | "skipped" | "failed";
  overallConfidence: number;
  needsReview: boolean;
  status: ProcessingStatus;
  aiUsed: boolean;
  timings: ProcessingTimings;
  ocrEngine?: string;
  ocrModelVersion?: string;
  parserVersion?: string;
  profileVersion?: string;
}

export interface ExtractionProgress {
  stage: "validating" | "uploading" | "native" | "ocr" | "parsing" | "matching" | "saving" | "done";
  page?: number;
  totalPages?: number;
  percent?: number;
}

export interface ExtractionPolicy {
  allowAiFallback: boolean;
  aiFallbackBelow: number;
  highConfidence: number;
  mediumConfidence: number;
  maxFileBytes: number;
  maxPdfPages: number;
  nativeMinCharacters: number;
  maxProcessingMs: number;
}

export const DEFAULT_EXTRACTION_POLICY: Readonly<ExtractionPolicy> = Object.freeze({
  allowAiFallback: false,
  aiFallbackBelow: 0.55,
  highConfidence: 0.85,
  mediumConfidence: 0.65,
  maxFileBytes: 12 * 1024 * 1024,
  maxPdfPages: 8,
  nativeMinCharacters: 45,
  maxProcessingMs: 180_000,
});

export const DOCUMENT_ENGINE_VERSION = "1.0.0";
