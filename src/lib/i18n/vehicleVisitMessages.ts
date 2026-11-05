import i18n from "@/i18n";
const ar = {
  title: "رسائل عميل الزيارة", loading: "جارٍ التحقق من الزيارة والعميل والموقع الحالي…", retry: "تحديث والتحقق مجددًا",
  approval: "موافقة التأمين", entry_receipt: "رابط استلام وتوقيع الدخول", temporary_release: "محضر الخروج المؤقت المكتمل",
  in_workshop: "داخل الورشة", with_customer: "مع العميل", pending: "المطالبة ليست معتمدة بعد. لن تُجهز رسالة موافقة أو تُرسل تلقائيًا.",
  noEntry: "لا يوجد كرت دخول مرتبط. لا يمكن إنشاء رابط استلام قبل حفظ وإصدار الدخول الفعلي.",
  manual: "مسودة للمراجعة فقط. لا تُرسل أي رسالة تلقائيًا. الإرسال عبر مزود واتساب الحالي وقد يتطلب قالب Meta معتمدًا.",
  prepare: "تجهيز المسودة / الرابط", prepareLink: "إنشاء رابط التوقيع وإعداد المسودة", body: "نص الرسالة", reviewed: "راجعت النص والعميل والموقع الحالي وأوافق على الإرسال",
  prepareViewLink: "تجهيز رابط قراءة المحضر الموقع",
  send: "إرسال عبر واتساب", sending: "جارٍ الإرسال…", sent: "أكد المزود قبول الرسالة. لا يعني ذلك وصولها أو قراءتها.",
  recent: "آخر رسائل هذه الزيارة", empty: "لا توجد رسائل مطابقة مسجلة.", logsFailed: "تعذر تحميل سجل الرسائل؛ أعد المحاولة.",
  eventRecorded: "هذا الحدث مسجل مسبقًا. راجع حالته في السجل؛ لن نرسل موافقة مكررة أو نفرض إعادة المحاولة.",
  provider: "لم يؤكد مزود واتساب الإرسال. راجع إعداداته أو متطلبات القالب قبل إعادة المحاولة.",
  approve: "اعتماد المطالبة", amount: "المبلغ الموافق عليه (OMR)", approveConfirm: "أؤكد مبلغ وموافقة التأمين لهذه المطالبة", approveRole: "اعتماد المطالبة متاح للمدير أو المسؤول فقط.",
  approveFailed: "لم يتأكد اعتماد المطالبة. أعد تحميلها قبل المحاولة مجددًا.", approved: "تم التحقق من اعتماد المطالبة. راجع الرسالة قبل إرسالها.", close: "إغلاق",
  errors: {
    FORBIDDEN: "لا توجد صلاحية نشطة لإدارة رسائل هذه الورشة.", STALE: "تغيرت الزيارة أو العميل أو الموقع. حدّث وراجع مسودة جديدة؛ لم تُرسل رسالة.",
    IDENTITY: "يلزم معرّف دخول أو مطالبة صحيح.", CONFLICT: "روابط أو موقع الزيارة بحاجة للمراجعة. لن نربط أو نصحح السجلات تلقائيًا.",
    CUSTOMER_UNAVAILABLE: "عميل الزيارة المحدد لم يعد متاحًا. لن نستخدم مالك المركبة التاريخي بدلًا منه.", PHONE: "يلزم هاتف صالح لعميل الزيارة.",
    PENDING_APPROVAL: "لا يمكن إرسال موافقة لمطالبة غير معتمدة.", ENTRY_REQUIRED: "يلزم دخول محفوظ ومُصدر ومركبة داخل الورشة لرابط الاستلام.",
    LEGACY_APPROVAL: "توجد موافقة في قائمة الإشعارات السابقة أو فُتحت مسودة واتساب لها. هذا ليس إثبات توصيل. راجع السجل قبل حسمها؛ لن تُرسل موافقة ثانية من هذه اللوحة.",
    RELEASE_REQUIRED: "يلزم محضر خروج مؤقت موقع ومكتمل وغير مسجل كعودة.", RELEASE_LINK_UNAVAILABLE: "محضر الخروج موقع، لكن الواجهة الحالية لا تعيد إصدار رابط قراءة له. لا نعيد فتحه أو نرسل رابطًا داخليًا بدلًا منه.", BODY: "راجع نص الرسالة (بحد أقصى 4000 حرف).",
  },
  statuses: { queued: "في الانتظار", sent: "مقبولة من المزود", delivered: "تم التوصيل", read: "مقروءة", failed: "فشل", dry_run: "تجربة فقط", unknown: "حالة غير مؤكدة" },
  bodies: {
    approval_with_customer: "مرحبًا {{customer}}، تمت موافقة التأمين على المطالبة {{claim}}. المركبة: {{vehicle}} · اللوحة: {{plate}} · أمر العمل: {{order}}. مركبتكم مسجلة حاليًا معكم. يرجى التواصل معنا لتحديد موعد إحضار المركبة إلى الورشة. لا تعني الموافقة أن الإصلاح بدأ.",
    approval_in_workshop: "مرحبًا {{customer}}، تمت موافقة التأمين على المطالبة {{claim}} لمركبتكم الموجودة داخل الورشة. المركبة: {{vehicle}} · اللوحة: {{plate}} · أمر العمل: {{order}}. سننسق أعمال الإصلاح المعتمدة ونوافيكم بالتحديثات. لا تعني هذه الرسالة أن الإصلاح اكتمل.",
    entry_receipt: "مرحبًا {{customer}}، هذا رابط مراجعة وتوقيع مستند استلام المركبة للدخول {{entry}}. أمر العمل: {{order}}. المطالبة: {{claim}}. هذا ليس محضر خروج أو تسليم نهائي.\n{{link}}",
    temporary_release: "مرحبًا {{customer}}، هذا رابط قراءة محضر المعاينة والخروج المؤقت الموقع {{release}} للدخول {{entry}}. المركبة مسجلة حاليًا معكم. النسخة للقراءة فقط ولا تطلب توقيعًا جديدًا، وليست محضر تسليم إصلاح نهائي.\n{{link}}",
  },
};
const en = {
  title: "Visit customer messages", loading: "Verifying the visit, customer and current location…", retry: "Refresh and verify",
  approval: "Insurance approval", entry_receipt: "Entry receipt / signature link", temporary_release: "Completed temporary-release report",
  in_workshop: "Inside workshop", with_customer: "With customer", pending: "This claim is not approved. No approval message will be prepared or sent automatically.",
  noEntry: "No entry is linked. A receipt link requires a saved, issued record of the actual arrival.",
  manual: "Draft for review only. Nothing is sent automatically. The current WhatsApp provider may require an approved Meta template.",
  prepare: "Prepare draft / link", prepareLink: "Create signature link and draft", body: "Message text", reviewed: "I reviewed the message, customer and current location and authorize sending",
  prepareViewLink: "Prepare signed report read-only link",
  send: "Send via WhatsApp", sending: "Sending…", sent: "The provider confirmed acceptance. This does not confirm delivery or reading.",
  recent: "Recent messages for this visit", empty: "No matching messages are recorded.", logsFailed: "Message history could not be loaded. Try again.",
  eventRecorded: "This business event is already recorded. Review its status in history; no duplicate approval or forced retry will be sent.",
  provider: "WhatsApp sending was not confirmed. Check provider settings or template requirements before retrying.",
  approve: "Approve claim", amount: "Approved amount (OMR)", approveConfirm: "I confirm this claim's insurance approval and amount", approveRole: "Only an admin or manager can approve the claim.",
  approveFailed: "Claim approval was not confirmed. Reload before retrying.", approved: "Claim approval verified. Review the message before sending.", close: "Close",
  errors: {
    FORBIDDEN: "An active, authorized workshop profile is required.", STALE: "The visit, customer or location changed. Refresh and review a new draft; no message was sent.",
    IDENTITY: "A valid entry or claim UUID is required.", CONFLICT: "Visit links or custody require review. No records will be relinked or repaired automatically.",
    CUSTOMER_UNAVAILABLE: "The selected visit customer is unavailable. The vehicle's historical owner will not be substituted.", PHONE: "The visit customer needs a valid phone number.",
    PENDING_APPROVAL: "An unapproved claim cannot receive an approval message.", ENTRY_REQUIRED: "A saved, issued entry and workshop custody are required for the receipt link.",
    LEGACY_APPROVAL: "An approval is already queued in the legacy notifications or its WhatsApp draft was opened. This is not delivery proof. Review that history first; this panel will not send a second approval.",
    RELEASE_REQUIRED: "A signed, completed temporary release with no recorded return is required.", RELEASE_LINK_UNAVAILABLE: "This release is signed, but the existing API cannot reissue a read-only receipt link. It will not be reopened or replaced with an internal staff URL.", BODY: "Review the message text (maximum 4,000 characters).",
  },
  statuses: { queued: "Queued", sent: "Provider accepted", delivered: "Delivered", read: "Read", failed: "Failed", dry_run: "Dry run only", unknown: "Unconfirmed status" },
  bodies: {
    approval_with_customer: "Hello {{customer}}, insurance approved claim {{claim}}. Vehicle: {{vehicle}} · Plate: {{plate}} · Work order: {{order}}. Your vehicle is currently recorded with you. Please contact us to schedule its arrival at the workshop. Approval does not mean repairs have started.",
    approval_in_workshop: "Hello {{customer}}, insurance approved claim {{claim}} for your vehicle currently inside the workshop. Vehicle: {{vehicle}} · Plate: {{plate}} · Work order: {{order}}. We will coordinate the approved repairs and keep you updated. This message does not mean repairs are complete.",
    entry_receipt: "Hello {{customer}}, please review and sign the vehicle entry receipt for entry {{entry}}. Work order: {{order}}. Claim: {{claim}}. This is not a temporary-release or final-delivery receipt.\n{{link}}",
    temporary_release: "Hello {{customer}}, this is your signed inspection and temporary-release report {{release}} for entry {{entry}}. Your vehicle is currently recorded with you. This copy is read-only and does not request another signature. It is not final repair delivery.\n{{link}}",
  },
};
for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "translation", { vehicleVisitMessages: resources }, true, false);
}
