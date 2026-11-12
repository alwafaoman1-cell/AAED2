import i18n from "@/i18n";

const messages: Record<string, [string, string]> = {
  CUSTODY_FORBIDDEN: ["لا تملك صلاحية هذا الإجراء على الوصل.", "You do not have permission for this receipt action."],
  CUSTODY_ENTRY_REQUIRED: ["يجب ربط التسليم بزيارة مركبة صالحة.", "Delivery must be linked to a valid vehicle visit."],
  CUSTODY_RECEIPT_REQUIRED: ["تحقق من وصل استلام صالح قبل التسليم.", "Verify a valid intake receipt before delivery."],
  CUSTODY_WRONG_VISIT: ["الوصل لا يخص نفس المركبة والزيارة.", "The receipt belongs to another vehicle or visit."],
  CUSTODY_NOT_VALID: ["الوصل مستخدم أو ملغى أو مستبدل، ولا يمكن تسليم المركبة به.", "The receipt is used, cancelled or replaced and cannot authorize delivery."],
  CUSTODY_LEGACY_FORBIDDEN: ["الاستثناء يحتاج صلاحية خاصة ويقتصر على الزيارات القديمة.", "A legacy exception requires separate permission and a pre-existing visit."],
  CUSTODY_REASON_REQUIRED: ["اكتب سببًا واضحًا من خمسة أحرف على الأقل.", "Enter a clear reason of at least five characters."],
  CUSTODY_SIGNED_REVISION_REQUIRED: ["يجب توقيع الإصدار الحالي من نموذج الدخول أولًا.", "Sign the current intake revision first."],
  CUSTODY_STALE_REVISION: ["تغير نموذج الدخول؛ أعد تحميله وراجعه قبل التوقيع.", "The intake form changed. Reload and review it before signing."],
  CUSTODY_STALE_SIGNATURE_LINK: ["تغير نموذج الدخول؛ اطلب رابط توقيع جديدًا.", "The intake form changed. Request a new signing link."],
  CUSTODY_COMPLETED_VISIT_IMMUTABLE: ["لا يمكن تعديل نموذج زيارة تم تسليمها بوصل مستخدم.", "An intake form already delivered using its receipt is read-only."],
};
export function intakeReceiptError(error: unknown) {
  const message = String((error as { message?: string })?.message || error);
  const code = message.match(/CUSTODY_[A-Z_]+/)?.[0];
  return new Error(code && messages[code] ? messages[code][i18n.language.startsWith("en") ? 1 : 0] : message);
}
