export type ClaimEmailTemplateId = "inspection_status" | "repair_estimate" | "approval_followup" | "work_order_update" | "invoice_submission" | "custom_documents";
export type ClaimEmailRecipientMode = "engineer" | "owner_test";
export const CLAIM_EMAIL_OWNER_TEST_ADDRESS = "alwafa.oman1@gmail.com";
export interface ClaimEmailSummaryField { key: string; label: string; value: string; source: string }
const TEMPLATES = [
  ["inspection_status", "الفحص وحالة المركبة", "Inspection and vehicle status", "إرسال الفحص والحالة المسجلة والملفات المحددة.", "Send recorded inspection/status and selected files.", true],
  ["repair_estimate", "تقدير الإصلاح", "Repair estimate", "مراجعة تقدير الإصلاح والمستندات المرتبطة.", "Review the repair estimate and related documents.", true],
  ["approval_followup", "متابعة الاعتماد", "Approval follow-up", "طلب مراجعة المطالبة دون تغيير حالتها.", "Request claim review without changing its status.", true],
  ["work_order_update", "تحديث أمر العمل", "Work order update", "مشاركة مرحلة العمل والحالة المسجلة.", "Share saved work stage and vehicle status.", false],
  ["invoice_submission", "إرسال فاتورة التأمين", "Insurance invoice submission", "إرسال فواتير التأمين المرتبطة فقط.", "Send only linked insurance invoices.", false],
  ["custom_documents", "مستندات محددة", "Selected documents", "إرسال الملفات التي تم اختيارها.", "Send the documents explicitly selected.", false],
] as const;
export function claimEmailTemplateId(value: unknown): ClaimEmailTemplateId {
  if (value === undefined || value === null || value === "") return "inspection_status";
  if (!TEMPLATES.some(template => template[0] === value)) throw Object.assign(new Error("claim_email_invalid_template"), { code: "claim_email_invalid_template" });
  return value as ClaimEmailTemplateId;
}
export function claimEmailTemplates(language: "ar" | "en") {
  return TEMPLATES.map(([id, ar, en, arDescription, enDescription, defaultTechnical]) => ({ id, label: language === "en" ? en : ar, description: language === "en" ? enDescription : arDescription, defaultTechnical }));
}
export function claimEmailSourceText(value: unknown, language: "ar" | "en", fallback?: string): string {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!text) return fallback || (language === "en" ? "Not recorded" : "غير مسجل");
  if (language === "en" && /[\u0600-\u06ff]/.test(text)) return "Recorded in Arabic; refer to the original document.";
  return text.slice(0, 1800);
}
export function claimEmailControlled(value: unknown, language: "ar" | "en", map: Record<string, [string, string]>): string {
  const pair = map[String(value || "")];
  return pair ? pair[language === "en" ? 1 : 0] : claimEmailSourceText(value, language);
}
export function claimEmailBody(packet: { subject: string; entryNumber: string; recipient: { name: string }; statusSummary?: ClaimEmailSummaryField[]; templateId?: ClaimEmailTemplateId }, language: "ar" | "en") {
  const template = claimEmailTemplates(language).find(item => item.id === packet.templateId) || claimEmailTemplates(language)[0];
  const text = language === "en"
    ? [`Dear ${claimEmailSourceText(packet.recipient.name, language, "Insurance representative")},`, "", `${template.label}: ${packet.subject}`, "Please find the selected files attached. The following information is taken from saved system records:", `Vehicle entry: ${packet.entryNumber}`]
    : [`السيد/السيدة ${packet.recipient.name || "ممثل شركة التأمين"}،`, "", `${template.label}: ${packet.subject}`, "نرفق الملفات المحددة. المعلومات التالية مأخوذة من السجلات المحفوظة في النظام:", `دخول المركبة: ${packet.entryNumber}`];
  for (const field of packet.statusSummary || []) text.push(`${field.label}: ${field.value}`);
  text.push("", language === "en" ? "Kind regards," : "مع التحية،", language === "en" ? "Al Wafa Auto" : "الوفاء للسيارات");
  return text.join("\n");
}
