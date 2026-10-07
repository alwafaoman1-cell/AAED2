import { Loader2, Receipt } from "lucide-react";
import type { WorkOrderInvoiceIndicator } from "@/lib/workOrderInvoiceIndicators";

interface Props {
  indicator?: WorkOrderInvoiceIndicator;
  loading: boolean;
  error: boolean;
  isArabic: boolean;
}

export default function WorkOrderInvoiceBadge({ indicator, loading, error, isArabic }: Props) {
  if (error) return <span className="text-xs text-destructive">{isArabic ? "تعذر التحقق" : "Check failed"}</span>;
  if (loading || !indicator) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" />{isArabic ? "جارٍ التحقق" : "Checking"}</span>;

  const appearance = {
    none: { text: isArabic ? "بلا فاتورة" : "No invoice", color: "border-border bg-muted/50 text-muted-foreground" },
    unpaid: { text: isArabic ? "فاتورة غير مدفوعة" : "Unpaid invoice", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    partial: { text: isArabic ? "مدفوعة جزئيًا" : "Part-paid", color: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    paid: { text: indicator.settlementDiscount > 0 ? (isArabic ? "مسددة بخصم" : "Settled with discount") : (isArabic ? "مدفوعة" : "Paid"), color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  }[indicator.state];
  const title = indicator.invoiceNumbers.length
    ? `${indicator.invoiceNumbers.join(", ")} · ${isArabic ? "المحصل" : "Paid"}: ${indicator.paid.toFixed(3)} OMR${indicator.settlementDiscount > 0 ? ` · ${isArabic ? "الخصم" : "Discount"}: ${indicator.settlementDiscount.toFixed(3)} OMR` : ""} · ${isArabic ? "المتبقي" : "Remaining"}: ${indicator.remaining.toFixed(3)} OMR`
    : appearance.text;

  return (
    <span title={title} className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${appearance.color}`}>
      <Receipt size={11} />{appearance.text}
    </span>
  );
}
