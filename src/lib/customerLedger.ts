// كشف حساب العميل — يجمع كل الحركات المالية (فواتير، مدفوعات، عرابين، إشعارات دائنة)
import { getWorkOrders } from "./workOrdersStore";
import { depositsStore } from "./depositsStore";
import { getCustomerCreditNotes } from "./creditNotesStore";
import { salesStore } from "./salesStore";

function norm(s: string) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

export type LedgerEntryType =
  | "invoice"
  | "work_order"
  | "receipt"
  | "deposit"
  | "credit_note";

export interface LedgerEntry {
  id: string;
  date: string;
  type: LedgerEntryType;
  reference: string;         // رقم/معرف المستند
  description: string;       // وصف الحركة
  debit: number;             // مدين (مستحق على العميل)
  credit: number;            // دائن (دفعات/أرصدة لصالح العميل)
  balance: number;           // الرصيد الجاري بعد هذه الحركة
}

export interface CustomerLedger {
  customer: string;
  entries: LedgerEntry[];
  totalDebit: number;        // إجمالي الفواتير
  totalCredit: number;       // إجمالي المدفوعات + العرابين + الإشعارات الدائنة
  outstanding: number;       // المستحق (debit - credit)
  invoicesCount: number;
  paidInvoicesCount: number;
  pendingInvoicesCount: number;
  lastInvoice?: { id: string; amount: number; date: string };
  lastPayment?: { id: string; amount: number; date: string };
}

interface RawReceipt {
  id: string;
  number?: string;
  date: string;
  amount: number;
  payerName?: string;
  notes?: string;
}

function loadReceipts(): RawReceipt[] {
  return salesStore.list({ type: "invoice" }).flatMap((doc) =>
    (doc.payments || []).map((payment) => ({
      id: payment.id,
      number: payment.reference,
      date: payment.date,
      amount: payment.amount,
      payerName: doc.customerName,
      notes: payment.note,
    }))
  );
}

function loadSalesDocs() {
  return salesStore.list({ type: "invoice" }).map((doc) => ({
    ...doc,
    customer: doc.customerName,
  }));
}

export function getCustomerLedger(customer: string): CustomerLedger {
  const k = norm(customer);

  // مصادر البيانات
  const orders = getWorkOrders().filter((o) => norm(o.customer) === k);
  const receipts = loadReceipts().filter((r) => norm(r.payerName || "") === k);
  const salesDocs = loadSalesDocs().filter((d) => d.type === "invoice" && norm(d.customer) === k);
  const deposits = depositsStore.getAll().filter((d) => norm(d.customer) === k);
  const creditNotes = getCustomerCreditNotes(customer);

  // بناء قائمة الحركات
  const entries: LedgerEntry[] = [];

  // نتجنّب احتساب أمر العمل + فاتورته المرتبطة مرّتين:
  // إذا أمر العمل له فاتورة مبيعات مُولّدة (workOrderInvoiceSync ينشئ SalesDoc برقم WO-<id>)
  // نُسقط أمر العمل من السجل ونعتمد على الفاتورة فقط.
  const linkedOrderIds = new Set<string>();
  for (const inv of salesDocs) {
    const fromId = (inv as any).fromDocId || "";
    const m = String(fromId).match(/^WO-(.+)$/);
    if (m) linkedOrderIds.add(m[1]);
    const notes = (inv as any).notes || "";
    const m2 = String(notes).match(/#WO:([^\s]+)/);
    if (m2) linkedOrderIds.add(m2[1]);
  }

  // أوامر العمل تُحتسب كفواتير مدينة (فقط إن لم تُولّد لها فاتورة منفصلة)
  for (const o of orders) {
    if (!o.totalCost) continue;
    if (linkedOrderIds.has(o.id)) continue;
    entries.push({
      id: `wo-${o.id}`,
      date: o.entryDate,
      type: "work_order",
      reference: o.id,
      description: `أمر عمل ${o.serviceType} - ${o.plate}`,
      debit: o.totalCost,
      credit: 0,
      balance: 0,
    });
  }

  for (const inv of salesDocs) {
    entries.push({
      id: `inv-${inv.id}`,
      date: inv.date,
      type: "invoice",
      reference: inv.id,
      description: `فاتورة ${inv.id}`,
      debit: inv.total,
      credit: 0,
      balance: 0,
    });
  }

  for (const r of receipts) {
    entries.push({
      id: `rec-${r.id}`,
      date: r.date,
      type: "receipt",
      reference: r.number || r.id,
      description: `سند قبض ${r.notes || ""}`.trim(),
      debit: 0,
      credit: r.amount,
      balance: 0,
    });
  }

  for (const d of deposits) {
    entries.push({
      id: `dep-${d.id}`,
      date: d.date,
      type: "deposit",
      reference: d.receiptNumber,
      description: `عربون ${d.scope === "vehicle" ? `(${d.plate})` : ""}`,
      debit: 0,
      credit: d.amount - (d.consumed || 0),
      balance: 0,
    });
  }

  for (const c of creditNotes) {
    if (c.status === "void") continue;
    entries.push({
      id: `cn-${c.id}`,
      date: c.date,
      type: "credit_note",
      reference: c.number,
      description: `إشعار دائن - ${c.reason}`,
      debit: 0,
      credit: c.amount,
      balance: 0,
    });
  }

  // ترتيب تصاعدي بالتاريخ ثم حساب الرصيد الجاري
  entries.sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  for (const e of entries) {
    running += e.debit - e.credit;
    e.balance = running;
  }

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  const invoiceLikeEntries = entries.filter((e) => e.type === "invoice" || e.type === "work_order");
  const lastInvoiceEntry = invoiceLikeEntries[invoiceLikeEntries.length - 1];
  const paymentEntries = entries.filter((e) => e.type === "receipt" || e.type === "deposit");
  const lastPaymentEntry = paymentEntries[paymentEntries.length - 1];

  return {
    customer,
    entries: entries.slice().reverse(), // عرض الأحدث أولاً
    totalDebit,
    totalCredit,
    outstanding: Math.max(0, totalDebit - totalCredit),
    invoicesCount: invoiceLikeEntries.length,
    paidInvoicesCount: orders.filter((o) =>
      ["تم التسليم", "مغلق", "جاهز للتسليم"].includes(o.status)
    ).length,
    pendingInvoicesCount: orders.filter((o) =>
      !["تم التسليم", "مغلق", "جاهز للتسليم"].includes(o.status)
    ).length,
    lastInvoice: lastInvoiceEntry ? {
      id: lastInvoiceEntry.reference,
      amount: lastInvoiceEntry.debit,
      date: lastInvoiceEntry.date,
    } : undefined,
    lastPayment: lastPaymentEntry ? {
      id: lastPaymentEntry.reference,
      amount: lastPaymentEntry.credit,
      date: lastPaymentEntry.date,
    } : undefined,
  };
}
