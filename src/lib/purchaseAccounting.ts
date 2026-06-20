// منطق ترحيل عمليات المشتريات إلى دفتر اليومية + المتوسط المرجّح للتكلفة
import {
  applyWeightedAverageCost,
  inventoryStore,
  reduceStock,
} from "./inventoryStore";
import {
  addJournalEntry,
  removeJournalBySource,
} from "./journalStore";
import {
  getPurchaseTotals,
  type PurchaseInvoice,
} from "./purchaseInvoicesStore";
import type { SupplierPayment } from "./supplierPaymentsStore";
import type { PurchaseReturn } from "./purchaseReturnsStore";

/**
 * عند إنشاء فاتورة شراء جديدة:
 *  1) لكل بند مرتبط بصنف من المخزون -> تطبيق المتوسط المرجّح + زيادة الكمية
 *  2) قيود يومية:
 *     - مدين: المخزون           دائن: ذمم الموردين     (المجموع الفرعي بدون ضريبة)
 *     - مدين: ضريبة القيمة المضافة  دائن: ذمم الموردين     (الضريبة)
 *     - مدين: مصاريف شحن        دائن: ذمم الموردين     (الشحن إن وجد)
 */
export function postPurchaseInvoice(inv: PurchaseInvoice): void {
  // إزالة أي قيود قديمة لهذه الفاتورة (في حال التعديل)
  removeJournalBySource("purchase_invoice", inv.id);

  // المخزون + المتوسط المرجح
  inv.items.forEach((it) => {
    if (it.partId && it.qty > 0) {
      applyWeightedAverageCost(it.partId, it.qty, it.unitPrice);
    }
  });

  const totals = getPurchaseTotals(inv);
  const date = inv.date;

  // قيد المخزون
  if (totals.subtotal - totals.discountAmt > 0) {
    addJournalEntry({
      date,
      source: "purchase_invoice",
      sourceId: inv.id,
      debitAccount: "المخزون",
      creditAccount: "ذمم الموردين",
      amount: Number((totals.subtotal - totals.discountAmt).toFixed(3)),
      description: `فاتورة شراء ${inv.id} — ${inv.supplierName}`,
    });
  }

  // قيد الضريبة
  if (totals.tax > 0) {
    addJournalEntry({
      date,
      source: "purchase_invoice",
      sourceId: inv.id,
      debitAccount: "ضريبة القيمة المضافة",
      creditAccount: "ذمم الموردين",
      amount: Number(totals.tax.toFixed(3)),
      description: `ضريبة فاتورة شراء ${inv.id}`,
    });
  }

  // قيد الشحن
  if (inv.shipping > 0) {
    addJournalEntry({
      date,
      source: "purchase_invoice",
      sourceId: inv.id,
      debitAccount: "مصاريف شحن",
      creditAccount: "ذمم الموردين",
      amount: Number(inv.shipping.toFixed(3)),
      description: `شحن فاتورة شراء ${inv.id}`,
    });
  }

  // ملاحظة: تم حذف قيد "الدفع الفوري" من هنا لتفادي مسح ذمم الموردين مرتين
  // (مرة هنا، ومرة عند تسجيل سند دفع للمورد عبر postSupplierPayment).
  // إن كانت الفاتورة مدفوعة فوراً، يجب إنشاء SupplierPayment منفصل ليتم ترحيله بشكل صحيح.
}

/** عند تسجيل دفعة لمورد:
 *   مدين: ذمم الموردين     دائن: النقدية / البنك   (حسب طريقة الدفع)
 */
export function postSupplierPayment(p: SupplierPayment): void {
  removeJournalBySource("supplier_payment", p.id);
  const credit: "النقدية" | "البنك" =
    p.method === "تحويل بنكي" || p.method === "شيك" ? "البنك" : "النقدية";
  addJournalEntry({
    date: p.date,
    source: "supplier_payment",
    sourceId: p.id,
    debitAccount: "ذمم الموردين",
    creditAccount: credit,
    amount: Number(p.amount.toFixed(3)),
    description: `دفعة ${p.id} — ${p.supplierName}${
      p.invoiceId ? ` (فاتورة ${p.invoiceId})` : ""
    }`,
  });
}

/** عند مرتجع مشتريات:
 *  - إنقاص المخزون (دون تغيير المتوسط)
 *  - مدين: ذمم الموردين     دائن: مرتجعات المشتريات
 */
export function postPurchaseReturn(r: PurchaseReturn): void {
  removeJournalBySource("purchase_return", r.id);
  r.items.forEach((it) => {
    if (it.partId && it.qty > 0) reduceStock(it.partId, it.qty);
  });
  addJournalEntry({
    date: r.date,
    source: "purchase_return",
    sourceId: r.id,
    debitAccount: "ذمم الموردين",
    creditAccount: "مرتجعات المشتريات",
    amount: Number(r.total.toFixed(3)),
    description: `مرتجع شراء ${r.id} — ${r.supplierName} (فاتورة ${r.invoiceId})`,
  });
}

/** قيود عكسية أو إزالة عند حذف مستند */
export function unpostPurchaseInvoice(inv: PurchaseInvoice): void {
  // إعادة الكميات إلى ما قبل الفاتورة
  inv.items.forEach((it) => {
    if (it.partId && it.qty > 0) {
      const part = inventoryStore.getById(it.partId);
      if (part) inventoryStore.update(part.id, { stock: Math.max(0, part.stock - it.qty) });
    }
  });
  removeJournalBySource("purchase_invoice", inv.id);
}

/** عكس مرتجع مشتريات عند الحذف: إعادة الكميات للمخزون + حذف القيد */
export function unpostPurchaseReturn(r: PurchaseReturn): void {
  r.items.forEach((it) => {
    if (it.partId && it.qty > 0) {
      const part = inventoryStore.getById(it.partId);
      if (part) inventoryStore.update(part.id, { stock: (part.stock || 0) + it.qty });
    }
  });
  removeJournalBySource("purchase_return", r.id);
}
