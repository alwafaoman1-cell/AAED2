import { supabase } from "@/integrations/supabase/client";
import { voucherSettingsStore } from "@/lib/financeSettingsStore";

export interface ExpenseVoucherNumberOptions {
  prefix?: string;
  year?: number;
  padding?: number;
}

export async function nextExpenseVoucherNumber(options: ExpenseVoucherNumberOptions = {}): Promise<string> {
  const settings = voucherSettingsStore.get();
  const year = options.year ?? new Date().getFullYear();
  const prefix = (options.prefix ?? settings.paymentPrefix ?? "PAY").trim() || "PAY";
  const padding = Math.max(1, Math.min(Number(options.padding ?? settings.numberPadding) || 4, 12));
  const { data, error } = await supabase.rpc("next_expense_voucher_number", {
    p_prefix: prefix,
    p_year: year,
    p_padding: padding,
  });
  if (error || typeof data !== "string" || !data.trim()) {
    throw new Error(error?.message || "تعذر حجز رقم سند صرف فريد من Supabase");
  }
  return data.trim();
}
