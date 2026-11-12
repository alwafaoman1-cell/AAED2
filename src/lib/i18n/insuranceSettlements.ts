import i18n from "@/i18n";
const ar = {
  title: "تقرير خصومات تسوية فواتير المطالبات", shortTitle: "خصومات التسوية",
  subtitle: "تقرير داخلي لفواتير التأمين فقط — الخصم ليس تحصيلًا ولا يغيّر الفاتورة الصادرة أو ضريبتها.",
  scope: "صف واحد لكل فاتورة. القيم والأرصدة حالية حتى وقت القراءة، وليست أرصدة إقفال تاريخية. فلتر التاريخ يختار الفواتير، ولا يجزّئ إجمالياتها. تاريخ التسوية هو تاريخ الدفع المُدخل، وليس وقت إنشاء السجل.",
  search: "بحث بالفاتورة، المطالبة، اللوحة، شركة التأمين أو الدفعة", company: "شركة التأمين", allCompanies: "جميع الشركات",
  from: "من تاريخ", to: "إلى تاريخ", dateBasis: "التصفية حسب", invoice: "تاريخ الفاتورة", settlement: "تاريخ دفعة التسوية",
  reviewOnly: "تحتاج مراجعة فقط", clear: "مسح الفلاتر", refresh: "تحديث", excel: "تصدير Excel", preview: "معاينة / طباعة / PDF",
  columns: "الأعمدة", back: "محاسبة المطالبات", loading: "جارٍ تأكيد الفواتير والتسويات…",
  error: "تعذر تأكيد بيانات التقرير كاملة. لن تُعرض إجماليات أو صادرات ناقصة؛ أعد المحاولة.",
  empty: "لا توجد خصومات تسوية مطابقة للفلاتر.", verified: "مطابق", review: "يحتاج مراجعة",
  reviewNote: "توجد فروق أو روابط غير مؤكدة. عُرضت كما هي للمراجعة، ولم تُصحّح أي بيانات تلقائيًا.",
  invoiceMismatch: "خصم الفاتورة لا يطابق الدفعات المعتمدة", missingApproval: "سبب الخصم أو اعتماد المدير غير مكتمل",
  ambiguousLink: "دفعة قديمة دون ربط مؤكد بفاتورة", missingClaim: "تعذر تأكيد المطالبة المرتبطة",
  invoices: "عدد الفواتير", recordedDiscount: "الخصم المسجل بالفواتير", verifiedDiscount: "الخصم المؤكد بسجل الدفعات",
  paid: "المبلغ المحصل حاليًا", remaining: "الرصيد الحالي المتبقي", total: "إجمالي الفواتير شامل الضريبة",
  totals: "الإجمالي", next: "التالي", previous: "السابق", exportError: "تعذر إنشاء الملف. أعد المحاولة.",
  invalidDates: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.", allDates: "كل التواريخ", rows: "فاتورة مطابقة",
  internal: "تقرير داخلي — ليس فاتورة ضريبية", status: "حالة المطابقة",
  fields: {
    invoiceNumber: "رقم الفاتورة", invoiceDate: "تاريخ الفاتورة", claimNumber: "رقم المطالبة", company: "شركة التأمين",
    plate: "اللوحة", vehicle: "المركبة", total: "الإجمالي شامل الضريبة", paid: "المحصل", recordedDiscount: "خصم الفاتورة",
    verifiedDiscount: "الخصم المؤكد بالدفعات", difference: "فرق الخصم", remaining: "المتبقي الحالي", discountPercent: "نسبة الخصم %",
    settlementDates: "تواريخ دفعات التسوية", paymentNumbers: "أرقام الدفعات", reasons: "سبب الخصم", approvers: "معرّفات المعتمدين", status: "المطابقة / المراجعة",
  },
};
const en: typeof ar = {
  title: "Claim Invoice Settlement Discounts", shortTitle: "Settlement discounts",
  subtitle: "Internal insurance-only report — discounts are not cash collected and do not change issued invoices or VAT.",
  scope: "One row per invoice. Values and balances are current at read time, not historical closing balances. Date filters select invoices without prorating their totals. Settlement dates are entered payment dates, not record creation timestamps.",
  search: "Search invoice, claim, plate, insurer or payment", company: "Insurance company", allCompanies: "All companies",
  from: "From", to: "To", dateBasis: "Filter by", invoice: "Invoice date", settlement: "Settlement payment date",
  reviewOnly: "Needs review only", clear: "Clear filters", refresh: "Refresh", excel: "Export Excel", preview: "Preview / Print / PDF",
  columns: "Columns", back: "Claims accounting", loading: "Confirming invoices and settlements…",
  error: "The complete report could not be confirmed. Partial totals and exports are withheld. Please retry.",
  empty: "No settlement discounts match these filters.", verified: "Matched", review: "Needs review",
  reviewNote: "Differences or uncertain links need review. They are shown as stored; no data has been automatically repaired.",
  invoiceMismatch: "Invoice discount differs from approved payments", missingApproval: "Discount reason or manager approval is missing",
  ambiguousLink: "Legacy payment has no unambiguous invoice link", missingClaim: "Linked claim could not be confirmed",
  invoices: "Invoices", recordedDiscount: "Discount recorded on invoices", verifiedDiscount: "Discount verified from payments",
  paid: "Current amount collected", remaining: "Current outstanding balance", total: "Invoice totals including VAT",
  totals: "Total", next: "Next", previous: "Previous", exportError: "The file could not be generated. Please retry.",
  invalidDates: "The start date must not be after the end date.", allDates: "All dates", rows: "matching invoices",
  internal: "Internal report — not a tax invoice", status: "Reconciliation status",
  fields: {
    invoiceNumber: "Invoice number", invoiceDate: "Invoice date", claimNumber: "Claim number", company: "Insurance company",
    plate: "Plate", vehicle: "Vehicle", total: "Total including VAT", paid: "Collected", recordedDiscount: "Invoice discount",
    verifiedDiscount: "Payment-verified discount", difference: "Discount difference", remaining: "Current outstanding", discountPercent: "Discount %",
    settlementDates: "Settlement payment dates", paymentNumbers: "Payment numbers", reasons: "Discount reason", approvers: "Approver IDs", status: "Reconciliation / Review",
  },
};
for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "translation", { insuranceSettlements: resources }, true, false);
}
