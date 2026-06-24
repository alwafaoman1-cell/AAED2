// مساعد لإرسال رسائل واتساب جاهزة + تسجيلها في سجل الأمر
import { isPartStillNeeded, NEEDED_PART_STATUS_LABELS, type WorkOrder } from "./workOrdersStore";
import type { WaMessageKind } from "./waMessageLogStore";
import { normalizePhone } from "./phoneUtils";
import { supabase } from "@/integrations/supabase/client";
import { readSystemPreferences } from "@/lib/systemPreferences";

async function digits(s: string | undefined | null): Promise<string> {
  const prefs = await readSystemPreferences();
  return normalizePhone(s, prefs.defaultCountryCode);
}

/** اسم الورشة من إعدادات PDF (إن وجدت) */
function getCompanyName(): string {
  try {
    const raw = localStorage.getItem("alwafa_pdf_template_settings");
    if (raw) {
      const s = JSON.parse(raw);
      return s.companyName || "ورشة الوفاء";
    }
  } catch {}
  return "ورشة الوفاء";
}

// ============================================================
// قوالب الرسائل
// ============================================================

/** قالب طلب قطع غيار للعميل (إعلامه بما يحتاجه) — بدون اسم العميل */
export function buildPartsRequestMessage(order: WorkOrder, opts?: { onlyPending?: boolean }): string {
  const parts = (order.partsNeeded || []).filter((p) => (opts?.onlyPending ? isPartStillNeeded(p) : true));
  const lines: string[] = [];
  lines.push(`*طلب قطع غيار*`);
  lines.push(`أمر العمل: ${order.id}`);
  const car = `${order.vehicleType || ""} ${order.model || ""} ${order.year || ""}`.trim();
  if (car) lines.push(`السيارة: ${car}`);
  if (order.plate) lines.push(`اللوحة: ${order.plate}`);
  if (order.vin) lines.push(`رقم الهيكل (VIN): ${order.vin}`);
  lines.push("");
  lines.push(`*القطع المطلوبة (${parts.length}):*`);
  if (parts.length === 0) {
    lines.push("— لا توجد قطع مطلوبة —");
  } else {
    parts.forEach((p, i) => {
      const status = p.status ? NEEDED_PART_STATUS_LABELS[p.status] : (p.fulfilled ? "مؤمّنة" : "بانتظار");
      const note = p.notes ? ` — ${p.notes}` : "";
      lines.push(`${i + 1}. ${p.name || "(بدون اسم)"} × ${p.quantity}  [${status}]${note}`);
    });
  }
  lines.push("");
  lines.push(`الرجاء تأكيد التوفر والسعر. شكراً.`);
  lines.push(`— ${getCompanyName()}`);
  return lines.join("\n");
}

/** طلب موجه لمورد محدد لقطعة/قطع معينة — يتضمن VIN ونوع السيارة وسنة الإصدار */
export function buildSupplierPartsRequest(args: {
  supplierName: string;
  parts: { name: string; quantity: number; notes?: string }[];
  workOrder?: WorkOrder;
}): string {
  const lines: string[] = [];
  lines.push(`*طلب عرض سعر — قطع غيار*`);
  lines.push(`المورد: ${args.supplierName}`);
  if (args.workOrder) {
    const wo = args.workOrder;
    if (wo.vin) lines.push(`رقم الهيكل (VIN): ${wo.vin}`);
    const make = wo.vehicleType || "";
    const model = wo.model || "";
    if (make || model) lines.push(`نوع السيارة: ${[make, model].filter(Boolean).join(" ")}`);
    if (wo.year) lines.push(`سنة الإصدار: ${wo.year}`);
    if (wo.plate) lines.push(`اللوحة: ${wo.plate}`);
  }
  lines.push("");
  lines.push(`*القطع المطلوبة:*`);
  args.parts.forEach((p, i) => {
    const note = p.notes ? ` — ${p.notes}` : "";
    lines.push(`${i + 1}. ${p.name} × ${p.quantity}${note}`);
  });
  lines.push("");
  lines.push(`الرجاء إفادتنا بالتوفر والسعر وموعد التسليم. شكراً.`);
  lines.push(`— ${getCompanyName()}`);
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
  const { data, error } = await supabase.functions.invoke("whatsapp-meta-send", {
    body: { to: cleaned, type: "text", text: message, messageKind: "custom" },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "فشل إرسال واتساب");
}

/** يرسل عبر Edge Function؛ التسجيل يتم داخل الخادم في whatsapp_logs. */
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
  const { data, error } = await supabase.functions.invoke("whatsapp-meta-send", {
    body: {
      to: cleaned,
      type: "text",
      text: args.message,
      jobOrderId: args.workOrderId,
      customerId: args.customerId,
      vehicleId: args.vehicleId,
      insuranceClaimId: args.insuranceClaimId,
      messageKind: args.kind || "custom",
      recipientName: args.recipientName || "",
      recipientType: args.recipientType || "other",
    },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "فشل إرسال واتساب");
  return data;
}
