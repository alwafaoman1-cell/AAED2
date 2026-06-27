import { supabase } from "@/integrations/supabase/client";
import { salesStore, type SalesDoc } from "@/lib/salesStore";

export type ReminderChannel = "whatsapp" | "email" | "sms";

export interface AccountingReminderSettings {
  enabled: boolean;
  dueDays: number;
  channels: ReminderChannel[];
  frequencyHours: number;
}

export interface OverdueInvoiceRow {
  invoice: SalesDoc;
  dueDate: string;
  daysOverdue: number;
  balanceDue: number;
  customerName: string;
  customerPhone: string;
}

export const DEFAULT_ACCOUNTING_REMINDER_SETTINGS: AccountingReminderSettings = {
  enabled: true,
  dueDays: 7,
  channels: ["whatsapp"],
  frequencyHours: 24,
};

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText: string | undefined, days: number) {
  const base = dateText ? new Date(dateText) : new Date();
  if (Number.isNaN(base.getTime())) return toDateOnly(new Date());
  base.setDate(base.getDate() + days);
  return toDateOnly(base);
}

export function getInvoiceDueDate(invoice: SalesDoc, dueDays = DEFAULT_ACCOUNTING_REMINDER_SETTINGS.dueDays) {
  return invoice.dueDate || addDays(invoice.date, dueDays);
}

export function buildOverdueInvoices(
  settings: AccountingReminderSettings = DEFAULT_ACCOUNTING_REMINDER_SETTINGS,
  today = new Date(),
): OverdueInvoiceRow[] {
  const todayDate = new Date(toDateOnly(today));

  return salesStore
    .list({ type: "invoice" })
    .map((invoice) => {
      const total = Number(invoice.total || 0);
      const paid = Number(invoice.paidTotal || 0);
      const balanceDue = Math.max(0, Number(invoice.balanceDue ?? total - paid));
      const dueDate = getInvoiceDueDate(invoice, settings.dueDays);
      const due = new Date(dueDate);
      const daysOverdue = Math.max(0, Math.floor((todayDate.getTime() - due.getTime()) / 86_400_000));

      return {
        invoice,
        dueDate,
        daysOverdue,
        balanceDue,
        customerName: invoice.customerName || (invoice as SalesDoc & { customer?: string }).customer || "Customer",
        customerPhone: (invoice as SalesDoc & { customerPhone?: string; phone?: string }).customerPhone || (invoice as SalesDoc & { phone?: string }).phone || "",
      };
    })
    .filter((row) => {
      const status = String(row.invoice.status || "").toLowerCase();
      return row.balanceDue > 0 && row.daysOverdue > 0 && !["paid", "cancelled", "canceled", "draft"].includes(status);
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export function buildPaymentReminderMessage(row: OverdueInvoiceRow) {
  const invoiceNumber = row.invoice.number || row.invoice.id;
  return [
    `مرحباً ${row.customerName}،`,
    `نود تذكيركم بأن الفاتورة ${invoiceNumber} مستحقة منذ ${row.daysOverdue} يوم.`,
    `المبلغ المتبقي: ${row.balanceDue.toFixed(3)} ر.ع.`,
    "يرجى سداد المبلغ أو التواصل معنا في حال وجود أي استفسار.",
  ].join("\n");
}

export async function queuePaymentReminder(row: OverdueInvoiceRow, settings = DEFAULT_ACCOUNTING_REMINDER_SETTINGS) {
  const since = new Date(Date.now() - settings.frequencyHours * 60 * 60 * 1000).toISOString();
  const invoiceId = row.invoice.id;

  try {
    const recent = await supabase
      .from("message_logs" as never)
      .select("id")
      .eq("invoice_id", invoiceId)
      .eq("template_key", "payment_reminder")
      .gte("sent_at", since)
      .limit(1);

    if (!recent.error && recent.data?.length) {
      return { ok: false, blocked: true, message: "يوجد تذكير مرسل خلال آخر 24 ساعة." };
    }

    const body = buildPaymentReminderMessage(row);
    const inserted = await supabase.from("message_logs" as never).insert({
      invoice_id: invoiceId,
      channel: "whatsapp",
      recipient_phone: row.customerPhone,
      template_key: "payment_reminder",
      message: body,
      status: "queued",
      sent_at: new Date().toISOString(),
    } as never);

    if (inserted.error) {
      return { ok: false, blocked: false, message: inserted.error.message, body };
    }

    return { ok: true, blocked: false, message: "تم تجهيز تذكير الدفع وتسجيله.", body };
  } catch (error) {
    return {
      ok: false,
      blocked: false,
      message: error instanceof Error ? error.message : "تعذر تسجيل تذكير الدفع.",
      body: buildPaymentReminderMessage(row),
    };
  }
}
