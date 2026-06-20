// Daily Log Store — يخزّن سجل الأعمال اليومية بنفس شكل النموذج المرفوع
// كل صف = حركة يومية (عميل + سيارة + نوع صيانة + مبالغ).
// يدعم: الإضافة اليدوية، رفع Excel، حذف، وإنشاء أمر عمل + فاتورة + مصروف لقطع الغيار.

import { addWorkOrder, getWorkOrders, type WorkOrder } from "./workOrdersStore";
import { salesStore, makeEmptyDoc, calculateTotals, cryptoRandom, type SalesLineItem } from "./salesStore";
import { customersStore } from "./customersStore";
import { expensesStore, type ExpenseRecord } from "./expensesStore";
import { expenseCategoriesStore, employeeCashboxesStore, voucherSettingsStore } from "./financeSettingsStore";

export interface DailyLogRow {
  id: string;
  date: string;            // ISO yyyy-mm-dd
  customer: string;        // اسم العميل
  phone: string;           // الهاتف
  plate: string;           // رقم السيارة
  vehicleType: string;     // نوع السيارة
  // أنواع الصيانة كـ booleans (لا حاجة لإدخال أرقام)
  mechanic: number;        // 1/0
  electric: number;        // 1/0
  lock: number;            // 1/0
  paint: number;           // 1/0
  finalAmount: number;     // إجمالي الفاتورة (الفعلي عليك)
  paidAmount: number;      // المبلغ الذي دفعه الزبون فعلياً
  partsBuy: number;        // شراء قطع الغيار (مصروف)
  partsSell: number;       // بيع قطع الغيار (إيراد)
  vendorAmount: number;    // المنتج للوكاله
  netRevenue: number;      // صافي الإيراد
  // ربط بالنظام
  workOrderId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  expenseId?: string;      // معرف مصروف قطع الغيار المرتبط
  createdAt: string;
}

const KEY = "alwafa_daily_log_v1";
let cache: DailyLogRow[] | null = null;
const subs = new Set<() => void>();

function load(): DailyLogRow[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch { cache = []; }
  return cache!;
}
function persist() {
  if (!cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  subs.forEach((f) => f());
}

export const dailyLogStore = {
  list(): DailyLogRow[] {
    return [...load()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },
  add(row: DailyLogRow) { load().unshift(row); persist(); },
  update(id: string, patch: Partial<DailyLogRow>) {
    const list = load();
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) { list[i] = { ...list[i], ...patch }; persist(); }
  },
  remove(id: string) {
    cache = load().filter((r) => r.id !== id); persist();
  },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
};

export function emptyRow(): DailyLogRow {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: cryptoRandom(),
    date: today,
    customer: "", phone: "", plate: "", vehicleType: "",
    mechanic: 0, electric: 0, lock: 0, paint: 0,
    finalAmount: 0, paidAmount: 0, partsBuy: 0, partsSell: 0, vendorAmount: 0, netRevenue: 0,
    createdAt: new Date().toISOString(),
  };
}

/** صافي الإيراد = ما دفعه الزبون - شراء قطع الغيار */
export function autoNetRevenue(r: Pick<DailyLogRow, "paidAmount" | "partsBuy">): number {
  return Number(((r.paidAmount || 0) - (r.partsBuy || 0)).toFixed(3));
}

/** ينشئ أمر عمل (مغلق) + فاتورة + مصروف قطع غيار لصف داخل السجل */
export function generateOrderAndInvoiceForRow(row: DailyLogRow): {
  workOrderId: string; invoiceId: string; invoiceNumber: string; expenseId?: string;
} {
  // 1) ضمان وجود العميل
  if (row.customer) customersStore.getOrCreateByName(row.customer, row.phone);

  // 2) إنشاء أمر عمل (مغلق — بيانات قديمة)
  const woNumber = `WO-${new Date().getFullYear()}-${String(getWorkOrders().length + 1).padStart(4, "0")}`;
  const serviceParts: string[] = [];
  if (row.mechanic) serviceParts.push("ميكانيكا");
  if (row.electric) serviceParts.push("كهرباء");
  if (row.lock) serviceParts.push("سكرة");
  if (row.paint) serviceParts.push("صبغ");
  const serviceType = serviceParts.join(" + ") || "صيانة عامة";

  // محاذاة مع تقارير الربح: الإيراد = ما دفعه الزبون فعلياً،
  // تكلفة القطع = شراء القطع، الأجور = 0 (عمل داخلي بلا تكلفة خارجية)
  // → ربح المركبة في التقارير = paidAmount - partsBuy = صافي الإيراد بالسجل
  const revenue = row.paidAmount || row.finalAmount;
  const wo: WorkOrder = {
    id: woNumber,
    customer: row.customer || "غير محدد",
    phone: row.phone || "",
    plate: row.plate || "—",
    vehicleType: row.vehicleType || "",
    model: "", year: "", vin: "",
    insurance: "-", claimNumber: "-",
    entryDate: row.date,
    technician: "",
    serviceType,
    status: "مغلق",
    totalCost: revenue,
    laborCost: 0,
    partsCost: row.partsBuy,
    diagnosis: `سجل يومي — ${serviceType}`,
  };
  addWorkOrder(wo);

  // 3) إنشاء فاتورة (بنود حسب أنواع الصيانة المختارة)
  const inv = makeEmptyDoc("invoice");
  inv.date = row.date;
  inv.customerName = row.customer || "غير محدد";
  inv.vehicle = { plate: row.plate, make: row.vehicleType };

  const items: SalesLineItem[] = [];
  // قيمة الخدمة = الفعلي - بيع القطع، توزع بالتساوي على أنواع الصيانة المختارة
  const servicesValue = Math.max(0, row.finalAmount - (row.partsSell || 0));
  const selected = serviceParts.length || 1;
  const perService = Number((servicesValue / selected).toFixed(3));

  const push = (name: string, amount: number) => {
    if (amount <= 0) return;
    items.push({
      id: cryptoRandom(),
      itemName: name, description: name,
      quantity: 1, unitPrice: amount, discount: 0, tax: 0,
    });
  };
  if (row.mechanic) push("صيانة ميكانيكية", perService);
  if (row.electric) push("كهرباء", perService);
  if (row.lock) push("سكرة", perService);
  if (row.paint) push("صبغ", perService);
  if (row.partsSell > 0) push("قطع غيار", row.partsSell);
  if (items.length === 0 && row.finalAmount > 0) push("خدمة صيانة", row.finalAmount);

  inv.items = items;
  const t = calculateTotals(items);
  inv.subtotal = t.subtotal;
  inv.discountTotal = t.discountTotal;
  inv.taxTotal = t.taxTotal;
  inv.total = t.total;
  // المدفوع من العميل
  const paid = Math.min(row.paidAmount || row.finalAmount, t.total);
  inv.balanceDue = Math.max(0, t.total - paid);
  (inv as any).paidAmount = paid;
  inv.notes = `مستوردة من السجل اليومي — أمر العمل ${woNumber}`;

  const saved = salesStore.upsert(inv);

  // 4) مصروف تلقائي لشراء قطع الغيار بنفس تاريخ الصف
  let expenseId: string | undefined;
  if ((row.partsBuy || 0) > 0) {
    const cats = expenseCategoriesStore.getAll();
    const partsCat = cats.find((c) => /قطع/.test(c.name)) || cats[0];
    const cb = employeeCashboxesStore.getAll().find((c) => c.isDefault) || employeeCashboxesStore.getAll()[0];
    const voucher = voucherSettingsStore.generateNextNumber("payment");
    const exp: ExpenseRecord = {
      id: `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      voucherNumber: voucher,
      date: row.date,
      amount: row.partsBuy,
      categoryId: partsCat?.id || "",
      categoryName: partsCat?.name || "قطع غيار",
      cashboxId: cb?.id || "",
      cashboxName: cb?.cashboxName,
      paymentMethod: "cash",
      beneficiary: "مورد قطع غيار",
      description: `قطع غيار — ${row.customer} / ${row.plate} (${woNumber})`,
      linkedWorkOrderId: woNumber,
      linkedVehiclePlate: row.plate,
      linkedVehicleName: row.vehicleType,
      createdAt: new Date().toISOString(),
    };
    expensesStore.add(exp);
    expenseId = exp.id;
  }

  return { workOrderId: woNumber, invoiceId: saved.id, invoiceNumber: String(saved.number), expenseId };
}
