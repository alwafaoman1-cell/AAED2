import i18n from "@/i18n";

const ar = {
  back: "رجوع", forward: "للأمام", moreActions: "إجراءات إضافية",
  filters: "الفلاتر", clearFilters: "مسح الفلاتر", search: "اللوحة، العميل، المطالبة، أمر العمل أو VIN",
  help: "شرح الموقع والمراحل", stages: "مراحل المركبات",
  appearance: "تبديل المظهر", light: "فاتح", dark: "داكن", system: "تلقائي",
  locations: "تصنيف المركبات", records: "السجلات", workStages: "مراحل العمل",
  registerArrival: "تسجيل دخول للورشة", viewRecord: "عرض الملف", reviewRecord: "مراجعة السجل",
  approveClaim: "اعتماد المطالبة", approveVisit: "تأكيد الاعتماد", startWork: "بدء العمل",
  markReady: "تجهيز التسليم", deliverVehicle: "تسليم المركبة", reviewRepair: "تحديث حالة الإصلاح", requirements: "استكمال المتطلبات",
  openRecord: "فتح الملف الكامل", visitDetails: "بيانات الزيارة",
  customerGuide: "مركبات فُحصت وغادرت وبانتظار الإجراء. سجّل دخولها عند وصولها الفعلي للورشة.",
  pendingGuide: "نماذج دخول مجهّزة؛ سجّل الوصول الفعلي من زر دخول الورشة.",
};
const en: typeof ar = {
  back: "Back", forward: "Forward", moreActions: "More actions",
  filters: "Filters", clearFilters: "Clear filters", search: "Plate, customer, claim, work order or VIN",
  help: "Location and stage guide", stages: "Vehicle stages",
  appearance: "Switch appearance", light: "Light", dark: "Dark", system: "System",
  locations: "Vehicle categories", records: "Records", workStages: "Work stages",
  registerArrival: "Register workshop arrival", viewRecord: "View file", reviewRecord: "Review record",
  approveClaim: "Approve claim", approveVisit: "Confirm approval", startWork: "Start work",
  markReady: "Prepare delivery", deliverVehicle: "Deliver vehicle", reviewRepair: "Update repair status", requirements: "Complete prerequisites",
  openRecord: "Open full file", visitDetails: "Visit details",
  customerGuide: "Inspected vehicles released to the customer, awaiting action. Register their arrival only when they physically return.",
  pendingGuide: "Prepared entry forms; confirm the actual arrival using the workshop arrival action.",
};
for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "translation", { vehicleCenterMobile: resources }, true, false);
}
