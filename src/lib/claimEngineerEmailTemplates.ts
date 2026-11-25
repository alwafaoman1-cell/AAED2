export const CLAIM_ENGINEER_EMAIL_TEMPLATES = [
  "inspection_status", "repair_estimate", "approval_followup", "work_order_update", "invoice_submission", "custom_documents",
] as const;
export type ClaimEngineerEmailTemplateId = typeof CLAIM_ENGINEER_EMAIL_TEMPLATES[number];
export type ClaimEngineerEmailRecipientMode = "engineer" | "owner_test";
export const CLAIM_ENGINEER_OWNER_TEST_EMAIL = "alwafa.oman1@gmail.com";

export type ClaimEngineerEmailDocumentKind = "source_document" | "vehicle_photo" | "repair_estimate" | "quote" | "invoice"
  | "work_order" | "signed_intake" | "technical_declaration";

const names: Record<ClaimEngineerEmailTemplateId, [string, string]> = {
  inspection_status: ["فحص وحالة المركبة", "Vehicle inspection and status"],
  repair_estimate: ["تقدير الإصلاح", "Repair estimate"],
  approval_followup: ["متابعة الموافقة", "Approval follow-up"],
  work_order_update: ["تحديث أمر العمل", "Work order update"],
  invoice_submission: ["إرسال الفاتورة", "Invoice submission"],
  custom_documents: ["مستندات مختارة", "Selected documents"],
};
const categories: Record<ClaimEngineerEmailDocumentKind, [string, string]> = {
  vehicle_photo: ["صور المركبة", "Vehicle photos"],
  signed_intake: ["نموذج الدخول الموقّع", "Signed vehicle intake"],
  source_document: ["أصول المستندات المرفوعة وOCR", "Uploaded and OCR originals"],
  repair_estimate: ["تقدير الإصلاح", "Repair estimate"],
  technical_declaration: ["الإقرار الفني", "Technical declaration"],
  quote: ["عروض الأسعار", "Quotations"],
  work_order: ["أوامر العمل", "Work orders"],
  invoice: ["الفواتير", "Invoices"],
};
export const CLAIM_ENGINEER_DOCUMENT_ORDER: ClaimEngineerEmailDocumentKind[] = [
  "vehicle_photo", "signed_intake", "source_document", "repair_estimate", "technical_declaration", "quote", "work_order", "invoice",
];
export function claimEngineerTemplateLabel(id: ClaimEngineerEmailTemplateId, language: "ar" | "en") {
  return names[id]?.[language === "en" ? 1 : 0] || id;
}
export function claimEngineerDocumentLabel(kind: ClaimEngineerEmailDocumentKind, language: "ar" | "en") {
  return categories[kind]?.[language === "en" ? 1 : 0] || kind;
}
const summarySources: Record<string, [string, string]> = {
  insurance_claim: ["المطالبة", "Claim"], job_order: ["أمر العمل", "Work order"],
  vehicle_entry: ["نموذج الدخول", "Vehicle entry"], inspection: ["تقرير الفحص", "Inspection report"], unknown: ["غير مسجل", "Not recorded"],
};
export function claimEngineerSummarySourceLabel(source: string, language: "ar" | "en") {
  return (summarySources[source] || summarySources.unknown)[language === "en" ? 1 : 0];
}
export function defaultClaimEngineerDocumentSelection<T extends { id: string; kind: ClaimEngineerEmailDocumentKind; defaultSelected?: boolean }>(files: readonly T[]) {
  // The server supplies template-aware defaults. The fallback only supports
  // pre-template packets; financial documents are never silently selected.
  return files.filter(file => file.defaultSelected ?? ["vehicle_photo", "signed_intake", "source_document", "repair_estimate"].includes(file.kind)).map(file => file.id);
}
