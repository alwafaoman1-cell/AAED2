import i18n from "@/i18n";
const en = { loading: "Loading verified totals…", failed: "Totals could not be verified. No incomplete financial figures are shown.", retry: "Retry", actualVouchers: "Actual expense vouchers", issuedInvoices: "Issued invoices", recent: "Recent posted entries", show: "Show", loadSection: "Load section", prepareLink: "Prepare customer link", linkFailed: "The customer link could not be confirmed.", alerts: {
  stale_pending: "Claim pending for {{count}} days", delivered_without_invoice: "Delivered claim without an invoice", policy_expiring: "Policy expires in {{count}} days", cheque_due: "Cheque due in {{count}} days", invoice_overdue: "Overdue invoice",
}};
const ar = { loading: "جارٍ قراءة المجاميع المعتمدة…", failed: "تعذر تأكيد المجاميع؛ لم تُعرض أرقام مالية ناقصة.", retry: "إعادة المحاولة", actualVouchers: "سندات صرف فعلية", issuedInvoices: "فواتير معتمدة", recent: "آخر القيود المُرحَّلة", show: "عرض", loadSection: "عرض القسم", prepareLink: "تجهيز رابط العميل", linkFailed: "تعذر تأكيد رابط العميل.", alerts: {
  stale_pending: "مطالبة معلقة منذ {{count}} يوم", delivered_without_invoice: "مطالبة مسلّمة بدون فاتورة", policy_expiring: "وثيقة تنتهي خلال {{count}} يوم", cheque_due: "شيك مستحق خلال {{count}} يوم", invoice_overdue: "فاتورة متأخرة",
}};
for (const [language, values] of [["en",{...en,noEntries:"No entries yet"}],["ar",{...ar,noEntries:"لا توجد قيود بعد"}]] as const) i18n.addResourceBundle(language,"translation",{ performanceRead: values },true,false);
