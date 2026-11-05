import i18n from "@/i18n";

const resources = {
  ar: {
    title: "مساحة المشرف", back: "العودة للمركبات", receipt: "ملف الزيارة المحفوظ",
    edit: "بيانات الدخول والصور", technical: "الإقرار الفني", temporaryExit: "الفحص والخروج المؤقت",
    inside: "داخل الورشة", withCustomer: "مع العميل — خروج مؤقت", review: "تحتاج مراجعة", delivered:"تم التسليم النهائي", cancelled:"ملغية — الموقع يتطلب مراجعة مستقلة",
    stage: "مرحلة العمل", location: "الموقع الفعلي", customer: "عميل الزيارة", arrival: "الوصول المسجل",
    saved: "هذه البيانات من السجل المحفوظ في السحابة. الموقع والمراحل هما نفسهما في مركز الدورة.",
    exitHint: "زيارة الفحص لا تعني خروج المركبة. افتح محضر الخروج المؤقت؛ تُجلب بيانات الاستلام منه دون إعادة كتابتها، ولا يتغير الموقع حتى تأكيد الخروج.",
    draft: "مسودة فقط — لم يُؤكد الدخول أو إرسال إشعار للعميل.",
    preview: "معاينة النموذج", print: "طباعة", download: "تنزيل PDF", failed: "تعذر تحميل الزيارة أو تأكيد الإجراء.",
    loading: "جارٍ قراءة الزيارة…", retry: "إعادة المحاولة", denied: "ليست لديك صلاحية لهذا الإجراء.",
  },
  en: {
    title: "Supervisor workspace", back: "Back to vehicles", receipt: "Saved visit file",
    edit: "Entry details & photos", technical: "Technical declaration", temporaryExit: "Inspection & temporary release",
    inside: "In workshop", withCustomer: "With customer — temporary release", review: "Needs review", delivered:"Finally delivered", cancelled:"Cancelled — verify physical custody separately",
    stage: "Work stage", location: "Actual location", customer: "Visit customer", arrival: "Recorded arrival",
    saved: "These are the confirmed cloud records, using the same location and stages as the lifecycle center.",
    exitHint: "An inspection visit does not mean the vehicle has left. Open the temporary release report; entry details are reused. Location changes only after release is confirmed.",
    draft: "Draft only — entry and customer notification have not been confirmed.",
    preview: "Preview receipt", print: "Print", download: "Download PDF", failed: "Could not load the visit or confirm this action.",
    loading: "Loading visit…", retry: "Try again", denied: "You do not have permission for this action.",
  },
};
for (const [language, translation] of Object.entries(resources)) i18n.addResourceBundle(language, "supervisorEntry", translation, true, true);
