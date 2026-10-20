import type { ExtractSchema } from "@/lib/aiExtract";
import type { DocumentExtractionResult, ExtractedField } from "./types";
import { DEFAULT_EXTRACTION_POLICY } from "./types";
import { isPurchaseLineField } from "./lineItems";

const ALLOWED_KEYS: Record<ExtractSchema, Readonly<Record<string, string>>> = {
  vehicle_customer: {
    owner_name: "customer_name", owner_phone: "customer_phone", plate_number: "plate_number",
    plate_letters: "plate_letters", make: "make", model: "model", year: "year", color: "color", vin: "vin",
  },
  insurance_claim: {
    insurance_company: "insurance_company", claim_number: "claim_number",
    owner_name: "owner_name", insured_name: "owner_name", owner_phone: "owner_phone",
    plate_number: "plate_number", plate_letters: "plate_letters", plate_country: "plate_country",
    make: "make", model: "model", year: "year", color: "color", vin: "vin",
    accident_date: "incident_date", approved_amount: "estimated_cost",
  },
  expense_receipt: {
    supplier_name: "vendor", invoice_date: "date", invoice_number: "invoice_number",
    total: "total", subtotal: "subtotal", vat: "vat", supplier_vatin: "vat_number",
  },
  purchase_invoice: {
    supplier_name: "supplier_name", supplier_vatin: "supplier_vatin",
    invoice_date: "invoice_date", invoice_number: "invoice_number",
    total: "total", subtotal: "subtotal", vat: "vat",
  },
  estimate_document: {}, spare_part: {}, delivery_receipt: {}, diagnostic_report: {},
};

// Arabic/Latin digit confusion in OCR can produce syntactically valid but wrong IDs.
// Require an explicit click for identifiers, dates and money, regardless of OCR score.
const OCR_CRITICAL_KEYS = new Set([
  "vin", "plate_number", "plate_letters", "year", "claim_number", "lpo_number", "invoice_number",
  "supplier_vatin", "owner_phone", "accident_date", "approval_date", "invoice_date", "lpo_issue_date", "policy_number",
  "registration_date", "registration_expiry", "subtotal", "vat", "discount", "total",
  "approved_amount", "excess", "lpo_parts_amount", "lpo_labour_amount",
]);

export function buildAutofillPayload(
  result: DocumentExtractionResult, schema: ExtractSchema, reviewedValues: Record<string, string | null>,
): Record<string, string> {
  const output: Record<string, string> = {};
  const allowed = ALLOWED_KEYS[schema];
  for (const [sourceKey, targetKey] of Object.entries(allowed)) {
    const value = reviewedValues[sourceKey];
    if (value === undefined || value === null || !result.fields[sourceKey]) continue;
    if (!value.trim()) continue;
    output[targetKey] = value.trim();
  }
  if (schema === "purchase_invoice") for (const [key, value] of Object.entries(reviewedValues)) {
    if (isPurchaseLineField(key) && value?.trim() && result.fields[key]) output[key] = value.trim();
  }
  const number = output.plate_number;
  const letters = output.plate_letters;
  if ((number || letters) && ["vehicle_customer", "insurance_claim"].includes(schema)) {
    output.plate = [letters, number].filter(Boolean).join(" ").trim();
  }
  return output;
}

export function defaultReviewSelection(result: DocumentExtractionResult): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  const typeMismatch = result.issues?.some((issue) => issue.code === "DOCUMENT_TYPE_MISMATCH");
  for (const field of Object.values(result.fields)) {
    selected[field.key] = result.status === "verified"
      ? field.reviewStatus === "accepted" || field.reviewStatus === "corrected"
      : field.validation === "valid" && field.confidence >= DEFAULT_EXTRACTION_POLICY.mediumConfidence
        && !typeMismatch && field.method !== "ai" && !isPurchaseLineField(field.key)
        && !(field.method === "ocr" && OCR_CRITICAL_KEYS.has(field.key));
  }
  return selected;
}

/** Reusing a verified extraction may omit a field, never alter its audited value. */
export function verifiedFieldMayBeApplied(field: ExtractedField, selected: boolean, value: string): boolean {
  if (!selected) return true;
  const verifiedValue = field.reviewStatus === "corrected" ? field.reviewedValue :
    field.reviewStatus === "accepted" ? field.normalizedValue : null;
  return !!verifiedValue && value.trim() === verifiedValue;
}
