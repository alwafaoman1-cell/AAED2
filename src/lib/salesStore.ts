// نظام المبيعات الموحد — تخزين محلي لكل أنواع المستندات
// (الفواتير، عروض الأسعار، الإشعارات الدائنة، الفواتير المرتجعة، الفواتير الدورية، دفعات العملاء)
import { resolveSeriesByPrefix } from "@/lib/numberingSettings";


export type SalesDocType =
  | "invoice"
  | "quote"
  | "credit_note"
  | "return_invoice"
  | "recurring_invoice"
  | "customer_payment";

export type SalesDocStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "paid"
  | "partial"
  | "unpaid"
  | "overdue"
  | "cancelled"
  | "converted";

export interface SalesLineItem {
  id: string;
  itemName?: string;   // اسم/رقم الصنف (اختياري للتوافق مع البيانات السابقة)
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number; // %
  tax: number;      // %
  inventoryId?: string;
}

export interface SalesPayment {
  id: string;
  date: string;
  amount: number;
  method: string;       // نقدي / بنك / شيك / محفظة
  reference?: string;
  note?: string;
}

export interface SalesAttachment {
  id: string;
  name: string;
  dataUrl: string;     // base64 لتخزين محلي
  size: number;
  uploadedAt: string;
}

export interface SalesNote {
  id: string;
  text: string;
  author?: string;
  createdAt: string;
}

export interface SalesAppointment {
  id: string;
  date: string;
  time?: string;
  title: string;
  note?: string;
}

export interface SalesDoc {
  id: string;                       // مفتاح فريد داخلي
  number: string;                   // رقم الفاتورة المعروض (00001 …)
  type: SalesDocType;
  status: SalesDocStatus;
  customerId?: string;
  customerName: string;
  customerAddress?: string;
  customerTaxNo?: string;
  date: string;                      // ISO
  dueDate?: string;
  currency: string;                  // OMR
  items: SalesLineItem[];
  notes?: string;                    // ملاحظة على المستند
  terms?: string;
  // محسوبات
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  balanceDue: number;
  // مراكز تكلفة
  costCenter?: string;
  // مرجع/تحويل
  fromDocId?: string;                // مثلا فاتورة محولة من عرض سعر
  fromDocType?: SalesDocType;
  // مرفقات/ملاحظات/مواعيد
  payments: SalesPayment[];
  attachments: SalesAttachment[];
  noteEntries: SalesNote[];
  appointments: SalesAppointment[];
  // التواريخ
  createdAt: string;
  updatedAt: string;
  // سجل النشاطات
  activity: { id: string; at: string; text: string; }[];
  // تكرار للفواتير الدورية
  recurrence?: { every: number; unit: "day" | "week" | "month" | "year"; nextRun?: string; };
  // معلومات السيارة (اختياري)
  vehicle?: {
    plate?: string;
    make?: string;
    model?: string;
    year?: string;
    vin?: string;
  };
  source?: string; // مصدر الطلب
  salesperson?: string;
  customField?: { label: string; value: string }[];
  /** شروط الدفع المختارة (نقد / تحويل بنكي شخصي / تحويل بنكي للشركة / آجل) */
  paymentTerms?: string;
  /** بنود/أسطر إضافية تظهر تحت الهيدر مباشرة قبل جدول الأصناف (اختياري) */
  headerLines?: string[];
  isDeleted?: boolean;
}

const STORAGE_KEY = "alwafa_sales_docs_v1";

let cache: SalesDoc[] | null = null;
const subscribers = new Set<() => void>();

function read(): SalesDoc[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as SalesDoc[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: SalesDoc[]) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  subscribers.forEach((cb) => cb());
}

function notify() {
  subscribers.forEach((cb) => cb());
}

export const salesStore = {
  subscribe(cb: () => void) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  list(filter?: { type?: SalesDocType; includeDeleted?: boolean }): SalesDoc[] {
    const all = read();
    return all
      .filter((d) => (filter?.includeDeleted ? true : !d.isDeleted))
      .filter((d) => (filter?.type ? d.type === filter.type : true))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  },
  get(id: string): SalesDoc | undefined {
    return read().find((d) => d.id === id);
  },
  nextNumber(type: SalesDocType): string {
    const prefix = numberPrefix(type);
    const year = new Date().getFullYear();
    const yearStr = String(year);
    const all = read().filter((d) => d.type === type);
    const max = all.reduce((m, d) => {
      const num = String(d.number || "");
      const yearMatch = num.match(new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`));
      if (yearMatch && yearMatch[1] === yearStr) {
        const n = parseInt(yearMatch[2], 10);
        return Number.isFinite(n) && n > m ? n : m;
      }
      return m;
    }, 0);
    // Honour the operator-configured start number from /settings/numbering.
    const cfg = resolveSeriesByPrefix(prefix);
    const startFrom = cfg?.startFrom ?? 1;
    const padding = cfg?.padding ?? 5;
    const next = Math.max(max + 1, startFrom);
    return `${prefix}-${yearStr}-${String(next).padStart(padding, "0")}`;
  },
  upsert(doc: SalesDoc): SalesDoc {
    const all = read();
    const idx = all.findIndex((d) => d.id === doc.id);
    const finalDoc = { ...doc, updatedAt: new Date().toISOString() };
    if (idx >= 0) {
      all[idx] = finalDoc;
    } else {
      all.unshift(finalDoc);
    }
    write([...all]);
    // ─── ترحيل محاسبي تلقائي لفواتير المبيعات ───
    try {
      if (finalDoc.type === "invoice" && !finalDoc.isDeleted) {
        // dynamic import لتجنب الدورات
        import("./salesAccounting").then(({ postSalesInvoice }) => {
          postSalesInvoice({
            invoiceId: finalDoc.id,
            invoiceNumber: String(finalDoc.number),
            date: finalDoc.date || finalDoc.createdAt || new Date().toISOString(),
            customerName: finalDoc.customerName || "غير محدد",
            subtotal: Number(finalDoc.subtotal || 0),
            vat: Number(finalDoc.taxTotal || 0),
            total: Number(finalDoc.total || 0),
            source: "sales_invoice",
          });
        });
      }
    } catch {}
    return finalDoc;
  },
  remove(id: string) {
    const all = read().map((d) => (d.id === id ? { ...d, isDeleted: true } : d));
    write(all);
    // إزالة القيود المحاسبية المرتبطة للحفاظ على تطابق الأرصدة
    try {
      import("./salesAccounting").then(({ removeSalesInvoiceJournal }) => {
        removeSalesInvoiceJournal(id, "sales_invoice");
        removeSalesInvoiceJournal(id, "work_order_invoice");
      });
    } catch {}
  },
  hardRemove(id: string) {
    write(read().filter((d) => d.id !== id));
    try {
      import("./salesAccounting").then(({ removeSalesInvoiceJournal }) => {
        removeSalesInvoiceJournal(id, "sales_invoice");
        removeSalesInvoiceJournal(id, "work_order_invoice");
      });
    } catch {}
  },
  restore(id: string) {
    write(read().map((d) => (d.id === id ? { ...d, isDeleted: false } : d)));
  },
  duplicate(id: string): SalesDoc | null {
    const src = salesStore.get(id);
    if (!src) return null;
    const copy: SalesDoc = {
      ...src,
      id: cryptoRandom(),
      number: salesStore.nextNumber(src.type),
      status: "draft",
      paidTotal: 0,
      balanceDue: src.total,
      payments: [],
      attachments: [],
      noteEntries: [],
      appointments: [],
      activity: [{ id: cryptoRandom(), at: new Date().toISOString(), text: "نسخ من المستند " + src.number }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return salesStore.upsert(copy);
  },
  addPayment(id: string, payment: Omit<SalesPayment, "id">) {
    const doc = salesStore.get(id);
    if (!doc) return;
    const p: SalesPayment = { ...payment, id: cryptoRandom() };
    const payments = [...doc.payments, p];
    const paidTotal = payments.reduce((s, x) => s + x.amount, 0);
    const balanceDue = Math.max(0, doc.total - paidTotal);
    const status: SalesDocStatus =
      balanceDue <= 0.001 ? "paid" : paidTotal > 0 ? "partial" : doc.status;
    salesStore.upsert({
      ...doc,
      payments,
      paidTotal,
      balanceDue,
      status,
      activity: [
        ...doc.activity,
        { id: cryptoRandom(), at: new Date().toISOString(), text: `إضافة دفعة بقيمة ${p.amount} ${doc.currency}` },
      ],
    });
    // ─── ترحيل دفعة العميل في دفتر اليومية ───
    try {
      import("./salesAccounting").then(({ postCustomerPayment }) => {
        const m = (p.method || "cash").toLowerCase();
        const method =
          m.includes("cash") || m.includes("نقد") ? "cash" :
          m.includes("cheque") || m.includes("شيك") ? "cheque" :
          m.includes("card") || m.includes("بطاقة") ? "card" :
          "bank_transfer";
        postCustomerPayment({
          paymentId: `${id}::${p.id}`,
          paymentNumber: `CP-${p.id.slice(0, 6).toUpperCase()}`,
          date: p.date || new Date().toISOString(),
          amount: p.amount,
          customerName: doc.customerName || "غير محدد",
          method: method as "cash" | "bank_transfer" | "cheque" | "card",
          reference: p.reference,
        });
      });
    } catch {}
  },
  removePayment(docId: string, paymentId: string) {
    const doc = salesStore.get(docId);
    if (!doc) return;
    const removed = doc.payments.find((x) => x.id === paymentId);
    const payments = doc.payments.filter((x) => x.id !== paymentId);
    const paidTotal = payments.reduce((s, x) => s + x.amount, 0);
    const balanceDue = Math.max(0, doc.total - paidTotal);
    const status: SalesDocStatus =
      balanceDue <= 0.001 && payments.length > 0 ? "paid" : paidTotal > 0 ? "partial" : "sent";
    salesStore.upsert({
      ...doc,
      payments,
      paidTotal,
      balanceDue,
      status,
      activity: [
        ...doc.activity,
        { id: cryptoRandom(), at: new Date().toISOString(), text: `حذف دفعة بقيمة ${removed?.amount ?? 0} ${doc.currency}` },
      ],
    });
    // إزالة قيد الدفعة من اليومية
    try {
      import("./salesAccounting").then(({ removeCustomerPaymentJournal }) => {
        removeCustomerPaymentJournal(`${docId}::${paymentId}`);
      });
    } catch {}
  },
  addNote(id: string, text: string, author?: string) {
    const doc = salesStore.get(id);
    if (!doc) return;
    const note: SalesNote = { id: cryptoRandom(), text, author, createdAt: new Date().toISOString() };
    salesStore.upsert({
      ...doc,
      noteEntries: [...doc.noteEntries, note],
      activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: "إضافة ملاحظة" }],
    });
  },
  addAttachment(id: string, file: Omit<SalesAttachment, "id" | "uploadedAt">) {
    const doc = salesStore.get(id);
    if (!doc) return;
    const att: SalesAttachment = { ...file, id: cryptoRandom(), uploadedAt: new Date().toISOString() };
    salesStore.upsert({
      ...doc,
      attachments: [...doc.attachments, att],
      activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: `إرفاق: ${att.name}` }],
    });
  },
  addAppointment(id: string, appt: Omit<SalesAppointment, "id">) {
    const doc = salesStore.get(id);
    if (!doc) return;
    const a: SalesAppointment = { ...appt, id: cryptoRandom() };
    salesStore.upsert({
      ...doc,
      appointments: [...doc.appointments, a],
      activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: `ترتيب موعد: ${a.title}` }],
    });
  },
  setStatus(id: string, status: SalesDocStatus) {
    const doc = salesStore.get(id);
    if (!doc) return;
    salesStore.upsert({
      ...doc,
      status,
      activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: `تغيير الحالة إلى: ${status}` }],
    });
  },
  /** يضيف دفعة واحدة بالمبلغ المتبقي ويحوّل الحالة إلى "مدفوعة" */
  markPaidInFull(id: string, method: string = "نقداً", reference?: string) {
    const doc = salesStore.get(id);
    if (!doc) return;
    const remaining = Math.max(0, (doc.total || 0) - (doc.paidTotal || 0));
    if (remaining > 0.001) {
      salesStore.addPayment(id, {
        amount: remaining,
        method,
        date: new Date().toISOString().split("T")[0],
        reference,
      });
    } else {
      // حالة استثنائية: لا متبقي لكن الحالة ليست paid
      salesStore.upsert({
        ...doc,
        status: "paid",
        balanceDue: 0,
        activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: "تأكيد الدفع الكامل" }],
      });
    }
  },
  setCostCenter(id: string, costCenter: string) {
    const doc = salesStore.get(id);
    if (!doc) return;
    salesStore.upsert({
      ...doc,
      costCenter,
      activity: [...doc.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: `تعيين مركز تكلفة: ${costCenter}` }],
    });
  },
  convertToInvoice(quoteId: string): SalesDoc | null {
    const q = salesStore.get(quoteId);
    if (!q || q.type !== "quote") return null;
    const inv: SalesDoc = {
      ...q,
      id: cryptoRandom(),
      number: salesStore.nextNumber("invoice"),
      type: "invoice",
      status: "unpaid",
      fromDocId: q.id,
      fromDocType: "quote",
      paidTotal: 0,
      balanceDue: q.total,
      payments: [],
      attachments: [],
      noteEntries: [],
      appointments: [],
      activity: [{ id: cryptoRandom(), at: new Date().toISOString(), text: `تحويل من عرض السعر ${q.number}` }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    salesStore.upsert(inv);
    salesStore.upsert({ ...q, status: "converted", activity: [...q.activity, { id: cryptoRandom(), at: new Date().toISOString(), text: `تم التحويل إلى فاتورة ${inv.number}` }] });
    return inv;
  },
};

export function numberPrefix(type: SalesDocType): string {
  switch (type) {
    case "invoice": return "INV";
    case "quote": return "QT";
    case "credit_note": return "CN";
    case "return_invoice": return "RET";
    case "recurring_invoice": return "REC";
    case "customer_payment": return "PAY";
  }
}

export function calculateTotals(items: SalesLineItem[]) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const it of items) {
    const line = it.quantity * it.unitPrice;
    const disc = (line * (it.discount || 0)) / 100;
    const taxable = line - disc;
    const tax = (taxable * (it.tax || 0)) / 100;
    subtotal += line;
    discountTotal += disc;
    taxTotal += tax;
  }
  const total = subtotal - discountTotal + taxTotal;
  return { subtotal, discountTotal, taxTotal, total };
}

export function makeEmptyDoc(type: SalesDocType): SalesDoc {
  const now = new Date().toISOString();
  return {
    id: cryptoRandom(),
    number: salesStore.nextNumber(type),
    type,
    status: type === "quote" ? "draft" : "unpaid",
    customerName: "",
    date: now.slice(0, 10),
    dueDate: type === "invoice" ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : undefined,
    currency: "OMR",
    items: [],
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    total: 0,
    paidTotal: 0,
    balanceDue: 0,
    payments: [],
    attachments: [],
    noteEntries: [],
    appointments: [],
    activity: [{ id: cryptoRandom(), at: now, text: "إنشاء المستند" }],
    createdAt: now,
    updatedAt: now,
  };
}

export function cryptoRandom() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function statusLabel(status: SalesDocStatus): { ar: string; en: string; cls: string } {
  const map: Record<SalesDocStatus, { ar: string; en: string; cls: string }> = {
    draft:     { ar: "مسودة", en: "Draft", cls: "bg-muted text-muted-foreground" },
    sent:      { ar: "مرسلة", en: "Sent", cls: "bg-info/15 text-info" },
    viewed:    { ar: "تمت مشاهدتها", en: "Viewed", cls: "bg-info/15 text-info" },
    paid:      { ar: "مدفوعة", en: "Paid", cls: "bg-success/15 text-success" },
    partial:   { ar: "مدفوعة جزئيًا", en: "Partially paid", cls: "bg-warning/15 text-warning" },
    unpaid:    { ar: "غير مدفوعة", en: "Unpaid", cls: "bg-destructive/15 text-destructive" },
    overdue:   { ar: "متأخرة", en: "Overdue", cls: "bg-destructive/20 text-destructive font-semibold" },
    cancelled: { ar: "ملغاة", en: "Cancelled", cls: "bg-muted text-muted-foreground line-through" },
    converted: { ar: "محولة لفاتورة", en: "Converted", cls: "bg-success/15 text-success" },
  };
  return map[status];
}
