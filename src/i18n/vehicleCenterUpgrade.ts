import i18n from "@/i18n";

// Deliberately isolated from the shared locale files while parallel work is active.
const resources = {
  en: {
    deliveredTab: "Delivered", cancelledTab: "Cancelled", reviewTab: "Review",
    registerEntry: "Register entry", registerEntryFor: "Register entry · {{number}}",
    returnHint: "Confirm the actual return of this inspected vehicle. This updates the existing temporary release; it does not create another entry.",
    returnTime: "Return confirmation time (Oman)",
    returnTimeHint: "The cloud records the exact server time when you confirm. Historical return times are not supported by this action.",
    tabsHint: "With customer contains inspected arrivals with a recorded temporary exit (paper or electronic acknowledgement). Delivered and cancelled vehicles are separate. Uncertain history and claims without entry receipts remain in Review.",
    pageHint: "List and stage board show this page only. Export includes all matching records in the selected tab (maximum 10,000). Print prints this page only.",
    reviewHint: "Open Review to retrieve uncertain records and claims without an entry receipt.",
    exportChanged: "Records changed during export. Refresh and try again; no partial file was saved.",
    unavailable: "The bounded vehicle center read API is unavailable or inconsistent. Ask the administrator to review the Development candidate migration. No full-history fallback was used.",
    total: "{{count}} matching records in this tab", returnStale: "The release or custody changed. Refresh and review the vehicle before confirming.",
    returnFailed: "The vehicle return could not be confirmed in the cloud. Refresh the record and review your permissions before trying again.",
  },
  ar: {
    deliveredTab: "تم التسليم", cancelledTab: "ملغاة", reviewTab: "تحتاج مراجعة",
    registerEntry: "تسجيل الدخول", registerEntryFor: "تسجيل الدخول · {{number}}",
    returnHint: "أكد العودة الفعلية للمركبة التي تمت معاينتها. يُحدّث محضر الخروج المؤقت الحالي دون إنشاء دخول مكرر.",
    returnTime: "وقت تأكيد العودة (عُمان)",
    returnTimeHint: "تسجل السحابة وقت الخادم الدقيق عند التأكيد. لا يدعم هذا الإجراء تسجيل وقت عودة تاريخي.",
    tabsHint: "مع العميل للمركبات الواصلة التي تمت معاينتها وسُجل خروجها مؤقتاً بإقرار ورقي أو إلكتروني. المركبات المسلّمة والملغاة منفصلة. السجلات التاريخية غير المؤكدة والمطالبات بلا كرت دخول في المراجعة.",
    pageHint: "القائمة والمراحل تعرضان الصفحة الحالية فقط. يشمل التصدير جميع السجلات المطابقة في التبويب المحدد (بحد أقصى 10,000). الطباعة للصفحة الحالية فقط.",
    reviewHint: "افتح المراجعة لجلب السجلات غير المؤكدة والمطالبات بلا كرت دخول.",
    exportChanged: "تغيرت السجلات أثناء التصدير. حدّث البيانات وحاول مجدداً؛ لم يُحفظ ملف جزئي.",
    unavailable: "واجهة مركز المركبات المحدودة غير متاحة أو غير متطابقة. اطلب من المسؤول مراجعة ترقية التطوير المقترحة. لم يتم تحميل التاريخ كاملاً كبديل.",
    total: "{{count}} سجل مطابق في هذا التبويب", returnStale: "تغير محضر الخروج أو موقع المركبة. حدّث السجل وراجعه قبل التأكيد.",
    returnFailed: "تعذر تأكيد عودة المركبة في السحابة. حدّث السجل وراجع صلاحياتك قبل المحاولة مجدداً.",
  },
};

for (const [language, resource] of Object.entries(resources)) {
  i18n.addResourceBundle(language, "vehicleCenterUpgrade", resource, true, true);
}

const visitLabels = {
  ar: {
    manageLocationAndStage: "الموقع والمراحل",
    locationTabsHint: "التبويبان لعرض موقع المركبة فقط؛ استخدم «الموقع والمراحل» في صف المركبة لتوثيق أي خروج أو عودة.",
    reviewLinksTitle: "مراجعة السجل والروابط قبل التصحيح",
    locationActionHint: "اختر الموقع المطلوب، ثم أكمل الإجراء الموثّق الظاهر. تبويبات القائمة للعرض فقط ولا تغيّر الحيازة.",
    locationAlreadyRecorded: "الموقع المحدد محفوظ بالفعل؛ لم يُنشأ انتقال جديد.",
    locationNeedsFormalReview: "لا يمكن نقل هذه الزيارة قبل مراجعة ربطها وموقعها الفعلي في الملف الكامل.",
    locationPermissionRequired: "ليس لديك صلاحية تسجيل خروج المركبة أو عودتها. اطلب من الموظف المخوّل إكمال الإجراء.",
    exitDocumentationRequired: "حدد نوع الخروج: محضر خروج مؤقت للاستلام لاحقًا، أو تسليم نهائي موثّق. لا يتغير الموقع قبل اعتماد الإجراء.",
  },
  en: {
    manageLocationAndStage: "Location and stages",
    locationTabsHint: "These tabs only filter by location. Use Location and stages on the vehicle row to record a release or return.",
    reviewLinksTitle: "Review the entry and linked records before correcting custody",
    locationActionHint: "Select the intended location, then complete the documented action shown. List tabs only filter records; they do not change custody.",
    locationAlreadyRecorded: "This location is already recorded; no new movement was created.",
    locationNeedsFormalReview: "Review this visit's links and physical location in the full record before changing custody.",
    locationPermissionRequired: "You are not authorized to record vehicle release or return. Ask an authorized team member to complete it.",
    exitDocumentationRequired: "Choose a temporary release for later return or a documented final handover. The location changes only after the action is finalized.",
  },
};
for (const [language, labels] of Object.entries(visitLabels)) {
  i18n.addResourceBundle(language, "translation", { vehicleVisit: labels }, true, false);
}
