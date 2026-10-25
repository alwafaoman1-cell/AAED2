import { supabase } from "@/integrations/supabase/client";

export const invoiceNumberCorrectionWindowKey = (tenantId: string) =>
  ["invoice-number-correction-window", tenantId] as const;

export const isInvoiceNumberCorrectionOpen = (until: string | null | undefined) =>
  !!until && new Date(until).getTime() > Date.now();

export async function readInvoiceNumberCorrectionWindow(tenantId: string): Promise<string | null> {
  const { data, error } = await supabase.from("invoice_numbering_settings")
    .select("correction_enabled_until")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return (data as { correction_enabled_until?: string | null } | null)?.correction_enabled_until ?? null;
}

export async function setInvoiceNumberCorrectionWindow(
  minutes: 0 | 30,
  reason: string,
): Promise<string | null> {
  if (reason.trim().length < 4) throw new Error("INVOICE_NUMBER_CORRECTION_WINDOW_INPUT_INVALID");
  const { data, error } = await supabase.rpc("set_invoice_number_correction_window", {
    p_minutes: minutes,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  const until = typeof data === "string" ? data : null;
  if (minutes === 30 && !isInvoiceNumberCorrectionOpen(until)) {
    throw new Error("INVOICE_NUMBER_CORRECTION_WINDOW_NOT_CONFIRMED");
  }
  return until;
}

export type CorrectedInvoiceNumber = {
  source_table: "sales_documents" | "insurance_invoices";
  source_id: string;
  invoice_number: string;
};

export async function correctHistoricalCashInvoiceNumber(input: {
  id: string;
  expectedOldNumber: string;
  newNumber: string;
  reason: string;
}): Promise<string> {
  const expected = input.newNumber.trim().toUpperCase();
  const { data, error } = await supabase.rpc("correct_historical_cash_invoice_number", {
    p_invoice_id: input.id,
    p_expected_old_number: input.expectedOldNumber,
    p_new_number: expected,
    p_reason: input.reason.trim(),
  });
  if (error) throw error;
  const row = data?.[0];
  if (row?.invoice_id !== input.id || row.invoice_number !== expected) {
    throw new Error("INVOICE_NUMBER_CORRECTION_NOT_CONFIRMED");
  }
  return row.invoice_number;
}

export async function correctIssuedInvoiceNumber(input: {
  sourceTable: CorrectedInvoiceNumber["source_table"];
  id: string;
  expectedOldNumber: string;
  newNumber: string;
  reason: string;
}): Promise<CorrectedInvoiceNumber> {
  const expected = input.newNumber.trim().toUpperCase();
  const { data, error } = await supabase.rpc("correct_issued_invoice_number", {
    p_source_table: input.sourceTable,
    p_invoice_id: input.id,
    p_expected_old_number: input.expectedOldNumber,
    p_new_number: expected,
    p_reason: input.reason.trim(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as CorrectedInvoiceNumber | null;
  if (row?.source_table !== input.sourceTable || row?.source_id !== input.id
    || row?.invoice_number !== expected) {
    throw new Error("INVOICE_NUMBER_CORRECTION_NOT_CONFIRMED");
  }
  return row;
}

const errorMessages: Record<string, [string, string]> = {
  INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED: ["تصحيح الرقم متاح للمدير فقط.", "Only an administrator can correct an invoice number."],
  INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED: ["افتح فترة تصحيح الأرقام من الإعدادات أولًا.", "Enable the temporary correction window in Settings first."],
  INVOICE_NUMBERING_NOT_ACTIVE: ["الترقيم الرسمي غير مفعّل لهذه المؤسسة؛ لا يمكن فتح التصحيح.", "Official numbering is not active for this tenant; corrections cannot be enabled."],
  INVOICE_NUMBER_CORRECTION_WINDOW_INPUT_INVALID: ["أدخل سببًا واضحًا من أربعة أحرف على الأقل.", "Enter a reason of at least four characters."],
  INVOICE_NUMBER_CORRECTION_INPUT_REQUIRED: ["راجع رقم الفاتورة المطلوب وسبب التصحيح.", "Check the invoice number and correction reason."],
  INVOICE_NUMBER_CORRECTION_NOT_FOUND: ["لم تُعثر على الفاتورة في مؤسستك؛ أعد فتحها.", "The invoice was not found in your tenant; reopen it."],
  OFFICIAL_INVOICE_NUMBER_IMMUTABLE: ["هذا الرقم الرسمي مسجّل بالفعل؛ استخدم تصحيح الرقم الرسمي.", "This invoice already has a registered official number; use the official correction flow."],
  INVOICE_NUMBER_CORRECTION_FINALIZED: ["الفاتورة ملغاة أو لها نسخة PDF نهائية؛ لا يمكن تغيير رقمها مباشرة.", "This invoice is cancelled or has a final PDF; its number cannot be changed directly."],
  INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED: ["الفاتورة مرتبطة بقيد محاسبي؛ يلزم مسار تصحيح محاسبي رسمي.", "This invoice has an accounting entry; use a formal accounting correction."],
  INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED: ["الفترة المحاسبية مغلقة؛ لا يمكن تعديل رقم الفاتورة مباشرة.", "The accounting period is closed; the number cannot be changed directly."],
  INVOICE_NUMBER_NOT_AN_EARLIER_GAP: ["اختر رقمًا سابقًا غير مستخدم ضمن تسلسل السنة.", "Choose an unused earlier number from the same year's sequence."],
  INVOICE_NUMBER_CORRECTION_INVALID_TARGET: ["الرقم المطلوب غير صالح أو يطابق رقم الفاتورة الحالي.", "The requested number is invalid or unchanged."],
  INVOICE_NUMBER_MUST_PRESERVE_LEGACY_SEQUENCE: ["الفاتورة التاريخية يجب أن تحتفظ بنفس رقم التسلسل عند تحويل صيغتها.", "A historical invoice must keep its original sequence when its format is corrected."],
  HISTORICAL_INVOICE_NUMBER_AMBIGUOUS: ["الرقم القديم مكرر؛ لا يمكن تصحيحه قبل معالجة التكرار رسميًا.", "The old number is ambiguous; resolve the duplicate before correcting it."],
  INVOICE_NUMBER_YEAR_OR_FORMAT_INVALID: ["صيغة الرقم أو سنة الفاتورة غير صحيحة.", "The invoice number format or year is invalid."],
  INVOICE_NUMBER_ALREADY_USED: ["الرقم مستخدم أو محجوز تاريخيًا، ولا يمكن إعادة استعماله.", "This number is used or historically reserved."],
  INVOICE_NUMBER_CHANGED_RELOAD: ["تغير الرقم في السحابة؛ أعد فتح الفاتورة.", "The cloud number changed; reopen the invoice."],
  INVOICE_NUMBER_CORRECTION_NOT_CONFIRMED: ["لم يتأكد حفظ الرقم الجديد؛ أعد فتح الفاتورة للتحقق.", "The new number was not confirmed; reopen the invoice to check."],
};

export function invoiceNumberCorrectionError(error: unknown, isArabic: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(errorMessages).find((key) => message.includes(key));
  return code ? errorMessages[code][isArabic ? 0 : 1] : message;
}
