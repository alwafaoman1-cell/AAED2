import * as XLSX from "xlsx";
import type { InsuranceInvoice } from "@/hooks/useInsuranceInvoices";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";

export type InsuranceInvoiceCollectionStatus = "unpaid" | "partial" | "paid" | "cancelled";

export type InsuranceInvoiceReportColumnKey =
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "insuranceCompany"
  | "claimNumber"
  | "lpoNumber"
  | "policyNumber"
  | "customerName"
  | "plateNumber"
  | "vehicleMake"
  | "vehicleModel"
  | "vehicleYear"
  | "vin"
  | "subtotal"
  | "vat"
  | "total"
  | "paidAmount"
  | "remainingAmount"
  | "collectionStatusLabel"
  | "invoiceStatusLabel"
  | "lastPaymentDate"
  | "itemsDescription"
  | "notes";

export interface InsuranceInvoiceReportRow {
  invoiceId: string;
  claimId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  insuranceCompany: string;
  claimNumber: string;
  lpoNumber: string;
  policyNumber: string;
  customerName: string;
  plateNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vin: string;
  subtotal: number;
  vat: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  collectionStatus: InsuranceInvoiceCollectionStatus;
  collectionStatusLabel: string;
  invoiceStatus: string;
  invoiceStatusLabel: string;
  lastPaymentDate: string;
  itemsDescription: string;
  notes: string;
}

export interface InsuranceInvoiceReportFilters {
  search: string;
  company: string;
  collectionStatus: string;
  invoiceStatus: string;
  dateFrom: string;
  dateTo: string;
  dueState: string;
  lpoState: string;
  amountMin: string;
  amountMax: string;
}

export type InsuranceInvoiceSortKey =
  | "invoiceDate"
  | "invoiceNumber"
  | "insuranceCompany"
  | "claimNumber"
  | "total"
  | "paidAmount"
  | "remainingAmount"
  | "dueDate";

export const INSURANCE_INVOICE_REPORT_COLUMNS: Array<{
  key: InsuranceInvoiceReportColumnKey;
  label: string;
  width: number;
  numeric?: boolean;
}> = [
  { key: "invoiceNumber", label: "رقم الفاتورة", width: 20 },
  { key: "invoiceDate", label: "تاريخ الفاتورة", width: 16 },
  { key: "dueDate", label: "تاريخ الاستحقاق", width: 16 },
  { key: "insuranceCompany", label: "شركة التأمين", width: 26 },
  { key: "claimNumber", label: "رقم المطالبة", width: 26 },
  { key: "lpoNumber", label: "رقم LPO", width: 20 },
  { key: "policyNumber", label: "رقم الوثيقة", width: 20 },
  { key: "customerName", label: "اسم العميل", width: 24 },
  { key: "plateNumber", label: "رقم اللوحة", width: 18 },
  { key: "vehicleMake", label: "الماركة", width: 18 },
  { key: "vehicleModel", label: "الموديل", width: 18 },
  { key: "vehicleYear", label: "سنة الصنع", width: 12 },
  { key: "vin", label: "رقم الهيكل VIN", width: 24 },
  { key: "subtotal", label: "المبلغ قبل الضريبة", width: 20, numeric: true },
  { key: "vat", label: "الضريبة", width: 16, numeric: true },
  { key: "total", label: "الإجمالي شامل الضريبة", width: 22, numeric: true },
  { key: "paidAmount", label: "المدفوع", width: 16, numeric: true },
  { key: "remainingAmount", label: "المتبقي", width: 16, numeric: true },
  { key: "collectionStatusLabel", label: "حالة التحصيل", width: 18 },
  { key: "invoiceStatusLabel", label: "حالة الفاتورة", width: 16 },
  { key: "lastPaymentDate", label: "تاريخ آخر دفعة", width: 18 },
  { key: "itemsDescription", label: "بنود الفاتورة", width: 42 },
  { key: "notes", label: "ملاحظات", width: 32 },
];

const INVOICE_STATUS_LABELS: Record<string, string> = {
  issued: "صادرة",
  partial: "جزئية",
  paid: "مدفوعة",
  overdue: "متأخرة",
  cancelled: "ملغاة",
};

const invoiceDate = (invoice: InsuranceInvoice): string =>
  invoice.invoice_date || invoice.issued_at?.slice(0, 10) || invoice.created_at?.slice(0, 10) || "";

function collectionStatus(invoice: InsuranceInvoice): InsuranceInvoiceCollectionStatus {
  if (invoice.status === "cancelled") return "cancelled";
  const total = Number(invoice.total || 0);
  const paid = Number(invoice.paid_amount || 0);
  if (total <= paid + 0.001) return "paid";
  if (paid > 0.001) return "partial";
  return "unpaid";
}

const COLLECTION_LABELS: Record<InsuranceInvoiceCollectionStatus, string> = {
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة بالكامل",
  cancelled: "ملغاة",
};

export function buildInsuranceInvoiceReportRows(
  invoices: InsuranceInvoice[],
  claims: InsuranceClaim[],
): InsuranceInvoiceReportRow[] {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return invoices.map((invoice) => {
    const claim = claimsById.get(invoice.claim_id) as any;
    const vehicle = claim?.vehicle || {};
    const total = Number(invoice.total || 0);
    const paidAmount = Number(invoice.paid_amount || 0);
    const status = collectionStatus(invoice);
    const plateNumber = [
      vehicle.plate_letters,
      vehicle.plate_number || invoice.vehicle_plate,
      vehicle.plate_country,
    ].filter(Boolean).join(" ") || invoice.vehicle_plate || "—";
    return {
      invoiceId: invoice.id,
      claimId: invoice.claim_id,
      invoiceNumber: invoice.invoice_number || "—",
      invoiceDate: invoiceDate(invoice),
      dueDate: invoice.due_date || "",
      insuranceCompany: invoice.insurance_company_name || claim?.insurance_company || "—",
      claimNumber: claim?.claim_number || "—",
      lpoNumber: invoice.lpo_number || "—",
      policyNumber: claim?.policy_number || "—",
      customerName: claim?.customer?.name || claim?.vehicle_owner_name || "—",
      plateNumber,
      vehicleMake: invoice.vehicle_make || claim?.vehicle_make || vehicle.brand || "—",
      vehicleModel: invoice.vehicle_model || claim?.vehicle_model || vehicle.model || "—",
      vehicleYear: String(claim?.vehicle_year || vehicle.year || "—"),
      vin: (invoice as any).vehicle_vin || claim?.vehicle_vin || vehicle.vin_number || "—",
      subtotal: Number(invoice.subtotal || 0),
      vat: Number(invoice.vat || 0),
      total,
      paidAmount,
      remainingAmount: Math.max(0, total - paidAmount),
      collectionStatus: status,
      collectionStatusLabel: COLLECTION_LABELS[status],
      invoiceStatus: invoice.status,
      invoiceStatusLabel: INVOICE_STATUS_LABELS[invoice.status] || invoice.status,
      lastPaymentDate: invoice.last_payment_date?.slice(0, 10) || "",
      itemsDescription: (invoice.items || [])
        .map((item) => `${item.description} × ${Number(item.quantity || 1)}`)
        .filter(Boolean)
        .join(" | ") || "—",
      notes: invoice.notes || "—",
    };
  });
}

export function filterAndSortInsuranceInvoiceRows(
  rows: InsuranceInvoiceReportRow[],
  filters: InsuranceInvoiceReportFilters,
  sortKey: InsuranceInvoiceSortKey,
  sortDirection: "asc" | "desc",
  today = new Date().toISOString().slice(0, 10),
): InsuranceInvoiceReportRow[] {
  const search = filters.search.trim().toLowerCase();
  const min = filters.amountMin === "" ? null : Number(filters.amountMin);
  const max = filters.amountMax === "" ? null : Number(filters.amountMax);
  const filtered = rows.filter((row) => {
    if (filters.company !== "all" && row.insuranceCompany !== filters.company) return false;
    if (filters.collectionStatus !== "all" && row.collectionStatus !== filters.collectionStatus) return false;
    if (filters.invoiceStatus !== "all" && row.invoiceStatus !== filters.invoiceStatus) return false;
    if (filters.dateFrom && row.invoiceDate < filters.dateFrom) return false;
    if (filters.dateTo && row.invoiceDate > filters.dateTo) return false;
    if (filters.lpoState === "with" && row.lpoNumber === "—") return false;
    if (filters.lpoState === "without" && row.lpoNumber !== "—") return false;
    if (filters.dueState === "overdue" && (!row.dueDate || row.dueDate >= today || row.remainingAmount <= 0.001)) return false;
    if (filters.dueState === "current" && (!row.dueDate || row.dueDate < today || row.remainingAmount <= 0.001)) return false;
    if (filters.dueState === "no_due" && row.dueDate) return false;
    if (min !== null && Number.isFinite(min) && row.total < min) return false;
    if (max !== null && Number.isFinite(max) && row.total > max) return false;
    if (search && ![
      row.invoiceNumber,
      row.claimNumber,
      row.lpoNumber,
      row.insuranceCompany,
      row.customerName,
      row.plateNumber,
      row.vehicleMake,
      row.vehicleModel,
      row.vin,
      row.itemsDescription,
    ].some((value) => String(value).toLowerCase().includes(search))) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left || "").localeCompare(String(right || ""), "ar", { numeric: true });
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

export function exportInsuranceInvoiceRowsToXlsx(
  rows: InsuranceInvoiceReportRow[],
  columnKeys: InsuranceInvoiceReportColumnKey[],
  filename: string,
): void {
  if (!rows.length) throw new Error("لا توجد فواتير مطابقة للتصدير");
  if (!columnKeys.length) throw new Error("اختر عمودًا واحدًا على الأقل للتصدير");
  const columns = columnKeys
    .map((key) => INSURANCE_INVOICE_REPORT_COLUMNS.find((column) => column.key === key))
    .filter(Boolean) as typeof INSURANCE_INVOICE_REPORT_COLUMNS;
  const aoa = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: columns.length - 1 } }),
  };
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!cols"] = columns.map((column) => ({ wch: column.width }));
  columns.forEach((column, columnIndex) => {
    if (!column.numeric) return;
    for (let rowIndex = 1; rowIndex < aoa.length; rowIndex += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell) {
        cell.t = "n";
        cell.z = "#,##0.000";
      }
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Insurance Invoices");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
