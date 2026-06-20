// =============================================================================
// QuickEmail — يفتح تطبيق البريد الافتراضي عبر mailto:
// مع عنوان تلقائي حسب نوع المستند ووصف قصير ذكي.
// =============================================================================

export type QuickEmailDocType =
  | "work_order"
  | "invoice"
  | "quote"
  | "claim_estimate"
  | "claim_invoice"
  | "claim_delivery"
  | "inspection"
  | "report"
  | "other";

export interface QuickEmailContext {
  /** نوع المستند — يُحدد قالب الوصف الافتراضي */
  docType: QuickEmailDocType;
  /** ماركة السيارة (Toyota, Nissan...) */
  vehicleMake?: string;
  /** الموديل */
  vehicleModel?: string;
  /** رقم اللوحة */
  plateNumber?: string;
  /** رقم المطالبة */
  claimNumber?: string;
  /** رقم المستند (فاتورة/عرض/أمر عمل...) */
  documentNumber?: string;
  /** اسم العميل */
  customerName?: string;
  /** اسم شركة التأمين */
  insuranceCompany?: string;
  /** رابط للملف (إن وُجد — يُضاف للوصف) */
  attachmentUrl?: string;
  /** ملاحظات إضافية */
  extraNote?: string;
  /** محتوى HTML — لو زُوّد نحاول إرفاق PDF عند الإرسال عبر Gmail */
  htmlContent?: string;
  /** اسم الملف المرفق الأساسي (بدون .pdf) */
  fileBaseName?: string;
}

const DOC_LABELS: Record<QuickEmailDocType, string> = {
  work_order: "أمر العمل",
  invoice: "الفاتورة",
  quote: "عرض السعر",
  claim_estimate: "تقدير المطالبة",
  claim_invoice: "فاتورة التأمين",
  claim_delivery: "محضر التسليم",
  inspection: "تقرير الفحص",
  report: "التقرير",
  other: "المستند",
};

/** بناء عنوان البريد التلقائي */
export function buildEmailSubject(ctx: QuickEmailContext): string {
  const parts: string[] = [];
  const label = DOC_LABELS[ctx.docType];
  parts.push(label);

  if (ctx.documentNumber) parts.push(`#${ctx.documentNumber}`);

  // ماركة + موديل + لوحة
  const veh = [ctx.vehicleMake, ctx.vehicleModel].filter(Boolean).join(" ");
  if (veh) parts.push(`— ${veh}`);
  if (ctx.plateNumber) parts.push(`(${ctx.plateNumber})`);

  if (ctx.claimNumber) parts.push(`| مطالبة ${ctx.claimNumber}`);

  return parts.join(" ");
}

/** بناء وصف قصير حسب نوع المستند */
export function buildEmailBody(ctx: QuickEmailContext): string {
  const lines: string[] = [];
  const greeting = ctx.insuranceCompany
    ? `السادة ${ctx.insuranceCompany} المحترمون،`
    : ctx.customerName
    ? `الفاضل/ة ${ctx.customerName} المحترم/ة،`
    : "تحية طيبة وبعد،";
  lines.push(greeting, "");

  // وصف ذكي حسب النوع
  switch (ctx.docType) {
    case "work_order":
      lines.push(`تجدون مرفقاً ${DOC_LABELS[ctx.docType]} الخاص بمركبتكم${ctx.plateNumber ? ` (${ctx.plateNumber})` : ""}، يتضمن مراحل الإصلاح والقطع والتكاليف.`);
      break;
    case "invoice":
      lines.push(`نرفق لكم الفاتورة${ctx.documentNumber ? ` رقم ${ctx.documentNumber}` : ""} للمراجعة والتسديد.`);
      break;
    case "quote":
      lines.push(`نرفق لكم عرض السعر للمركبة${ctx.plateNumber ? ` (${ctx.plateNumber})` : ""} لاطلاعكم واعتماده.`);
      break;
    case "claim_estimate":
      lines.push(`نرفق لكم تقدير تكلفة الإصلاح للمطالبة ${ctx.claimNumber || ""} الخاصة بالمركبة${ctx.plateNumber ? ` (${ctx.plateNumber})` : ""} لاعتمادها.`);
      break;
    case "claim_invoice":
      lines.push(`نرفق فاتورة التأمين للمطالبة ${ctx.claimNumber || ""} للمراجعة والتسديد ضمن الجدول الزمني المتفق عليه.`);
      break;
    case "claim_delivery":
      lines.push(`نرفق محضر تسليم المركبة${ctx.plateNumber ? ` (${ctx.plateNumber})` : ""} ضمن المطالبة ${ctx.claimNumber || ""} موقعاً ومختوماً.`);
      break;
    case "inspection":
      lines.push(`نرفق تقرير الفحص الفني للمركبة${ctx.plateNumber ? ` (${ctx.plateNumber})` : ""} يتضمن الأضرار والتوصيات.`);
      break;
    case "report":
      lines.push(`نرفق التقرير المطلوب للمراجعة.`);
      break;
    default:
      lines.push(`نرفق ${DOC_LABELS[ctx.docType]} للمراجعة.`);
  }

  if (ctx.extraNote) {
    lines.push("", ctx.extraNote);
  }

  if (ctx.attachmentUrl) {
    lines.push("", `رابط المستند: ${ctx.attachmentUrl}`);
  }

  lines.push(
    "",
    "للاستفسار يُرجى التواصل معنا.",
    "",
    "مع التحية،",
    "شركة الوفاء للأعمال المتكاملة"
  );
  return lines.join("\n");
}

/** يفتح نافذة البريد الافتراضية مع كل البيانات معبأة */
export function openQuickEmail(opts: {
  to?: string;
  cc?: string;
  bcc?: string;
  ctx: QuickEmailContext;
}): void {
  const subject = buildEmailSubject(opts.ctx);
  const body = buildEmailBody(opts.ctx);
  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  if (opts.cc) params.set("cc", opts.cc);
  if (opts.bcc) params.set("bcc", opts.bcc);

  const to = opts.to ? encodeURIComponent(opts.to) : "";
  // mailto لا يقبل URLSearchParams بالكامل — نبني يدوياً ليتعامل مع \n بشكل صحيح
  const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${
    opts.cc ? `&cc=${encodeURIComponent(opts.cc)}` : ""
  }${opts.bcc ? `&bcc=${encodeURIComponent(opts.bcc)}` : ""}`;
  const url = `mailto:${to}?${qs}`;
  window.location.href = url;
}
