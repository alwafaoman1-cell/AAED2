import i18n from "@/i18n";

const resources = {
  ar: {
    title: "كرت المركبة الداخلي", print: "طباعة الكروت المحددة", selected: "تم تحديد {{count}} مركبة",
    select: "تحديد المركبة {{number}}", page: "تحديد مركبات الصفحة", all: "تحديد جميع نتائج الفلتر ({{count}})",
    clear: "إلغاء التحديد", hint: "6 كروت في كل ورقة A4؛ التحديد محفوظ أثناء التنقل بين صفحات نفس الفلتر.",
    loading: "جارٍ تجهيز الكروت للطباعة…", failed: "تعذر تجهيز الكروت؛ لم تُطبع نتيجة جزئية.",
    changed: "تغيرت النتائج أو بيانات المركبات. أعد التحديد قبل الطباعة.", empty: "حدد مركبة واحدة على الأقل.",
    blocked: "اسمح بفتح نافذة معاينة الكروت من إعدادات المتصفح.",
    awaiting: "بانتظار الوصول", formDate: "تاريخ النموذج", awaitingHint: "نماذج مجهزة لم يُسجّل وصول مركباتها فعليًا بعد؛ ليست خروجًا بعد المعاينة.",
    customerHint: "مركبات وصلت للمعاينة وخرجت بمحضر خروج مؤقت ورقي أو إلكتروني، وتبقى مع العميل انتظارًا للقطع أو موافقة التأمين. التسليم النهائي منفصل.",
  },
  en: {
    title: "Internal vehicle card", print: "Print selected cards", selected: "{{count}} vehicles selected",
    select: "Select vehicle {{number}}", page: "Select vehicles on this page", all: "Select all filtered results ({{count}})",
    clear: "Clear selection", hint: "6 cards per A4 sheet; selection is retained across pages within the same filter.",
    loading: "Preparing vehicle cards…", failed: "Could not prepare the cards; no partial result was printed.",
    changed: "The results or vehicle data changed. Select the vehicles again before printing.", empty: "Select at least one vehicle.",
    blocked: "Allow the vehicle-card preview window in your browser settings.",
    awaiting: "Awaiting arrival", formDate: "Form date", awaitingHint: "Prepared forms whose vehicles have not yet physically arrived; these are not inspection releases.",
    customerHint: "Vehicles that arrived for inspection and left under a paper or electronic temporary release, with the customer while awaiting parts or insurance approval. Final deliveries are separate.",
  },
};
for (const [language, values] of Object.entries(resources)) {
  i18n.addResourceBundle(language, "vehicleEntryLabels", values, true, true);
  i18n.addResourceBundle(language, "supervisorWorkspace", { awaiting_arrival: values.awaiting }, true, true);
}
