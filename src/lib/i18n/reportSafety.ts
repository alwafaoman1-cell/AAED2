import i18n from "@/i18n";

const ar = {
  paymentPeriod: "الدفعات الفعلية الناجحة بتاريخ دفع ضمن الفترة المختارة، وتشمل تحصيل فواتير أقدم. خصم التسوية ليس تحصيلًا نقديًا.",
  invoiceBalance: "الرصيد الحالي المتبقي للفواتير الصادرة ضمن الفترة المختارة بعد جميع الدفعات الناجحة وخصومات التسوية المعتمدة. ليس رصيدًا تاريخيًا في نهاية الفترة.",
  summaryFailure: "تعذر تحميل الملخص الموثق. لن تظهر مجاميع بديلة. أعد المحاولة أو تحقق من صلاحية الوصول.",
  retry: "إعادة تحميل الملخص",
  monthlyFailure: "تعذر تأكيد جميع مصادر التقرير الشهري. لن تظهر أرصدة أو أرباح بديلة حتى تنجح القراءة. أعد تحميل التقرير.",
  monthlyLoading: "جارٍ تأكيد بيانات الكاش والتأمين والمصروفات الشهرية…",
  monthlyRetry: "إعادة تحميل التقرير الشهري",
};
const en = {
  paymentPeriod: "Actual successful payments dated within the selected period, including payments for older invoices. Settlement discounts are not cash collected.",
  invoiceBalance: "Current outstanding balance of invoices issued in the selected period, after all successful payments and approved settlement discounts. This is not a historical period-end balance.",
  summaryFailure: "The verified summary could not be loaded. No replacement totals are shown. Retry or check your access permissions.",
  retry: "Retry summary",
  monthlyFailure: "All monthly report sources could not be confirmed. No substitute balances or profits will be shown until the reads succeed. Reload the report.",
  monthlyLoading: "Confirming cash, insurance and monthly expense sources…",
  monthlyRetry: "Reload monthly report",
};
for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "translation", { reportSafety: resources }, true, false);
}
