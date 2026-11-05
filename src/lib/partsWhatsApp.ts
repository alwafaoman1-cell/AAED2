// مساعد لإرسال رسائل واتساب جاهزة + تسجيلها في سجل الأمر
import { isPartStillNeeded, NEEDED_PART_STATUS_LABELS, type WorkOrder } from "./workOrdersStore";
import type { WaMessageKind } from "./waMessageLogStore";
import { normalizePhone } from "./phoneUtils";
import { readSystemPreferences } from "@/lib/systemPreferences";
import { sendUnifiedMessage } from "@/lib/messaging/messagingService";
import i18n from "@/i18n";
import "@/lib/i18n/supervisorWorkspace";

async function digits(s: string | undefined | null): Promise<string> {
  const prefs = await readSystemPreferences();
  return normalizePhone(s, prefs.defaultCountryCode);
}

/** اسم الورشة من إعدادات PDF (إن وجدت) */
function getCompanyName(): string {
  try {
    const raw = "";
    if (raw) {
      const s = JSON.parse(raw);
      return s.companyName || "ورشة الوفاء";
    }
  } catch {
    // Use the workshop fallback name when tenant settings are unavailable.
  }
  return "ورشة الوفاء";
}

// ============================================================
// قوالب الرسائل
// ============================================================

/** Language is explicit for reviewed drafts; defaults to the active UI language. */
export function buildPartsRequestMessage(order: WorkOrder, opts?: { onlyPending?: boolean; language?: "ar" | "en" }): string {
  const language = opts?.language || (i18n.language.startsWith("en") ? "en" : "ar");
  const tr = (key: string) => i18n.t(key, { ns: "supervisorWorkspace", lng: language });
  const parts = (order.partsNeeded || []).filter((part) => !opts?.onlyPending || isPartStillNeeded(part));
  const lines = [`*${tr("partsTemplateTitle")}*`, `${tr("partsTemplateOrder")}: ${order.displayNumber || order.id}`];
  const vehicle = [order.vehicleType, order.model, order.year].filter(Boolean).join(" ");
  if (vehicle) lines.push(`${tr("partsTemplateVehicle")}: ${vehicle}`);
  if (order.plate) lines.push(`${tr("partsTemplatePlate")}: ${order.plate}`);
  if (order.vin) lines.push(`${tr("partsTemplateVin")}: ${order.vin}`);
  lines.push("", `*${tr("partsTemplateItems")} (${parts.length}):*`);
  if (!parts.length) lines.push(`— ${tr("partsTemplateEmpty")} —`);
  const statusKeys = { pending: "partsTemplatePending", ordered: "partsTemplateOrdered", secured: "partsTemplateSecured", received: "partsTemplateReceived" };
  parts.forEach((part, index) => {
    const status = tr(part.status ? statusKeys[part.status] : part.fulfilled ? "partsTemplateSecured" : "partsTemplatePending");
    lines.push(`${index + 1}. ${part.name || tr("partsTemplateUnnamed")} × ${part.quantity}  [${status}]${part.notes ? " — " + part.notes : ""}`);
  });
  lines.push("", tr("partsTemplateFooter"), `— ${tr("partsTemplateCompany")}`);
  return lines.join("\n");
}

export function buildSupplierPartsRequest(args: {
  supplierName: string;
  parts: { name: string; quantity: number; notes?: string }[];
  workOrder?: WorkOrder;
  language?: "ar" | "en";
}): string {
  const language = args.language || (i18n.language.startsWith("en") ? "en" : "ar");
  const tr = (key: string) => i18n.t(key, { ns: "supervisorWorkspace", lng: language });
  const lines = [`*${tr("partsTemplateSupplierTitle")}*`, `${tr("supplier")}: ${args.supplierName}`];
  const order = args.workOrder;
  if (order) {
    lines.push(`${tr("partsTemplateOrder")}: ${order.displayNumber || order.id}`);
    if (order.vin) lines.push(`${tr("partsTemplateVin")}: ${order.vin}`);
    const vehicle = [order.vehicleType, order.model].filter(Boolean).join(" ");
    if (vehicle) lines.push(`${tr("partsTemplateVehicle")}: ${vehicle}`);
    if (order.year) lines.push(`${tr("partsTemplateYear")}: ${order.year}`);
    if (order.plate) lines.push(`${tr("partsTemplatePlate")}: ${order.plate}`);
  }
  lines.push("", `*${tr("partsTemplateItems")}:*`);
  args.parts.forEach((part, index) => lines.push(`${index + 1}. ${part.name || tr("partsTemplateUnnamed")} × ${part.quantity}${part.notes ? " — " + part.notes : ""}`));
  lines.push("", tr("partsTemplateSupplierFooter"), `— ${tr("partsTemplateCompany")}`);
  return lines.join("\n");
}

/** قالب جماعي لكل الأوامر التي تحتاج قطع */
export function buildBulkPartsRequestMessage(orders: WorkOrder[]): string {
  const lines: string[] = [];
  lines.push(`*طلب قطع غيار — ${orders.length} سيارة*`);
  lines.push(`التاريخ: ${new Date().toLocaleDateString("ar-SA")}`);
  lines.push("");
  orders.forEach((o, idx) => {
    const parts = (o.partsNeeded || []).filter(isPartStillNeeded);
    if (parts.length === 0) return;
    const car = `${o.vehicleType || ""} ${o.model || ""} ${o.year || ""}`.trim();
    lines.push(`*${idx + 1}) ${o.id} — ${o.customer}*`);
    lines.push(`   ${car} · ${o.plate}`);
    parts.forEach((p, i) => {
      const status = p.status ? NEEDED_PART_STATUS_LABELS[p.status] : (p.fulfilled ? "مؤمّنة" : "بانتظار");
      const note = p.notes ? ` — ${p.notes}` : "";
      lines.push(`   ${i + 1}. ${p.name || "(بدون اسم)"} × ${p.quantity}  [${status}]${note}`);
    });
    lines.push("");
  });
  lines.push(`الرجاء تأكيد التوفر والأسعار. شكراً.`);
  lines.push(`— ${getCompanyName()}`);
  return lines.join("\n");
}

/** إشعار جاهزية السيارة للاستلام */
export function buildReadyForPickupMessage(order: WorkOrder): string {
  const car = `${order.vehicleType || ""} ${order.model || ""} ${order.year || ""}`.trim();
  return [
    `مرحباً ${order.customer} 👋`,
    ``,
    `سيارتك *${car}* — اللوحة *${order.plate}* أصبحت *جاهزة للاستلام* ✅`,
    ``,
    `أمر العمل: ${order.id}`,
    `الإجمالي: ${order.totalCost.toLocaleString()} ر.ع`,
    ``,
    `يرجى التواصل لتنسيق موعد الاستلام.`,
    `— ${getCompanyName()}`,
  ].join("\n");
}

/** متابعة دفع/فاتورة معلّقة */
export function buildPaymentFollowupMessage(order: WorkOrder): string {
  const car = `${order.vehicleType || ""} ${order.model || ""}`.trim();
  return [
    `مرحباً ${order.customer} 🙏`,
    ``,
    `تذكير ودي بخصوص فاتورة سيارتك *${car}* — اللوحة *${order.plate}*`,
    `أمر العمل: ${order.id}`,
    `المبلغ المستحق: *${order.totalCost.toLocaleString()} ر.ع*`,
    ``,
    `نأمل التكرم بالسداد في أقرب وقت. شكراً لثقتكم.`,
    `— ${getCompanyName()}`,
  ].join("\n");
}

/** قالب رسالة افتراضية / مخصصة */
export function buildCustomGreeting(order: WorkOrder): string {
  return [
    `مرحباً ${order.customer} 👋`,
    ``,
    `بخصوص أمر العمل ${order.id} (${order.plate}):`,
    ``,
    `[اكتب رسالتك هنا]`,
    ``,
    `— ${getCompanyName()}`,
  ].join("\n");
}

// ============================================================
// الإرسال + التسجيل
// ============================================================

/** يفتح واتساب برسالة جاهزة. إن لم يُمرَّر رقم، يفتح اختيار جهة الاتصال. */
export async function openWhatsAppWithMessage(message: string, phone?: string) {
  const cleaned = await digits(phone);
  if (!cleaned) throw new Error("رقم الهاتف غير صالح");
  return sendUnifiedMessage({
    channel: "whatsapp",
    recipientPhone: cleaned,
    body: message,
    templateType: "custom",
  });
}

/** Sends through the unified messaging Edge Function; provider details are logged server-side. */
export async function sendWhatsAppAndLog(args: {
  message: string;
  phone?: string;
  workOrderId: string;
  kind: WaMessageKind;
  recipientName: string;
  recipientType: "customer" | "supplier" | "other";
}) {
  return sendWhatsAppMessage({
    message: args.message,
    phone: args.phone,
    workOrderId: args.workOrderId,
    kind: args.kind,
    recipientName: args.recipientName,
    recipientType: args.recipientType,
  });
}

export async function sendWhatsAppMessage(args: {
  message: string;
  phone?: string;
  workOrderId?: string;
  customerId?: string;
  vehicleId?: string;
  insuranceClaimId?: string;
  kind?: WaMessageKind;
  recipientName?: string;
  recipientType?: "customer" | "supplier" | "other";
}) {
  const cleaned = await digits(args.phone);
  if (!cleaned) throw new Error("رقم الهاتف غير صالح");
  return sendUnifiedMessage({
    channel: "whatsapp",
    recipientPhone: cleaned,
    body: args.message,
    workOrderId: args.workOrderId,
    customerId: args.customerId,
    vehicleId: args.vehicleId,
    claimId: args.insuranceClaimId,
    templateType: args.kind || "custom",
  });
}
