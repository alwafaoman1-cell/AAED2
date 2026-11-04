import i18n from "@/i18n";

const ar = {
  archivedReuseOnSave: "سيتم استعادة نفس سجل المركبة من الأرشيف عند حفظ أمر العمل الجديد، بدون إنشاء مركبة مكررة وبدون تغيير المالك المسجل.",
  selectedClaimCustomer: "سيتم استخدام المركبة مع عميل المطالبة المحدد، دون تغيير المالك المسجل أو السجلات السابقة.",
  newCustomerByPhone: "إذا لم يوجد عميل بنفس الهاتف، سيتم إنشاء عميل جديد عند حفظ المطالبة. الاسم وحده لا يحدد العميل.",
  selectVisitCustomer: "اختر أو أنشئ عميل الزيارة بالهاتف أو رقم العميل.",
  deletedVehicleRequiresRestore: "المركبة محذوفة. يجب استعادتها صراحةً قبل إنشاء زيارة جديدة.",
  newCustomerContactRequired: "اختر العميل بالهاتف أو رقم العميل، أو أدخل هاتف العميل الجديد.",
} as const;

const en: Record<keyof typeof ar, string> = {
  archivedReuseOnSave: "The same archived vehicle record will be reused when the new work order is saved, without creating a duplicate or changing its registered owner.",
  selectedClaimCustomer: "The vehicle will be used with the selected claim customer, without changing its registered owner or historical records.",
  newCustomerByPhone: "If no customer matches this phone, a new customer will be created when the claim is saved. A name alone does not identify a customer.",
  selectVisitCustomer: "Select or create the visit customer by phone or customer code.",
  deletedVehicleRequiresRestore: "This vehicle is deleted. Restore it explicitly before creating a new visit.",
  newCustomerContactRequired: "Select the customer by phone or customer code, or enter the new customer's phone number.",
};

for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "translation", { vehicleVisitIdentity: resources }, true, false);
}
