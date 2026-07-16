// محرك التقارير المركزي — يجمع البيانات من كل الـ stores ويحسب الأرقام
// المالية، التشغيلية، العلاقات، والمحاسبية في مكان واحد.

import { getWorkOrders, type WorkOrder } from "./workOrdersStore";
import { inventoryStore } from "./inventoryStore";
import { stockMovementsStore } from "./stockMovementsStore";
import { customersStore } from "./customersStore";
import { suppliersStore } from "./suppliersStore";
import { purchaseInvoicesStore, getPurchaseTotals } from "./purchaseInvoicesStore";
import { supplierPaymentsStore } from "./supplierPaymentsStore";
import { expensesStore, getExpensesTotalForWorkOrder, getExpensePartProfit, getExpensePartRevenue } from "./expensesStore";
import { depositsStore } from "./depositsStore";
import { journalStore } from "./journalStore";
import { vehiclesStore } from "./vehiclesStore";
import { salesStore, type SalesDoc } from "./salesStore";
import { roundMoney } from "@/lib/money";

// ===== أنواع موحدة =====
export interface DateRange {
  from: string; // ISO yyyy-mm-dd
  to: string;   // ISO yyyy-mm-dd
}

export interface ReportFilters {
  range: DateRange;
  customer?: string;
  supplier?: string;
  status?: string;
  technician?: string;
}

const inRange = (d: string, r: DateRange) => {
  if (!d) return false;
  const x = d.slice(0, 10);
  return (!r.from || x >= r.from) && (!r.to || x <= r.to);
};

// ===== اختصارات النطاق =====
export function rangeShortcut(kind: "today" | "week" | "month" | "quarter" | "year"): DateRange {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(today);
  if (kind === "today") {
    /* same day */
  } else if (kind === "week") {
    start.setDate(start.getDate() - 6);
  } else if (kind === "month") {
    start.setMonth(start.getMonth() - 1);
  } else if (kind === "quarter") {
    start.setMonth(start.getMonth() - 3);
  } else {
    start.setFullYear(start.getFullYear() - 1);
  }
  return { from: start.toISOString().slice(0, 10), to };
}

// =================== 1) التقرير المالي الشامل ===================

export interface SalesRow {
  orderId: string;
  date: string;
  customer: string;
  plate: string;
  total: number;
  status: string;
  isPaid: boolean;
}

export interface SalesReport {
  rows: SalesRow[];
  count: number;
  totalRevenue: number;
  paidRevenue: number;
  pendingRevenue: number;
  vatCollected: number; // 5%
}

interface RawReceipt { id: string; date: string; amount: number; payerName?: string }
function loadReceiptsInRange(r: DateRange): RawReceipt[] {
  return salesStore.list({ type: "invoice" }).flatMap((doc) =>
    (doc.payments || [])
      .filter((payment) => inRange(payment.date, r))
      .map((payment) => ({
        id: payment.id,
        date: payment.date,
        amount: payment.amount,
        payerName: doc.customerName,
      }))
  );
}

const normName = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Accounting rule: revenue is recognized from issued invoices only.
// Work order totalCost is an estimate/cost field and must not be used as revenue.
const isActiveInvoice = (doc: SalesDoc) =>
  doc.type === "invoice" && !doc.isDeleted && doc.status !== "cancelled";

const invoiceWorkOrderId = (doc: SalesDoc) => {
  const from = String(doc.fromDocId || "");
  return from.startsWith("WO-") ? from.slice(3) : undefined;
};

const invoiceRevenue = (doc: SalesDoc) => roundMoney(Number(doc.total || 0));
const invoiceRevenueExVat = (doc: SalesDoc) => roundMoney(Number(doc.subtotal || 0));
const invoiceVat = (doc: SalesDoc) => roundMoney(Number(doc.taxTotal || 0));
const invoicePaid = (doc: SalesDoc) =>
  roundMoney(
    Number(doc.paidTotal || 0) ||
      (doc.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  );

const cashInvoicesInRange = (range: DateRange) =>
  salesStore
    .list({ type: "invoice" })
    .filter(isActiveInvoice)
    .filter((doc) => inRange(doc.date || doc.createdAt, range));

const revenueByWorkOrder = (range: DateRange) => {
  const map = new Map<string, number>();
  for (const invoice of cashInvoicesInRange(range)) {
    const workOrderId = invoiceWorkOrderId(invoice);
    if (!workOrderId) continue;
    map.set(workOrderId, roundMoney((map.get(workOrderId) || 0) + invoiceRevenueExVat(invoice)));
  }
  return map;
};

export function buildSalesReport(f: ReportFilters): SalesReport {
  const invoices = cashInvoicesInRange(f.range).filter((doc) => {
    if (f.customer && doc.customerName !== f.customer) return false;
    if (f.status && doc.status !== f.status) return false;
    return true;
  });

  const rows: SalesRow[] = invoices.map((doc) => {
    const total = invoiceRevenue(doc);
    const paid = invoicePaid(doc);
    return {
      orderId: doc.number || doc.id,
      date: doc.date,
      customer: doc.customerName,
      plate: doc.vehicle?.plate || "",
      total,
      status: doc.status,
      isPaid: total > 0 && paid >= total,
    };
  });

  const totalRevenue = rows.reduce((s, r) => s + r.total, 0);
  const paidRevenue = invoices.reduce((sum, doc) => sum + Math.min(invoicePaid(doc), invoiceRevenue(doc)), 0);
  const pendingRevenue = Math.max(0, totalRevenue - paidRevenue);
  const vatCollected = invoices.reduce((sum, doc) => sum + invoiceVat(doc), 0);

  return { rows, count: rows.length, totalRevenue, paidRevenue, pendingRevenue, vatCollected };
}



export interface PurchasesRow {
  invoiceId: string;
  date: string;
  supplier: string;
  total: number;
  paid: number;
  remaining: number;
  status: string;
}

export interface PurchasesReport {
  rows: PurchasesRow[];
  count: number;
  totalPurchases: number;
  totalPaid: number;
  totalRemaining: number;
  vatPaid: number;
}

export function buildPurchasesReport(f: ReportFilters): PurchasesReport {
  const all = purchaseInvoicesStore.getAll().filter((p) => inRange(p.date, f.range));
  const filtered = all.filter((p) => !f.supplier || p.supplierName === f.supplier);

  let vatPaid = 0;
  const rows: PurchasesRow[] = filtered.map((p) => {
    const t = getPurchaseTotals(p);
    vatPaid += t.tax;
    return {
      invoiceId: p.id,
      date: p.date,
      supplier: p.supplierName,
      total: t.total,
      paid: p.paidAmount || 0,
      remaining: Math.max(0, t.total - (p.paidAmount || 0)),
      status: p.status,
    };
  });

  const totalPurchases = rows.reduce((s, r) => s + r.total, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);

  return { rows, count: rows.length, totalPurchases, totalPaid, totalRemaining, vatPaid };
}

export interface ProfitLossReport {
  revenue: number;
  cogs: number;            // تكلفة قطع الغيار المباعة
  laborCost: number;
  expenses: number;        // مصروفات تشغيلية
  grossProfit: number;     // إيراد - تكلفة بضاعة
  netProfit: number;
  vatCollected: number;
  vatPaid: number;
  vatDue: number;
  margin: number;          // %
}

// أسماء تصنيفات المصاريف التي تمثل قطع غيار (COGS) — تُستبعد من المصروفات التشغيلية لمنع الازدواج
const PARTS_EXPENSE_KEYWORDS = ["قطع غيار", "قطع الغيار", "parts", "spare"];
const isPartsExpense = (cat?: string) => {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return PARTS_EXPENSE_KEYWORDS.some((k) => c.includes(k.toLowerCase()));
};

export function buildProfitLossReport(f: ReportFilters): ProfitLossReport {
  const sales = buildSalesReport(f);
  const purchases = buildPurchasesReport(f);

  // Work-order partsCost/laborCost are estimates. Actual COGS/labour must come
  // from recorded purchase/expense/labour vouchers, not from planning fields.
  const cogs = 0;
  const laborCost = 0;

  // المصروفات التشغيلية = كل سندات الصرف ما عدا قطع الغيار (المحسوبة ضمن COGS)
  const expenses = expensesStore
    .getAll()
    .filter((e) => inRange(e.date, f.range))
    .filter((e) => !isPartsExpense(e.categoryName))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Legacy insurance approval journals are expected values, not actual revenue.
  // Kept out of revenue; insurance revenue is recognized by issued invoices.
  const insuranceRevenue = journalStore
    .getAll()
    .filter((e) => e.creditAccount === "إيرادات التأمين" && inRange(e.date, f.range))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const salesRevenueExVat = roundMoney(sales.totalRevenue - sales.vatCollected);
  // Insurance claim estimates/approvals are expected values only.
  // Actual insurance revenue is handled by invoice-based cloud reports.
  const revenue = salesRevenueExVat;
  const grossProfit = revenue - cogs - laborCost;
  const netProfit = grossProfit - expenses;
  const vatDue = sales.vatCollected - purchases.vatPaid;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  return {
    revenue,
    cogs,
    laborCost,
    expenses,
    grossProfit,
    netProfit,
    vatCollected: sales.vatCollected,
    vatPaid: purchases.vatPaid,
    vatDue,
    margin,
  };
}


// =================== 2) ربح/خسارة لكل سيارة ===================

export interface PerVehicleProfitRow {
  orderId: string;
  date: string;
  plate: string;
  customer: string;
  vehicleType: string;
  revenue: number;
  partsCost: number;
  laborCost: number;
  extraExpenses: number;
  externalVouchers: number; // سندات صرف مرتبطة
  totalCost: number;
  profit: number;
  margin: number;
  status: string;
  technician: string;
}

export function buildPerVehicleProfitReport(f: ReportFilters): {
  rows: PerVehicleProfitRow[];
  totals: { revenue: number; cost: number; profit: number; margin: number };
} {
  const orders = getWorkOrders().filter((o) => inRange(o.entryDate, f.range));
  const filtered = orders.filter((o) => {
    if (f.customer && o.customer !== f.customer) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.technician && o.technician !== f.technician) return false;
    return true;
  });

  const invoiceRevenueByOrder = revenueByWorkOrder(f.range);
  const rows: PerVehicleProfitRow[] = filtered.map((o) => {
    const revenue = invoiceRevenueByOrder.get(o.id) || 0;
    // Work-order parts/labour fields are estimates unless backed by actual
    // vouchers. Do not use them as real accounting cost or profit reduction.
    const partsCost = 0;
    const laborCost = 0;
    const extraExpenses = 0;
    const externalVouchers = getExpensesTotalForWorkOrder(o.id);
    const totalCost = partsCost + laborCost + extraExpenses + externalVouchers;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      orderId: o.id,
      date: o.entryDate,
      plate: o.plate,
      customer: o.customer,
      vehicleType: `${o.vehicleType} ${o.model || ""}`.trim(),
      revenue,
      partsCost,
      laborCost,
      extraExpenses,
      externalVouchers,
      totalCost,
      profit,
      margin,
      status: o.status,
      technician: o.technician,
    };
  });

  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cost = rows.reduce((s, r) => s + r.totalCost, 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return { rows, totals: { revenue, cost, profit, margin } };
}

// تفاصيل ربحية لسيارة واحدة (للتوسعة داخل التقرير)
export interface VehicleProfitDetail {
  services: { label: string; amount: number }[];
  parts: { label: string; qty: number; unitPrice: number; total: number }[];
  internalExpenses: { label: string; amount: number; notes?: string }[];
  externalVouchers: {
    voucherNumber: string;
    date: string;
    amount: number;
    category?: string;
    description?: string;
  }[];
}

export function getVehicleProfitDetail(orderId: string): VehicleProfitDetail {
  const order = getWorkOrders().find((o) => o.id === orderId);
  if (!order) {
    return { services: [], parts: [], internalExpenses: [], externalVouchers: [] };
  }

  const services: { label: string; amount: number }[] = [];
  // Estimated labour from the work order is intentionally not shown as an
  // actual accounting cost. Actual labour must be entered through vouchers.

  // قطع الغيار الفعلية تأتي من سندات/مصروفات مرتبطة، لا من قيمة تقديرية في أمر العمل.
  const parts: { label: string; qty: number; unitPrice: number; total: number }[] = [];

  const internalExpenses = (order.extraExpenses || []).map((e) => ({
    label: e.label,
    amount: Number(e.amount) || 0,
    notes: e.notes,
  }));

  const externalVouchers = expensesStore
    .getAll()
    .filter((e) => e.linkedWorkOrderId === orderId)
    .map((e) => ({
      voucherNumber: e.voucherNumber,
      date: e.date,
      amount: Number(e.amount) || 0,
      category: e.categoryName,
      description: e.description,
    }));

  return { services, parts, internalExpenses, externalVouchers };
}

// =================== 3) ضريبة القيمة المضافة ===================

export interface VatReport {
  outputVat: number;
  inputVat: number;
  netDue: number;
  salesBase: number;
  purchasesBase: number;
}

export function buildVatReport(f: ReportFilters): VatReport {
  const sales = buildSalesReport(f);
  const purchases = buildPurchasesReport(f);
  const salesBase = sales.totalRevenue - sales.vatCollected;
  const purchasesBase = purchases.totalPurchases - purchases.vatPaid;
  return {
    outputVat: sales.vatCollected,
    inputVat: purchases.vatPaid,
    netDue: sales.vatCollected - purchases.vatPaid,
    salesBase,
    purchasesBase,
  };
}

// =================== 4) تقارير تشغيلية ===================

export interface InventoryValueRow {
  partId: string;
  name: string;
  partNumber: string;
  category: string;
  stock: number;
  minStock: number;
  buyPrice: number;
  sellPrice: number;
  inventoryValue: number;
  status: "ok" | "low" | "out";
}

export function buildInventoryReport(): {
  rows: InventoryValueRow[];
  totals: { items: number; totalValue: number; lowStock: number; outOfStock: number };
} {
  const rows: InventoryValueRow[] = inventoryStore.getAll().map((p) => {
    const status: "ok" | "low" | "out" =
      p.stock <= 0 ? "out" : p.stock <= (p.minStock || 0) ? "low" : "ok";
    return {
      partId: p.id,
      name: p.name,
      partNumber: p.partNumber,
      category: p.category || "—",
      stock: p.stock,
      minStock: p.minStock,
      buyPrice: p.buyPrice,
      sellPrice: p.sellPrice,
      inventoryValue: p.stock * p.buyPrice,
      status,
    };
  });

  return {
    rows,
    totals: {
      items: rows.length,
      totalValue: rows.reduce((s, r) => s + r.inventoryValue, 0),
      lowStock: rows.filter((r) => r.status === "low").length,
      outOfStock: rows.filter((r) => r.status === "out").length,
    },
  };
}

export interface MovementRow {
  id: string;
  date: string;
  type: "IN" | "OUT" | "TRANSFER";
  reference: string;
  reason: string;
  itemsCount: number;
  totalQty: number;
}

export function buildMovementsReport(f: ReportFilters): MovementRow[] {
  return stockMovementsStore
    .getAll()
    .filter((m) => inRange(m.date, f.range))
    .map((m) => ({
      id: m.id,
      date: m.date,
      type: m.type,
      reference: m.reference || "—",
      reason: m.reason,
      itemsCount: m.items.length,
      totalQty: m.items.reduce((s, i) => s + i.qty, 0),
    }));
}

export interface WorkOrderRow {
  id: string;
  date: string;
  customer: string;
  plate: string;
  technician: string;
  status: string;
  totalCost: number;
  serviceType: string;
}

export function buildWorkOrdersReport(f: ReportFilters): WorkOrderRow[] {
  return getWorkOrders()
    .filter((o) => inRange(o.entryDate, f.range))
    .filter((o) => (!f.customer || o.customer === f.customer))
    .filter((o) => (!f.status || o.status === f.status))
    .filter((o) => (!f.technician || o.technician === f.technician))
    .map((o) => ({
      id: o.id,
      date: o.entryDate,
      customer: o.customer,
      plate: o.plate,
      technician: o.technician,
      status: o.status,
      totalCost: Number(o.totalCost) || 0,
      serviceType: o.serviceType,
    }));
}

// =================== 5) العلاقات (عملاء/موردين) ===================

export interface CustomerLedgerRow {
  customerId: string;
  name: string;
  phone: string;
  visits: number;
  totalSpent: number;
  pending: number;
  depositBalance: number;
  lastVisit: string;
}

export function buildCustomersReport(f: ReportFilters): CustomerLedgerRow[] {
  const orders = getWorkOrders().filter((o) => inRange(o.entryDate, f.range));
  const deposits = depositsStore.getAll();
  const receiptsInRange = loadReceiptsInRange(f.range);

  return customersStore.getAll().map((c) => {
    const myOrders = orders.filter((o) => o.customer === c.name);
    const totalSpent = myOrders.reduce((s, o) => s + (Number(o.totalCost) || 0), 0);
    // المعلَّق = الإجمالي − (سندات قبض + عرابين فعلية في الفترة)، وليس بناءً على الحالة فقط
    const paidFromReceipts = receiptsInRange
      .filter((r) => normName(r.payerName || "") === normName(c.name))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const paidFromDeposits = deposits
      .filter((d) => d.customer === c.name && inRange(d.date, f.range))
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const pending = Math.max(0, totalSpent - paidFromReceipts - paidFromDeposits);
    const depositBalance = deposits
      .filter((d) => d.customer === c.name)
      .reduce((s, d) => s + Math.max(0, d.amount - (d.consumed || 0)), 0);
    const lastVisit = myOrders.map((o) => o.entryDate).sort().reverse()[0] || "—";


    return {
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      visits: myOrders.length,
      totalSpent,
      pending,
      depositBalance,
      lastVisit,
    };
  });
}

export interface SupplierLedgerRow {
  supplierId: string;
  name: string;
  phone: string;
  totalPurchases: number;
  totalPaid: number;
  balance: number;
}

export function buildSuppliersReport(f: ReportFilters): SupplierLedgerRow[] {
  const invoices = purchaseInvoicesStore.getAll().filter((p) => inRange(p.date, f.range));
  const payments = supplierPaymentsStore.getAll().filter((p) => inRange(p.date, f.range));

  return suppliersStore.getAll().map((s) => {
    const myInvoices = invoices.filter((i) => i.supplierId === s.id);
    const totalPurchases = myInvoices.reduce((sum, i) => sum + getPurchaseTotals(i).total, 0);
    const totalPaid = payments.filter((p) => p.supplierId === s.id).reduce((sum, p) => sum + p.amount, 0);
    return {
      supplierId: s.id,
      name: s.name,
      phone: s.phone,
      totalPurchases,
      totalPaid,
      // قد يكون الرصيد سالباً (دفعنا أكثر مما اشترينا) — نُظهر الحقيقة بدل إخفائها
      balance: totalPurchases - totalPaid,
    };
  });
}

// =================== 6) المحاسبية ===================

export interface JournalRow {
  id: string;
  date: string;
  source: string;
  sourceId: string;
  debit: string;
  credit: string;
  amount: number;
  description: string;
}

export function buildJournalReport(f: ReportFilters): JournalRow[] {
  return journalStore
    .getAll()
    .filter((e) => inRange(e.date, f.range))
    .map((e) => ({
      id: e.id,
      date: e.date,
      source: e.source,
      sourceId: e.sourceId,
      debit: e.debitAccount,
      credit: e.creditAccount,
      amount: e.amount,
      description: e.description,
    }));
}

export interface TrialBalanceRow {
  account: string;
  debit: number;
  credit: number;
  balance: number;
}

export function buildTrialBalance(f: ReportFilters): {
  rows: TrialBalanceRow[];
  totals: { debit: number; credit: number };
} {
  const entries = journalStore.getAll().filter((e) => inRange(e.date, f.range));
  const map = new Map<string, { debit: number; credit: number }>();

  entries.forEach((e) => {
    const d = map.get(e.debitAccount) || { debit: 0, credit: 0 };
    d.debit += e.amount;
    map.set(e.debitAccount, d);

    const c = map.get(e.creditAccount) || { debit: 0, credit: 0 };
    c.credit += e.amount;
    map.set(e.creditAccount, c);
  });

  const rows: TrialBalanceRow[] = Array.from(map.entries()).map(([account, v]) => ({
    account,
    debit: v.debit,
    credit: v.credit,
    balance: v.debit - v.credit,
  }));

  return {
    rows,
    totals: {
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
    },
  };
}

// =================== أدوات للقوائم المنسدلة ===================

export function getReportFacets() {
  return {
    customers: customersStore.getAll().map((c) => c.name),
    suppliers: suppliersStore.getAll().map((s) => s.name),
    technicians: Array.from(new Set(getWorkOrders().map((o) => o.technician).filter(Boolean))),
    statuses: Array.from(new Set(getWorkOrders().map((o) => o.status).filter(Boolean))),
  };
}


// =================== ربح قطع الغيار ===================

export interface PartsProfitRow {
  voucherNumber: string;
  date: string;
  workOrderId?: string;
  partId: string;
  partName: string;
  partNumber: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  totalCost: number;
  totalRevenue: number;
  profit: number;
  marginPct: number; // هامش الربح %
  supplier?: string;
  supplierTaxNumber?: string;
  supplierInvoiceNumber?: string;
}

export function buildPartsProfitReport(f: ReportFilters): {
  rows: PartsProfitRow[];
  totals: {
    items: number;
    qty: number;
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    avgMarginPct: number;
  };
  byPart: Array<{ partId: string; partName: string; qty: number; profit: number; revenue: number }>;
} {
  const rows: PartsProfitRow[] = expensesStore.getAll()
    .filter((e) => e.partName && e.partQty && e.unitBuyPrice != null && e.unitSellPrice != null)
    .filter((e) => inRange(e.date, f.range))
    .map((e) => {
      const qty = e.partQty || 0;
      const buy = e.unitBuyPrice || 0;
      const sell = e.unitSellPrice || 0;
      const totalCost = buy * qty;
      const totalRevenue = sell * qty;
      const profit = (sell - buy) * qty;
      const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
      return {
        voucherNumber: e.voucherNumber,
        date: e.date,
        workOrderId: e.linkedWorkOrderId,
        partId: e.partId || e.id,
        partName: e.partName || "—",
        partNumber: e.partNumber || "—",
        qty,
        buyPrice: buy,
        sellPrice: sell,
        totalCost,
        totalRevenue,
        profit,
        marginPct,
        supplier: e.beneficiary,
        supplierTaxNumber: e.supplierTaxNumber,
        supplierInvoiceNumber: e.supplierInvoiceNumber,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  // تجميع حسب القطعة
  const partMap = new Map<string, { partId: string; partName: string; qty: number; profit: number; revenue: number }>();
  rows.forEach((r) => {
    const cur = partMap.get(r.partId) || { partId: r.partId, partName: r.partName, qty: 0, profit: 0, revenue: 0 };
    cur.qty += r.qty;
    cur.profit += r.profit;
    cur.revenue += r.totalRevenue;
    partMap.set(r.partId, cur);
  });

  return {
    rows,
    totals: {
      items: rows.length,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      totalCost: rows.reduce((s, r) => s + r.totalCost, 0),
      totalRevenue,
      totalProfit,
      avgMarginPct: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    },
    byPart: Array.from(partMap.values()).sort((a, b) => b.profit - a.profit),
  };
}
