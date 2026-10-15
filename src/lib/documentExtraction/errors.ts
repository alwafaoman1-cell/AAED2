import { DocumentFileError } from "./fileSafety";
import type { ExtractionIssue } from "./types";

const MESSAGES: Record<string, [string, string]> = {
  DOCUMENT_SIZE_INVALID: ["حجم الملف غير مقبول؛ الحد الأقصى 12 ميغابايت.", "Invalid file size; maximum 12 MB."],
  DOCUMENT_UNSUPPORTED: ["نوع المستند غير مدعوم أو غير مقروء.", "Unsupported or unreadable document."],
  DOCUMENT_MIME_MISMATCH: ["محتوى الملف لا يطابق نوعه المعلن.", "File contents do not match the declared type."],
  DOCUMENT_EXTENSION_MISMATCH: ["امتداد الملف لا يطابق محتواه.", "File extension does not match its contents."],
  DOCUMENT_PDF_UNREADABLE: ["تعذرت قراءة PDF؛ قد يكون تالفًا أو محميًا.", "Could not read the PDF; it may be damaged or protected."],
  DOCUMENT_PAGE_LIMIT: ["عدد صفحات PDF يتجاوز الحد المسموح.", "The PDF exceeds the page limit."],
  DOCUMENT_IMAGE_UNREADABLE: ["تعذرت قراءة الصورة؛ جرّب ملفًا أوضح.", "Could not read the image; try a clearer file."],
  DOCUMENT_HASH_UNAVAILABLE: ["المتصفح لا يدعم التحقق الآمن من الملف.", "This browser cannot securely verify the file."],
  DOCUMENT_TENANT_MISMATCH: ["لا يمكن ربط المستند بالورشة الحالية؛ أعد تسجيل الدخول.", "Document and workshop do not match; sign in again."],
  DOCUMENT_PROCESSING_IN_PROGRESS_RETRY_LATER: ["المستند قيد المعالجة في جلسة أخرى؛ حاول لاحقًا.", "The document is being processed in another session; retry later."],
  DOCUMENT_PREVIOUS_PROCESSING_FAILED_RETRY: ["فشلت معالجة سابقة للمستند؛ أعد المحاولة.", "A previous extraction failed; retry the document."],
  DOCUMENT_PROCESSING_TIMEOUT: ["انتهت مهلة قراءة المستند؛ احتُفظ بالملف إن اكتمل رفعه. أعد المحاولة لاحقًا.", "Document processing timed out. If upload completed, the file was retained; retry later."],
  DOCUMENT_PROCESSING_CANCELLED: ["أُلغيت معالجة المستند؛ لم تُطبّق بيانات على النموذج.", "Document processing was cancelled; no form data was applied."],
  DOCUMENT_WORKER_REQUIRED: ["قراءة المطالبات وفواتير الشراء تتطلب عامل المعالجة على Development؛ أدخل البيانات يدويًا حتى يصبح متاحًا.", "Claim and purchase invoice extraction requires the Development worker; enter the data manually until it is available."],
};

/** Never send a raw PostgREST/SQL/worker exception to the operator. */
export function documentErrorMessage(error: unknown, english: boolean): string {
  const code = error instanceof DocumentFileError ? error.code : error instanceof Error ? error.message : "";
  const safe = MESSAGES[code];
  if (safe) return safe[english ? 1 : 0];
  return english
    ? "Document processing failed. No customer, vehicle, claim or expense was saved. Retry or enter the data manually."
    : "تعذرت معالجة المستند. لم يُنشأ عميل أو مركبة أو مطالبة أو مصروف. أعد المحاولة أو أدخل البيانات يدويًا.";
}

const ARABIC_ISSUES: Record<string, string> = {
  DOCUMENT_TYPE_MISMATCH: "نوع المستند يختلف عن المتوقع لهذا النموذج؛ راجعه قبل تطبيق أي حقل.",
  NO_FIELDS_RECOGNIZED: "لم تُستخرج حقول موثوقة؛ راجع الملف يدويًا.",
  VAT_TOTAL_MISMATCH: "الإجمالي لا يساوي المبلغ قبل الضريبة مع الضريبة والخصم؛ راجع الأرقام دون تعديل تلقائي.",
  VIN_FORMAT_INVALID: "صيغة رقم الهيكل غير صالحة؛ تحقق منه في المستند.",
  DATE_INVALID: "التاريخ غير صالح أو غير واضح؛ أدخله يدويًا.",
  AMOUNT_INVALID: "المبلغ غير واضح أو غير صالح؛ راجعه يدويًا.",
  YEAR_INVALID: "سنة الصنع غير صالحة؛ راجعها يدويًا.",
  PLATE_INVALID: "رقم اللوحة غير واضح؛ راجع الرقم والحروف والدولة.",
  PLATE_CODE_INVALID: "حروف اللوحة غير واضحة؛ راجعها يدويًا.",
  PHONE_INVALID: "رقم الهاتف غير صالح؛ راجعه يدويًا.",
  FIELD_INVALID: "تعذر التحقق من أحد الحقول؛ راجعه يدويًا.",
  OCR_FAILED: "تعذرت قراءة الصورة؛ المستند باقٍ ويمكن إرفاقه دون تعبئة تلقائية.",
  OCR_NO_TEXT: "لم يظهر نص مقروء في إحدى الصفحات؛ راجعها يدويًا.",
  DATABASE_MATCH_FAILED: "تعذرت مطابقة السجلات؛ تحقق من التكرار يدويًا قبل الحفظ.",
  VEHICLE_IDENTITY_CONFLICT: "رقم الهيكل واللوحة يطابقان مركبتين مختلفتين؛ أوقف الإنشاء وراجع الهوية.",
  PLATE_IDENTITY_INCOMPLETE: "حروف اللوحة ناقصة؛ تحقق من الرقم والحروف والدولة.",
  SUPPLIER_VATIN_NOT_MATCHED: "اسم المورد مطابق، لكن الرقم الضريبي مختلف؛ راجعه قبل الربط.",
  DUPLICATE_CLAIM_SUSPECTED: "رقم المطالبة موجود؛ افتح المطالبة بدل إنشاء نسخة أخرى.",
  DUPLICATE_INVOICE_SUSPECTED: "توجد فاتورة لهذا المورد بنفس الرقم؛ راجعها قبل الحفظ.",
  DUPLICATE_EXPENSE_RECEIPT_SUSPECTED: "فاتورة المورد مرتبطة بمصروف موجود؛ راجعه قبل الحفظ.",
  EXTERNAL_AI_USED: "استُخدم مزود ذكاء اصطناعي خارجي بعد الاستخراج المحلي؛ راجع كل حقل.",
  AI_FALLBACK_FAILED: "تعذر الاستخراج عبر المزود الخارجي؛ أكمل المراجعة يدويًا.",
  LINE_ITEMS_UNRELIABLE: "بنود فاتورة الشراء غير مكتملة أو حسابها غير متطابق؛ أدخل جميع البنود يدويًا.",
  LINE_ITEMS_NOT_DETECTED: "لم يُعثر على جدول بنود موثوق؛ أدخل البنود يدويًا.",
  CLAIM_CRITICAL_FIELDS_MISSING: "بعض بيانات المطالبة الحرجة غير واضحة أو مفقودة؛ راجع رقم المطالبة والشركة واللوحة وتاريخ الحادث يدويًا.",
};

export function documentIssueMessage(issue: ExtractionIssue, english: boolean): string {
  return english ? issue.message : ARABIC_ISSUES[issue.code] || "راجع هذا الحقل يدويًا قبل الحفظ.";
}
