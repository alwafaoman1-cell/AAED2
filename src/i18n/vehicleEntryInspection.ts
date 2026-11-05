import i18n from "@/i18n";

const resources = {
  ar: {
    action: "فحص المركبة", actionFor: "فحص المركبة · {{number}}", title: "فحص المركبة المرتبط بالدخول",
    linkHint: "يحفظ الفحص ويرتبط مباشرة بكرت الدخول والمطالبة نفسها. عند العودة يُفتح الفحص المحفوظ دون إنشاء نسخة جديدة.",
    linkedTo: "كرت الدخول {{entry}} · المطالبة {{claim}}", loading: "جارٍ التحقق من الدخول والفحص المرتبط…",
    unavailable: "تعذر فتح الفحص. تحقق أن الدخول مسجل والمركبة داخل الورشة وأن روابط المطالبة وأمر العمل صحيحة. لن يتم تعديل أي رابط متعارض تلقائيًا.",
    back: "العودة إلى المركز", retry: "إعادة المحاولة", claim: "فتح المطالبة", saved: "حُفظ الفحص {{number}} وربط بالمطالبة وكرت الدخول",
    saveFailed: "لم يتأكد حفظ الفحص وربطه بالمطالبة. راجع الاتصال والصلاحيات والروابط قبل المحاولة مجددًا.",
    linkedLoadFailed: "تعذر تحميل الفحص المرتبط بالمطالبة. أعد المحاولة.",
  },
  en: {
    action: "Vehicle inspection", actionFor: "Vehicle inspection · {{number}}", title: "Entry-linked vehicle inspection",
    linkHint: "Saves the inspection against this entry and its claim. Reopening retrieves the saved inspection without creating a duplicate.",
    linkedTo: "Entry {{entry}} · Claim {{claim}}", loading: "Verifying entry and linked inspection…",
    unavailable: "Unable to open the inspection. Verify a recorded entry, workshop custody and correct claim/work-order links. Conflicting links are never changed automatically.",
    back: "Back to center", retry: "Try again", claim: "Open claim", saved: "Inspection {{number}} saved and linked to the entry and claim",
    saveFailed: "Inspection save and claim linking were not confirmed. Check connection, permissions and links before retrying.",
    linkedLoadFailed: "Unable to load the claim's linked inspection. Try again.",
  },
};
for (const [language, resource] of Object.entries(resources)) {
  i18n.addResourceBundle(language, "vehicleEntryInspection", resource, true, true);
}
