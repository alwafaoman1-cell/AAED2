// نظام المبيعات الموحد — تخزين محلي لكل أنواع المستندات
// (الفواتير، عروض الأسعار، الإشعارات الدائنة، الفواتير المرتجعة، الفواتير الدورية، دفعات العملاء)
import { resolveSeriesByPrefix } from "@/lib/numberingSettings";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { isGeneratedColumnWriteError, sanitizeInvoiceGeneratedWritePayload, stripUndefined } from "@/lib/supabasePayload";

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

let cache: SalesDoc[] = [];
const subscribers = new Set<() => void>();

function read(): SalesDoc[] {
  return cache;
}

function write(next: SalesDoc[]) {
  cache = next;
  subscribers.forEach((cb) => cb());
}

function notify() {
  subscribers.forEach((cb) => cb());
}

function rowToSalesDoc(r: any): SalesDoc {
  const m = (r.metadata || {}) as Partial<SalesDoc>;
  const linkedWorkOrderId = r.work_order_id ? `WO-${r.work_order_id}` : undefined;
  return {
    id: r.id,
    number: r.doc_number,
    type: r.doc_type as SalesDocType,
    status: r.status as SalesDocStatus,
    customerId: r.customer_id || undefined,
    customerName: r.customer_name || "",
    customerAddress: m.customerAddress,
    customerTaxNo: m.customerTaxNo,
    date: r.date,
    dueDate: r.due_date || undefined,
    currency: m.currency || "OMR",
    items: Array.isArray(r.items) ? r.items : [],
    notes: r.notes || undefined,
    terms: m.terms,
    subtotal: Number(r.subtotal || 0),
    discountTotal: Number(r.discount_total || 0),
    taxTotal: Number(r.tax_total || 0),
    total: Number(r.total || 0),
    paidTotal: Number(r.paid_amount || 0),
    balanceDue: Number(r.balance_due || 0),
    costCenter: m.costCenter,
    fromDocId: m.fromDocId || linkedWorkOrderId || r.converted_invoice_id,
    fromDocType: m.fromDocType,
    payments: Array.isArray(m.payments) ? m.payments : [],
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    noteEntries: Array.isArray(m.noteEntries) ? m.noteEntries : [],
    appointments: Array.isArray(m.appointments) ? m.appointments : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    activity: Array.isArray(m.activity) ? m.activity : [],
    recurrence: m.recurrence,
    vehicle: {
      plate: r.vehicle_plate || undefined,
      make: r.vehicle_make || undefined,
      model: r.vehicle_model || undefined,
      year: m.vehicle?.year,
      vin: m.vehicle?.vin,
    },
    source: m.source,
    salesperson: m.salesperson,
    customField: m.customField,
    paymentTerms: m.paymentTerms,
    headerLines: m.headerLines,
    isDeleted: r.status === "cancelled" && !!m.isDeleted,
  };
}

async function refreshSalesFromCloud() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const { data, error } = await (supabase.from("sales_documents") as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) {
    console.warn("[salesStore] cloud fetch failed", error);
    return;
  }
  const documentRows = data || [];
  const documentIds = documentRows.map((row: any) => row.id).filter(Boolean);
  let paymentsByDocument = new Map<string, SalesPayment[]>();
  if (documentIds.length > 0) {
    const { data: paymentsData, error: paymentsError } = await (supabase.from("sales_payments") as any)
      .select("id,sales_document_id,date,amount,method,reference,notes")
      .eq("tenant_id", tenantId)
      .in("sales_document_id", documentIds)
      .order("date", { ascending: false });
    if (paymentsError) {
      console.warn("[salesStore] sales payments cloud fetch failed", paymentsError);
    } else {
      paymentsByDocument = (paymentsData || []).reduce((map: Map<string, SalesPayment[]>, row: any) => {
        const current = map.get(row.sales_document_id) || [];
        current.push({
          id: row.id,
          date: row.date,
          amount: Number(row.amount || 0),
          method: row.method || "cash",
          reference: row.reference || undefined,
          note: row.notes || undefined,
        });
        map.set(row.sales_document_id, current);
        return map;
      }, paymentsByDocument);
    }
  }
  cache = documentRows.map((row: any) => {
    const doc = rowToSalesDoc(row);
    const cloudPayments = paymentsByDocument.get(doc.id);
    return cloudPayments ? { ...doc, payments: cloudPayments } : doc;
  });
  notify();
}

async function upsertSalesCloud(doc: SalesDoc) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const fromDocId = doc.fromDocId || "";
  const linkedWorkOrderId = fromDocId.startsWith("WO-") ? fromDocId.slice(3) : null;
  const convertedInvoiceId = fromDocId && isUuid(fromDocId) ? fromDocId : null;
  const payload = stripUndefined({
    id: doc.id,
    tenant_id: tenantId,
    doc_number: doc.number,
    doc_type: doc.type,
    status: doc.isDeleted ? "cancelled" : doc.status,
    customer_id: doc.customerId && isUuid(doc.customerId) ? doc.customerId : null,
    customer_name: doc.customerName || null,
    date: doc.date,
    due_date: doc.dueDate || null,
    items: doc.items,
    notes: doc.notes || null,
    subtotal: doc.subtotal,
    discount_total: doc.discountTotal,
    tax_total: doc.taxTotal,
    total: doc.total,
    paid_amount: doc.paidTotal,
    balance_due: doc.balanceDue,
    converted_invoice_id: convertedInvoiceId,
    work_order_id: linkedWorkOrderId,
    vehicle_plate: doc.vehicle?.plate || null,
    vehicle_make: doc.vehicle?.make || null,
    vehicle_model: doc.vehicle?.model || null,
    metadata: {
      customerAddress: doc.customerAddress,
      customerTaxNo: doc.customerTaxNo,
      currency: doc.currency,
      terms: doc.terms,
      costCenter: doc.costCenter,
      fromDocId: doc.fromDocId,
      fromDocType: doc.fromDocType,
      payments: doc.payments,
      attachments: doc.attachments,
      noteEntries: doc.noteEntries,
      appointments: doc.appointments,
      activity: doc.activity,
      recurrence: doc.recurrence,
      vehicle: doc.vehicle,
      source: doc.source,
      salesperson: doc.salesperson,
      customField: doc.customField,
      paymentTerms: doc.paymentTerms,
      headerLines: doc.headerLines,
      isDeleted: doc.isDeleted,
    },
  });
  let { error } = await (supabase.from("sales_documents") as any).upsert(payload);
  if (error && isGeneratedColumnWriteError(error)) {
    ({ error } = await (supabase.from("sales_documents") as any).upsert(sanitizeInvoiceGeneratedWritePayload(payload)));
  }
  if (error) console.warn("[salesStore] cloud upsert failed", error);
}

function normalizePaymentMethodForCloud(method: string) {
  const m = String(method || "").toLowerCase();
  if (m.includes("cash") || m.includes("نقد")) return "cash";
  if (m.includes("cheque") || m.includes("check") || m.includes("شيك")) return "cheque";
  if (m.includes("card") || m.includes("بطاقة")) return "card";
  if (m.includes("offset") || m.includes("مقاصة")) return "offset";
  return "bank_transfer";
}

async function insertSalesPaymentCloud(doc: SalesDoc, payment: Omit<SalesPayment, "id">): Promise<SalesPayment> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("تعذّر تحديد المؤسسة");
  if (!isUuid(doc.id)) throw new Error("لا يمكن تسجيل دفعة لفاتورة غير محفوظة في السحابة");

  const { data: userData } = await supabase.auth.getUser();
  const paymentNumber = `PAY-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  const { data, error } = await (supabase.from("sales_payments") as any)
    .insert({
      tenant_id: tenantId,
      payment_number: paymentNumber,
      sales_document_id: doc.id,
      date: payment.date || new Date().toISOString().slice(0, 10),
      amount: Number(payment.amount || 0),
      method: normalizePaymentMethodForCloud(payment.method),
      reference: payment.reference || null,
      notes: payment.note || null,
      created_by: userData.user?.id || null,
    })
    .select("id,date,amount,method,reference,notes")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    date: data.date,
    amount: Number(data.amount || 0),
    method: data.method || payment.method,
    reference: data.reference || undefined,
    note: data.notes || undefined,
  };
}

export const salesStore = {
  subscribe(cb: () => void) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  async refresh() {
    await refreshSalesFromCloud();
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
    void upsertSalesCloud(finalDoc);
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
    const removed = all.find((d) => d.id === id);
    if (removed) void upsertSalesCloud(removed);
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
    void supabase.from("sales_documents").delete().eq("id", id);
    try {
      import("./salesAccounting").then(({ removeSalesInvoiceJournal }) => {
        removeSalesInvoiceJournal(id, "sales_invoice");
        removeSalesInvoiceJournal(id, "work_order_invoice");
      });
    } catch {}
  },
  restore(id: string) {
    const next = read().map((d) => (d.id === id ? { ...d, isDeleted: false } : d));
    write(next);
    const restored = next.find((d) => d.id === id);
    if (restored) void upsertSalesCloud(restored);
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
  async addPayment(id: string, payment: Omit<SalesPayment, "id">) {
    const doc = salesStore.get(id);
    if (!doc) throw new Error("الفاتورة غير موجودة");
    if (!Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0) {
      throw new Error("أدخل مبلغاً صحيحاً");
    }
    const remaining = Math.max(0, Number(doc.total || 0) - Number(doc.paidTotal || 0));
    if (Number(payment.amount) > remaining + 0.001) {
      throw new Error(`المبلغ يتجاوز المتبقي (${remaining.toFixed(3)} ر.ع)`);
    }
    const p = await insertSalesPaymentCloud(doc, payment);
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
    void refreshSalesFromCloud();
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
      void salesStore.addPayment(id, {
        amount: remaining,
        method,
        date: new Date().toISOString().split("T")[0],
        reference,
      }).catch((error) => console.warn("[salesStore] mark paid cloud payment failed", error));
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

if (typeof window !== "undefined") {
  setTimeout(() => void refreshSalesFromCloud(), 0);
  supabase.auth.onAuthStateChange((_event, session) => {
    cache = [];
    notify();
    if (session?.user) void refreshSalesFromCloud();
  });
  supabase.channel("sales_documents_store_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "sales_documents" }, () => {
      void refreshSalesFromCloud();
    })
    .subscribe();
}

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
