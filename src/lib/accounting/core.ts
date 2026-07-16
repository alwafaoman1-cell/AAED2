import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { salesStore, type SalesDoc } from "@/lib/salesStore";
import { getWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";
import { calculateVatExclusive, formatOMR as formatMoneyOMR, roundMoney as roundOmaniMoney, OMAN_VAT_RATE, OMR_DECIMALS } from "@/lib/money";

export { OMAN_VAT_RATE, OMR_DECIMALS };

export type AccountingCostSource = "Actual Expenses" | "Estimate Only" | "Manual Final Cost";
export type AccountingExpenseCategory = "spare_parts" | "labour" | "towing" | "purchase" | "other";

export interface AccountingDateRange {
  from?: string;
  to?: string;
}

export interface WorkOrderAccountingRow {
  tenantId?: string | null;
  workOrderId: string;
  workOrderNumber: string;
  customerId?: string | null;
  vehicleId?: string | null;
  customerName: string;
  customerPhone: string;
  vehiclePlate: string;
  vehicleName: string;
  serviceType: string;
  orderType: string;
  status: string;
  date: string;
  revenueExVat: number;
  vatOutput: number;
  invoiceTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  estimatedSparePartsCost: number;
  estimatedLabourCost: number;
  actualSparePartsCost: number;
  actualLabourCost: number;
  otherExpenses: number;
  sparePartsCost: number;
  labourCost: number;
  totalCost: number;
  netProfit: number;
  profitMargin: number | null;
  finalCostSource: AccountingCostSource;
  notes: string;
  hasInvoice: boolean;
  invoiceIds: string[];
}

export interface AccountingSummary {
  workOrdersCount: number;
  totalRevenueExVat: number;
  totalVatOutput: number;
  totalInvoiceAmount: number;
  totalPaidAmount: number;
  totalOutstandingAmount: number;
  totalSparePartsCost: number;
  totalLabourCost: number;
  totalOtherExpenses: number;
  totalExpenses: number;
  netProfit: number;
  averageProfitMargin: number | null;
  openWorkOrders: number;
  deliveredWorkOrders: number;
  vehiclesInWorkshop: number;
  completedWithoutInvoice: number;
  overdueInvoices: number;
}

export interface DataQualityIssue {
  id: string;
  severity: "warning" | "critical";
  label: string;
  count: number;
  details?: string;
}

function roundMoney(value: unknown): number {
  return roundOmaniMoney(value);
}

export function formatOMR(value: unknown): string {
  return formatMoneyOMR(value);
}

export function calculateVatFromSubtotal(subtotal: unknown, vatRate = OMAN_VAT_RATE) {
  const breakdown = calculateVatExclusive(subtotal, vatRate);
  return {
    subtotal: breakdown.subtotalBeforeVat,
    vat: breakdown.vatAmount,
    total: breakdown.totalIncludingVat,
  };
}

function inRange(date: string | undefined, range?: AccountingDateRange): boolean {
  const d = (date || "").slice(0, 10);
  if (!d) return false;
  return (!range?.from || d >= range.from) && (!range?.to || d <= range.to);
}

function isCompletedStatus(status?: string): boolean {
  const s = String(status || "").toLowerCase();
  return ["completed", "ready", "delivered", "closed", "جاهز", "تم التسليم", "مغلق"].some((x) => s.includes(x));
}

function isOpenStatus(status?: string): boolean {
  return !isCompletedStatus(status) && !String(status || "").toLowerCase().includes("cancel");
}

function expenseCategory(expense: ExpenseRecord): AccountingExpenseCategory {
  const haystack = [
    expense.categoryName,
    expense.description,
    expense.partName,
    expense.reference,
  ].filter(Boolean).join(" ").toLowerCase();
  if (expense.partName || /spare|part|قطع|غيار/.test(haystack)) return "spare_parts";
  if (/labou?r|wage|salary|عمال|أجر|اجور|أجور/.test(haystack)) return "labour";
  if (/tow|recovery|نقل|سطحة|سحب/.test(haystack)) return "towing";
  if (/purchase|شراء|مشتريات/.test(haystack)) return "purchase";
  return "other";
}

function uniqueExpenses(expenses: ExpenseRecord[]): ExpenseRecord[] {
  const seen = new Set<string>();
  return expenses.filter((expense) => {
    const key = expense.id || expense.voucherNumber || `${expense.date}:${expense.amount}:${expense.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function docsForWorkOrder(order: WorkOrder, invoices: SalesDoc[]): SalesDoc[] {
  return invoices.filter((doc) => {
    const metadata = doc as SalesDoc & { workOrderId?: string; work_order_id?: string };
    const byId =
      metadata.workOrderId === order.id ||
      metadata.work_order_id === order.id ||
      doc.costCenter === order.id ||
      doc.source === order.id ||
      doc.fromDocId === order.id;
    const byVehicle = !!order.plate && doc.vehicle?.plate === order.plate && doc.customerId === order.customerId;
    return byId || byVehicle;
  });
}

function nonCancelledIssuedInvoices(): SalesDoc[] {
  return salesStore
    .list({ type: "invoice" })
    .filter((doc) => !["draft", "cancelled"].includes(doc.status));
}

function expensesForWorkOrder(order: WorkOrder): ExpenseRecord[] {
  return uniqueExpenses(
    expensesStore.getAll().filter((expense) => {
      if (expense.refunded) return false;
      return expense.linkedWorkOrderId === order.id || (!!order.plate && expense.linkedVehiclePlate === order.plate);
    }),
  );
}

function revenueFromInvoices(invoices: SalesDoc[]) {
  return invoices.reduce(
    (acc, invoice) => {
      acc.revenueExVat += roundMoney(invoice.subtotal);
      acc.vatOutput += roundMoney(invoice.taxTotal);
      acc.invoiceTotal += roundMoney(invoice.total);
      acc.paidAmount += roundMoney(invoice.paidTotal);
      return acc;
    },
    { revenueExVat: 0, vatOutput: 0, invoiceTotal: 0, paidAmount: 0 },
  );
}

export function buildWorkOrderAccountingRows(range?: AccountingDateRange): WorkOrderAccountingRow[] {
  const invoices = nonCancelledIssuedInvoices();
  return getWorkOrders()
    .filter((order) => inRange(order.entryDate || order.receivedAt, range))
    .map((order) => {
      const orderInvoices = docsForWorkOrder(order, invoices);
      const revenue = revenueFromInvoices(orderInvoices);
      const revenueExVat = roundMoney(revenue.revenueExVat);
      const vatOutput = roundMoney(revenue.vatOutput);
      const invoiceTotal = roundMoney(revenue.invoiceTotal);
      const paidAmount = roundMoney(revenue.paidAmount);
      const expenses = expensesForWorkOrder(order);
      const actualSparePartsCost = roundMoney(expenses.filter((e) => expenseCategory(e) === "spare_parts").reduce((sum, e) => sum + Number(e.amount || 0), 0));
      const actualLabourCost = roundMoney(expenses.filter((e) => expenseCategory(e) === "labour").reduce((sum, e) => sum + Number(e.amount || 0), 0));
      const otherExpenses = roundMoney(expenses.filter((e) => !["spare_parts", "labour"].includes(expenseCategory(e))).reduce((sum, e) => sum + Number(e.amount || 0), 0));
      const estimatedSparePartsCost = roundMoney(order.partsCost);
      const estimatedLabourCost = roundMoney(order.laborCost);
      const hasActualExpenses = actualSparePartsCost > 0 || actualLabourCost > 0 || otherExpenses > 0;
      const finalCostSource: AccountingCostSource = hasActualExpenses ? "Actual Expenses" : "Estimate Only";
      // Estimated work-order/claim costs are planning values only. They must not
      // be recognized as actual expenses or reduce real profit until an actual
      // expense, purchase, or labour voucher is recorded.
      const sparePartsCost = actualSparePartsCost;
      const labourCost = actualLabourCost;
      const totalCost = roundMoney(sparePartsCost + labourCost + otherExpenses);
      const netProfit = roundMoney(revenueExVat - totalCost);
      const profitMargin = revenueExVat > 0 ? roundMoney((netProfit / revenueExVat) * 100) : null;
      return {
        workOrderId: order.cloudId || order.id,
        workOrderNumber: order.displayNumber || order.id,
        customerId: order.customerId || null,
        vehicleId: order.vehicleId || null,
        customerName: order.customer || "—",
        customerPhone: order.phone || "—",
        vehiclePlate: order.plate || "—",
        vehicleName: `${order.vehicleType || ""} ${order.model || ""}`.trim() || "—",
        serviceType: order.serviceType || "—",
        orderType: order.workOrderType || (order.claimId ? "insurance" : "general_customer"),
        status: order.status || "—",
        date: (order.entryDate || order.receivedAt || "").slice(0, 10),
        revenueExVat,
        vatOutput,
        invoiceTotal,
        paidAmount,
        outstandingAmount: roundMoney(Math.max(0, invoiceTotal - paidAmount)),
        estimatedSparePartsCost,
        estimatedLabourCost,
        actualSparePartsCost,
        actualLabourCost,
        otherExpenses,
        sparePartsCost,
        labourCost,
        totalCost,
        netProfit,
        profitMargin,
        finalCostSource,
        notes: order.description || order.diagnosis || "",
        hasInvoice: orderInvoices.length > 0,
        invoiceIds: orderInvoices.map((invoice) => invoice.id),
      };
    });
}

export function summarizeAccounting(rows: WorkOrderAccountingRow[]): AccountingSummary {
  const totals = rows.reduce(
    (acc, row) => {
      acc.totalRevenueExVat += row.revenueExVat;
      acc.totalVatOutput += row.vatOutput;
      acc.totalInvoiceAmount += row.invoiceTotal;
      acc.totalPaidAmount += row.paidAmount;
      acc.totalOutstandingAmount += row.outstandingAmount;
      acc.totalSparePartsCost += row.sparePartsCost;
      acc.totalLabourCost += row.labourCost;
      acc.totalOtherExpenses += row.otherExpenses;
      acc.totalExpenses += row.totalCost;
      acc.netProfit += row.netProfit;
      if (isOpenStatus(row.status)) acc.openWorkOrders += 1;
      if (isCompletedStatus(row.status)) acc.deliveredWorkOrders += 1;
      if (isCompletedStatus(row.status) && !row.hasInvoice) acc.completedWithoutInvoice += 1;
      return acc;
    },
    {
      workOrdersCount: rows.length,
      totalRevenueExVat: 0,
      totalVatOutput: 0,
      totalInvoiceAmount: 0,
      totalPaidAmount: 0,
      totalOutstandingAmount: 0,
      totalSparePartsCost: 0,
      totalLabourCost: 0,
      totalOtherExpenses: 0,
      totalExpenses: 0,
      netProfit: 0,
      averageProfitMargin: null as number | null,
      openWorkOrders: 0,
      deliveredWorkOrders: 0,
      vehiclesInWorkshop: 0,
      completedWithoutInvoice: 0,
      overdueInvoices: 0,
    },
  );
  totals.vehiclesInWorkshop = new Set(rows.filter((row) => isOpenStatus(row.status)).map((row) => row.vehicleId || row.vehiclePlate)).size;
  const marginRows = rows.filter((row) => row.profitMargin != null);
  totals.averageProfitMargin = marginRows.length
    ? roundMoney(marginRows.reduce((sum, row) => sum + Number(row.profitMargin || 0), 0) / marginRows.length)
    : null;
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, typeof value === "number" ? roundMoney(value) : value])) as unknown as AccountingSummary;
}

export function buildExecutiveAccountingSummary(range?: AccountingDateRange): AccountingSummary {
  return summarizeAccounting(buildWorkOrderAccountingRows(range));
}

export function buildDataQualityIssues(): DataQualityIssue[] {
  const orders = getWorkOrders();
  const invoices = salesStore.list({ type: "invoice" });
  const expenses = expensesStore.getAll();
  const issues: DataQualityIssue[] = [
    {
      id: "work_orders_missing_customer_id",
      severity: "critical",
      label: "أوامر عمل بدون customer_id",
      count: orders.filter((order) => !order.customerId).length,
    },
    {
      id: "work_orders_missing_vehicle_id",
      severity: "critical",
      label: "أوامر عمل بدون vehicle_id",
      count: orders.filter((order) => !order.vehicleId).length,
    },
    {
      id: "expenses_without_link",
      severity: "warning",
      label: "مصروفات غير مرتبطة بأمر أو مركبة",
      count: expenses.filter((expense) => !expense.linkedWorkOrderId && !expense.linkedVehiclePlate).length,
    },
    {
      id: "completed_without_invoice",
      severity: "warning",
      label: "أوامر مكتملة بدون فاتورة",
      count: buildWorkOrderAccountingRows().filter((row) => isCompletedStatus(row.status) && !row.hasInvoice).length,
    },
    {
      id: "vat_not_5_percent",
      severity: "warning",
      label: "فواتير VAT لا تطابق 5%",
      count: invoices.filter((invoice) => invoice.status !== "cancelled" && Math.abs(roundMoney(invoice.subtotal * OMAN_VAT_RATE) - roundMoney(invoice.taxTotal)) > 0.002).length,
    },
  ];
  return issues.filter((issue) => issue.count > 0);
}
