// مزامنة قطع الغيار من سندات الصرف لأمر العمل → فاتورة مبيعات
// كل قطعة تظهر كبند في الفاتورة بسعر البيع (unitSellPrice)
//
// ⚠️ سياسة محاسبية: WO المرتبط بمطالبة تأمين يُمنع إصدار فاتورة مبيعات له
// تُصدر فاتورته من شاشة المطالبة (insurance_invoices) لتجنّب الإيراد المزدوج و VAT مكرر.

import { salesStore, type SalesDoc, type SalesLineItem } from "./salesStore";
import { expensesStore, type ExpenseRecord } from "./expensesStore";
import type { WorkOrder } from "./workOrdersStore";

const VAT_PCT = 5;

/** يحدد ما إذا كان أمر العمل تأمينياً (يجب فوترته من المطالبة لا من المبيعات) */
export function isInsuranceWorkOrder(order: Pick<WorkOrder, "insurance" | "claimNumber">): boolean {
  const ins = (order.insurance || "").trim();
  const clm = (order.claimNumber || "").trim();
  const hasIns = ins !== "" && ins !== "-";
  const hasClm = clm !== "" && clm !== "-";
  return hasIns || hasClm;
}

/** يُلقي خطأ إذا حاول الكود إصدار فاتورة مبيعات لأمر تأميني */
export function assertNotInsuranceOrder(order: Pick<WorkOrder, "insurance" | "claimNumber">) {
  if (isInsuranceWorkOrder(order)) {
    throw new Error(
      "هذا الأمر مرتبط بمطالبة تأمين — أصدر الفاتورة الضريبية من شاشة المطالبة، لا من المبيعات."
    );
  }
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** استخراج قطع غيار سند مصروف لأمر عمل (كل سجل = قطعة واحدة) */
function partsFromExpenses(orderId: string): ExpenseRecord[] {
  return expensesStore
    .getAll()
    .filter(
      (e) =>
        e.linkedWorkOrderId === orderId &&
        e.partName &&
        (e.unitSellPrice ?? 0) > 0,
    );
}

/** البحث عن فاتورة موجودة مرتبطة بأمر العمل */
function findInvoiceForOrder(orderId: string): SalesDoc | undefined {
  return salesStore
    .list({ type: "invoice", includeDeleted: false })
    .find((d) => d.fromDocId === `WO-${orderId}` || (d.notes || "").includes(`#WO:${orderId}`));
}

function partToLineItem(p: ExpenseRecord): SalesLineItem {
  return {
    id: `EXP::${p.id}`, // مفتاح مرجعي يربط البند بسجل المصروف الأصل
    itemName: p.partNumber || p.partName || "قطعة غيار",
    description: `${p.partName ?? ""}${p.partNumber ? ` (#${p.partNumber})` : ""}`.trim() || "قطعة غيار",
    quantity: p.partQty ?? 1,
    unitPrice: p.unitSellPrice ?? 0,
    discount: 0,
    tax: VAT_PCT,
  };
}

function recompute(doc: SalesDoc): SalesDoc {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  doc.items.forEach((it) => {
    const gross = it.quantity * it.unitPrice;
    const disc = gross * (it.discount || 0) / 100;
    const net = gross - disc;
    const tax = net * (it.tax || 0) / 100;
    subtotal += gross;
    discountTotal += disc;
    taxTotal += tax;
  });
  const total = subtotal - discountTotal + taxTotal;
  return {
    ...doc,
    subtotal,
    discountTotal,
    taxTotal,
    total,
    balanceDue: Math.max(0, total - (doc.paidTotal || 0)),
  };
}

export interface SyncResult {
  invoice: SalesDoc | null;
  created: boolean;
  partsCount: number;
}

/**
 * مزامنة فاتورة قطع الغيار لأمر العمل:
 * - يجمع كل سندات صرف قطع الغيار للأمر التي لها سعر بيع > 0
 * - ينشئ/يحدّث فاتورة مبيعات (نوع invoice) باسم العميل
 * - يستبدل بنود الفاتورة الناتجة عن المصروفات (يحافظ على البنود اليدوية الأخرى)
 */
export function syncWorkOrderInvoiceFromExpenses(order: WorkOrder): SyncResult {
  // حارس مركزي: أوامر العمل التأمينية تُفوتر من شاشة المطالبة فقط
  assertNotInsuranceOrder(order);
  const parts = partsFromExpenses(order.id);
  const partLines = parts.map(partToLineItem);

  let inv = findInvoiceForOrder(order.id);
  const now = new Date().toISOString();
  let created = false;

  // بند افتراضي ثنائي اللغة عند عدم وجود قطع غيار بسعر بيع ولا بنود يدوية
  const fallbackAmount =
    Math.max(0, Number((order as any).totalCost ?? 0) - Number((order as any).laborCost ?? 0)) ||
    Number((order as any).totalCost ?? 0) ||
    0;

  const defaultLine: SalesLineItem = {
    id: `EXP::__default__`,
    itemName: "أعمال إصلاح وصيانة / Repair & Maintenance Works",
    description: "بند خدمة افتراضي / Default service item",
    quantity: 1,
    unitPrice: fallbackAmount,
    discount: 0,
    tax: VAT_PCT,
  };

  if (!inv) {
    inv = {
      id: cryptoRandom(),
      number: salesStore.nextNumber("invoice"),
      type: "invoice",
      status: "draft",
      customerName: order.customer || "غير محدد",
      date: now.slice(0, 10),
      currency: "OMR",
      items: [],
      subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0,
      paidTotal: 0, balanceDue: 0,
      payments: [], attachments: [], noteEntries: [], appointments: [],
      activity: [{ id: cryptoRandom(), at: now, text: `تم إنشاء فاتورة تلقائياً من قطع غيار أمر العمل ${order.id}` }],
      createdAt: now, updatedAt: now,
      vehicle: { plate: order.plate, make: order.vehicleType, model: order.model, year: order.year, vin: order.vin },
      fromDocId: `WO-${order.id}`,
      notes: `#WO:${order.id}`,
    };
    created = true;
  }

  // الفصل: نحتفظ بالبنود اليدوية (التي ليست EXP::) ونستبدل بنود EXP بكاملها
  const manualLines = inv.items.filter((it) => !it.id.startsWith("EXP::"));
  const usedDefault = partLines.length === 0 && manualLines.length === 0;
  const expLines = partLines.length > 0 ? partLines : (usedDefault ? [defaultLine] : []);
  inv.items = [...manualLines, ...expLines];
  inv.activity = [
    ...(inv.activity || []),
    {
      id: cryptoRandom(),
      at: now,
      text: usedDefault
        ? "تمت إضافة بند خدمة افتراضي (لا توجد قطع غيار بسعر بيع)"
        : `مزامنة قطع الغيار: ${partLines.length} بند`,
    },
  ];

  inv = recompute(inv);
  const saved = salesStore.upsert(inv);
  return { invoice: saved, created, partsCount: expLines.length };
}
