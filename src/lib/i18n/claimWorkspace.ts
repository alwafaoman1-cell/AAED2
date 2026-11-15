import i18n from "@/i18n";

const ar = {
  nav: {
    label: "مراحل المطالبة",
    inspect: "الفحص والصور",
    estimate: "التقدير",
    approval: "الموافقة",
    workorder: "أمر العمل",
    delivery: "التسليم",
    payments: "المبالغ والفوترة",
  },
  summary: { title: "ملخص المبالغ" },
};

const en: typeof ar = {
  nav: {
    label: "Claim stages",
    inspect: "Inspection & photos",
    estimate: "Estimate",
    approval: "Approval",
    workorder: "Work order",
    delivery: "Delivery",
    payments: "Amounts & billing",
  },
  summary: { title: "Amount summary" },
};

for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "claimWorkspace", resources, true, false);
}
