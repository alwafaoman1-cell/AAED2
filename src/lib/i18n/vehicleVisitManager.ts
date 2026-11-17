import i18n from "@/i18n";

const en = {
  title: "Manager location, stages and dates",
  subtitle: "Correct the active visit's location, operational stage and milestone dates with a recorded reason.",
  open: "Edit location, stage and dates", view: "View saved dates", close: "Close", refresh: "Refresh",
  loading: "Reading the current saved visit…", loadFailed: "The visit could not be verified. Refresh before making changes.",
  closed: "This completed or cancelled visit is read-only. An actual return after delivery is recorded through a new linked review visit.",
  protected: "These corrections do not approve an insurance claim, create an invoice, or alter signed forms, signatures and finalized handovers.",
  stage: "Operational stage", location: "Actual vehicle location", inside: "In workshop", customer: "With customer",
  locationTime: "Date and time of actual location", stageDates: "Milestone dates and times",
  dateHint: "Choose the actual date for each recorded milestone. The selected stage must have a date; unrecorded milestones may remain blank.",
  timezone: "Dates and times use Oman time (Asia/Muscat).",
  arrivalDate: "Arrival date and time", approvalDate: "Approval date and time", workDate: "Work start date and time", readyDate: "Ready date and time", deliveryDate: "Final delivery date and time",
  deliveryProtected: "Final delivery is recorded through its receipt and signature. Its signed date cannot be edited here.",
  reason: "Reason for correction", reasonHint: "Describe the actual correction in at least 8 characters.",
  physical: "I checked the vehicle's actual location and reviewed the selected stage and dates.",
  save: "Save manager correction", saving: "Saving and verifying…", cancel: "Cancel",
  saved: "Manager correction saved and verified.", savedRefreshFailed: "The correction was saved, but the page could not be refreshed. Reload the visit before another action.",
  failed: "The correction could not be verified. Refresh the visit before retrying.", invalid: "Check the selected stage, dates, location and reason before saving.",
  dateOrder: "Milestone dates must follow arrival, approval, work start, then ready. Correct their order before saving.",
  managerCorrection: "An administrative correction is recorded for this visit.", notRecorded: "Not recorded",
  reviewSignatureRequired: "The current review intake must be signed before moving this review to work in progress or ready.",
  stageNames: { arrived: "Arrived", approved: "Approved", in_progress: "In progress", ready: "Ready for delivery", delivered: "Delivered", cancelled: "Cancelled", needs_review: "Needs review" },
};

const ar = {
  title: "إدارة الموقع والمراحل والتواريخ",
  subtitle: "تصحيح موقع الزيارة النشطة ومرحلتها التشغيلية وتواريخها مع توثيق السبب.",
  open: "تعديل الموقع والمرحلة والتواريخ", view: "عرض التواريخ المحفوظة", close: "إغلاق", refresh: "تحديث",
  loading: "جارٍ قراءة الزيارة المحفوظة الحالية…", loadFailed: "تعذّر التحقق من الزيارة. حدّث البيانات قبل أي تعديل.",
  closed: "هذه الزيارة المسلّمة أو الملغاة للقراءة فقط. العودة الفعلية بعد التسليم تُسجّل بزيارة مراجعة جديدة مرتبطة بها.",
  protected: "لا تعتمد هذه التصحيحات المطالبة التأمينية ولا تنشئ فاتورة، ولا تغيّر النماذج والتواقيع ومحاضر التسليم النهائية.",
  stage: "المرحلة التشغيلية", location: "موقع المركبة الفعلي", inside: "داخل الورشة", customer: "مع العميل",
  locationTime: "تاريخ ووقت الموقع الفعلي", stageDates: "تواريخ وأوقات المراحل",
  dateHint: "اختر التاريخ الفعلي لكل مرحلة مسجّلة. يجب تحديد تاريخ المرحلة المختارة، ويمكن ترك المراحل غير المسجّلة فارغة.",
  timezone: "التواريخ والأوقات بتوقيت سلطنة عُمان (مسقط).",
  arrivalDate: "تاريخ ووقت الوصول", approvalDate: "تاريخ ووقت الاعتماد", workDate: "تاريخ ووقت بدء العمل", readyDate: "تاريخ ووقت الجاهزية", deliveryDate: "تاريخ ووقت التسليم النهائي",
  deliveryProtected: "يُسجّل التسليم النهائي من مسار الوصل والتوقيع. لا يمكن تعديل تاريخه الموقّع من هنا.",
  reason: "سبب التصحيح", reasonHint: "اكتب توضيحًا للتصحيح الفعلي من 8 أحرف على الأقل.",
  physical: "تحققت من موقع المركبة الفعلي وراجعت المرحلة والتواريخ المختارة.",
  save: "حفظ تصحيح المدير", saving: "جارٍ الحفظ والتحقق…", cancel: "إلغاء",
  saved: "حُفظ تصحيح المدير وتم التحقق منه.", savedRefreshFailed: "حُفظ التصحيح، لكن تعذّر تحديث الصفحة. أعد فتح الزيارة قبل أي إجراء آخر.",
  failed: "تعذّر التحقق من التصحيح. حدّث الزيارة قبل إعادة المحاولة.", invalid: "راجع المرحلة والتواريخ والموقع والسبب قبل الحفظ.",
  dateOrder: "يجب ترتيب تواريخ المراحل: الوصول ثم الاعتماد ثم بدء العمل ثم الجاهزية. صحّح ترتيبها قبل الحفظ.",
  managerCorrection: "يوجد تصحيح إداري موثّق لهذه الزيارة.", notRecorded: "غير مسجّل",
  reviewSignatureRequired: "يلزم توقيع نموذج المراجعة الحالي قبل نقل هذه المراجعة إلى قيد العمل أو الجاهزية.",
  stageNames: { arrived: "المركبات الواصلة", approved: "المركبات المعتمدة", in_progress: "قيد العمل", ready: "جاهزة للتسليم", delivered: "تم التسليم", cancelled: "ملغاة", needs_review: "تحتاج مراجعة" },
};

i18n.addResourceBundle("en", "vehicleVisitManager", en, true, true);
i18n.addResourceBundle("ar", "vehicleVisitManager", ar, true, true);
