import i18n from "@/i18n";
const ar={
  confirm:"تأكيد ربط أمر العمل الموجود", confirmed:"تم تأكيد ربط أمر العمل بنفس الزيارة دون إنشاء أمر جديد.",
  failed:"لم يتأكد ربط أمر العمل. لم يُعرض نجاح؛ أعد فتح السجل للتحقق.",
  VEHICLE_ENTRY_LINK_FORBIDDEN:"تصحيح ربط الزيارة متاح للمدير فقط.",
  VEHICLE_ENTRY_LINK_UNAVAILABLE:"نموذج الدخول أو أمر العمل غير متاح لهذه الورشة.",
  VEHICLE_ENTRY_LINK_STALE:"تغير السجل أثناء المراجعة. أعد فتحه قبل تأكيد الربط.",
  VEHICLE_ENTRY_LINK_CLOSED:"لا يُصحّح ربط زيارة ملغية أو مسلّمة من هذا الإجراء.",
  VEHICLE_ENTRY_LINK_CONFLICT:"تختلف المركبة أو المطالبة أو الزيارة المرتبطة. يلزم تصحيح بيانات بمراجعة المدير؛ لم يُغيَّر الربط.",
  VEHICLE_ENTRY_LINK_AMBIGUOUS:"يوجد أكثر من أمر أو زيارة مرشحة. يجب مراجعة التكرار قبل الربط.",
} as const;
const en:Record<keyof typeof ar,string>={
  confirm:"Confirm existing work-order link",confirmed:"The existing work order is linked to the same visit; no new order was created.",
  failed:"The work-order link was not confirmed. Reopen the record to verify; no success was reported.",
  VEHICLE_ENTRY_LINK_FORBIDDEN:"Only a manager can correct a visit link.",
  VEHICLE_ENTRY_LINK_UNAVAILABLE:"The entry or work order is unavailable for this workshop.",
  VEHICLE_ENTRY_LINK_STALE:"The record changed during review. Reopen it before confirming the link.",
  VEHICLE_ENTRY_LINK_CLOSED:"This action cannot relink a cancelled or delivered visit.",
  VEHICLE_ENTRY_LINK_CONFLICT:"The vehicle, claim or visit differs. Manager-reviewed data correction is required; the link was not changed.",
  VEHICLE_ENTRY_LINK_AMBIGUOUS:"More than one work order or visit matches. Review duplicates before linking.",
};
for(const [language,resources]of [["ar",ar],["en",en]]as const)i18n.addResourceBundle(language,"translation",{vehicleEntryLinks:resources},true,false);
