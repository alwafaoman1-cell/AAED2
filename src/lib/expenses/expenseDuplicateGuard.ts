import { supabase } from "@/integrations/supabase/client";

export interface ExpenseDuplicateCandidate {
  supplier_id?: string | null;
  supplier_tax_number?: string | null;
  beneficiary?: string | null;
  supplier_invoice_number?: string | null;
  supplier_invoice_date?: string | null;
  date: string;
  total: number;
  work_order_id?: string | null;
  linked_work_order_id?: string | null;
  description?: string | null;
  duplicate_batch_id?: string | null;
  document_sha256?: string | null;
}

export interface ExpenseDuplicateMatch {
  id: string;
  voucher_number: string;
  date: string;
  supplier_invoice_date?: string | null;
  supplier_invoice_number?: string | null;
  total: number;
  supplier_name?: string | null;
  order_number?: string | null;
  match_type: "exact" | "potential";
  score: number;
}

export interface ExpenseDuplicateResult {
  exact: ExpenseDuplicateMatch[];
  potential: ExpenseDuplicateMatch[];
}

export class ExpensePotentialDuplicateError extends Error {
  matches: ExpenseDuplicateMatch[];
  constructor(matches: ExpenseDuplicateMatch[]) {
    const vouchers = matches.slice(0, 3).map((match) => match.voucher_number).filter(Boolean).join(", ");
    super(`يوجد مصروف مشابه${vouchers ? ` تحت السندات: ${vouchers}` : ""}. راجعه قبل الحفظ.`);
    this.name = "ExpensePotentialDuplicateError";
    this.matches = matches;
  }
}

export class ExpenseExactDuplicateError extends Error {
  matches: ExpenseDuplicateMatch[];
  constructor(matches: ExpenseDuplicateMatch[]) {
    const voucher = matches[0]?.voucher_number;
    super(voucher
      ? `فاتورة المورد مسجلة مسبقًا تحت سند الصرف ${voucher}`
      : "فاتورة المورد مسجلة مسبقًا ولا يمكن حفظها مرتين");
    this.name = "ExpenseExactDuplicateError";
    this.matches = matches;
  }
}

export function isDuplicateGuardUnavailable(error: any) {
  const text = String(error?.message || error?.details || error?.code || "");
  return /expense_duplicate_candidates_rpc|PGRST202|schema cache|could not find the function/i.test(text);
}

export function duplicateExpenseMessage(error: any) {
  const text = String(error?.message || "");
  if (!text.includes("EXPENSE_DUPLICATE_EXACT")) return null;
  const detail = String(error?.details || "");
  const voucher = detail.match(/"voucher_number"\s*:\s*"([^"]+)"/)?.[1];
  return voucher
    ? `فاتورة المورد مسجلة مسبقًا تحت سند الصرف ${voucher}`
    : "فاتورة المورد مسجلة مسبقًا ولا يمكن حفظها مرتين";
}

export function exactDuplicateErrorFromDatabase(error: any): ExpenseExactDuplicateError | null {
  const text = String(error?.message || "");
  if (!text.includes("EXPENSE_DUPLICATE_EXACT")) return null;
  const detail = String(error?.details || "");
  const id = detail.match(/"expense_id"\s*:\s*"([^"]+)"/)?.[1] || "";
  const voucherNumber = detail.match(/"voucher_number"\s*:\s*"([^"]+)"/)?.[1] || "";
  return new ExpenseExactDuplicateError([{
    id,
    voucher_number: voucherNumber,
    date: "",
    total: 0,
    match_type: "exact",
    score: 100,
  }]);
}

export function requestPotentialDuplicateOverride(
  matches: ExpenseDuplicateMatch[],
  canOverride: boolean,
  language: "ar" | "en" = "ar",
): string | null {
  const vouchers = matches.slice(0, 3).map((match) => match.voucher_number).filter(Boolean).join(", ");
  const arMessage = `يوجد مصروف مشابه${vouchers ? `: ${vouchers}` : ""}. راجع السجل السابق قبل إنشاء مصروف جديد.`;
  const enMessage = `A similar expense exists${vouchers ? `: ${vouchers}` : ""}. Review it before creating another expense.`;
  if (!canOverride) {
    window.alert(language === "ar" ? `${arMessage}\nالتجاوز متاح للمدير فقط.` : `${enMessage}\nOnly a manager can override this warning.`);
    return null;
  }
  if (!window.confirm(language === "ar" ? `${arMessage}\nهل تريد المتابعة رغم ذلك؟` : `${enMessage}\nContinue anyway?`)) return null;
  const reason = window.prompt(language === "ar" ? "اكتب سبب إنشاء المصروف رغم التشابه:" : "Enter the reason for creating this similar expense:")?.trim();
  if (!reason) {
    window.alert(language === "ar" ? "سبب التجاوز إلزامي." : "An override reason is required.");
    return null;
  }
  return reason;
}

export async function checkExpenseDuplicates(
  candidate: ExpenseDuplicateCandidate,
  excludeId?: string | null,
): Promise<ExpenseDuplicateResult> {
  const { data, error } = await (supabase.rpc as any)("expense_duplicate_candidates_rpc", {
    p_candidate: candidate,
    p_exclude_id: excludeId || null,
  });
  if (error) {
    if (isDuplicateGuardUnavailable(error)) return { exact: [], potential: [] };
    throw error;
  }
  return {
    exact: Array.isArray(data?.exact) ? data.exact : [],
    potential: Array.isArray(data?.potential) ? data.potential : [],
  };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
