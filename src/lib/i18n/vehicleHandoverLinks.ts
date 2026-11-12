import i18n from "@/i18n";

const resources = {
  ar: {
    deliveryTime: "وقت التسليم (توقيت عُمان)",
    timeRequired: "حدّد تاريخ ووقت التسليم الصحيحين قبل الحفظ.",
    conflict: "الزيارة وأمر العمل والمطالبة غير متطابقة. راجع الروابط قبل التسليم.",
    ambiguous: "توجد أكثر من زيارة مرتبطة بأمر العمل. راجع الرابط الصحيح قبل التسليم.",
    required: "تعذر العثور على الزيارة المرتبطة. راجع رابط الزيارة قبل التسليم.",
  },
  en: {
    deliveryTime: "Delivery time (Oman time)",
    timeRequired: "Enter a valid delivery date and time before saving.",
    conflict: "The visit, work order and claim do not match. Review their links before delivery.",
    ambiguous: "More than one visit is linked to this work order. Review the correct link before delivery.",
    required: "The linked visit could not be found. Review its link before delivery.",
  },
};
for (const [language, labels] of Object.entries(resources)) {
  i18n.addResourceBundle(language, "translation", { vehicleHandoverLinks: labels }, true, false);
}

export function vehicleHandoverWriteError(error: unknown): unknown {
  const message = String((error as { message?: string })?.message || "");
  const code = message.match(/VEHICLE_HANDOVER_VISIT_(CONFLICT|AMBIGUOUS|REQUIRED)/)?.[1];
  return code ? new Error(i18n.t(`vehicleHandoverLinks.${code.toLowerCase()}`)) : error;
}
