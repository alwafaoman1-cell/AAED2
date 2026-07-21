import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import type { InsuranceInvoice } from "@/hooks/useInsuranceInvoices";
import type { ClaimPayment } from "@/hooks/useClaimPayments";
import { calculateVatExclusive, roundMoney } from "@/lib/money";
import { formatDateLatin, formatPlateLatin, toEnglishDigits } from "@/lib/numberUtils";

export const INSURANCE_COLLECTION_HEADERS = [
  "رقم المطالبة",
  "رقم السيارة",
  "الماركة / الموديل",
  "اسم العميل",
  "تاريخ التقدير",
  "وصول الورشة",
  "بدء العمل",
  "إنجاز العمل",
  "تاريخ التسليم",
  "تاريخ/رقم الفاتورة",
  "أيام الورشة",
  "الحالة",
  "المعتمد قبل الضريبة",
  "الضريبة 5%",
  "الإجمالي شامل الضريبة",
  "المدفوع",
  "حالة التحصيل",
] as const;

export type InsuranceCollectionStatus =
  | "غير مفوتر"
  | "غير مدفوع"
  | "مدفوع جزئيًا"
  | "مدفوع بالكامل";

export interface InsuranceCollectionRow {
  claimId: string;
  invoiceId: string | null;
  sortDate: string | null;
  claimNumber: string;
  vehicleNumber: string;
  vehicleMakeModel: string;
  customerName: string;
  estimateDate: string;
  workshopArrivalDate: string;
  workStartedAt: string;
  workCompletedAt: string;
  deliveredAt: string;
  invoiceDateNumber: string;
  workshopDays: number;
  status: string;
  approvedBeforeVat: number;
  vatAmount: number;
  totalIncludingVat: number;
  paidAmount: number;
  collectionStatus: InsuranceCollectionStatus;
  remainingAmount: number;
}

export interface BuildInsuranceCollectionRowsOptions {
  claims: InsuranceClaim[];
  invoices: InsuranceInvoice[];
  payments: ClaimPayment[];
  companyId?: string | null;
  companyName?: string | null;
  periodFrom?: string;
  periodTo?: string;
  pendingCollectionOnly?: boolean;
  includeCancelled?: boolean;
}

const DAY_MS = 86_400_000;

function rawDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.slice(0, 10);
}

function dateForDisplay(value: unknown): string {
  const d = rawDate(value);
  return d ? formatDateLatin(d) : "—";
}

function dateForRange(value: unknown): number {
  const d = rawDate(value);
  return d ? new Date(`${d}T00:00:00`).getTime() : 0;
}

function inRange(value: unknown, from?: string, to?: string): boolean {
  const t = dateForRange(value);
  if (!t) return true;
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
  return true;
}

function invoiceDateValue(invoice: InsuranceInvoice | undefined | null): string | null {
  return rawDate(invoice?.invoice_date || invoice?.issued_at || invoice?.created_at);
}

function claimDate(claim: InsuranceClaim, ...keys: string[]): string | null {
  const anyClaim = claim as any;
  for (const key of keys) {
    const value = rawDate(anyClaim[key]);
    if (value) return value;
  }
  return null;
}

function plateWithLetters(claim: InsuranceClaim, invoice?: InsuranceInvoice | null): string {
  const vehicle: any = claim.vehicle;
  const fromVehicle = [vehicle?.plate_letters, vehicle?.plate_number].filter(Boolean).join(" ").trim();
  const inline = (claim as any).vehicle_plate || invoice?.vehicle_plate || "";
  return formatPlateLatin(fromVehicle || inline || "—");
}

function vehicleMakeModel(claim: InsuranceClaim, invoice?: InsuranceInvoice | null): string {
  const vehicle: any = claim.vehicle;
  const parts = [
    vehicle?.brand || (claim as any).vehicle_make || invoice?.vehicle_make,
    vehicle?.model || (claim as any).vehicle_model || invoice?.vehicle_model,
  ].filter(Boolean);
  return toEnglishDigits(parts.join(" / ") || "—");
}

function customerName(claim: InsuranceClaim): string {
  return toEnglishDigits((claim.customer as any)?.name || claim.vehicle_owner_name || "—");
}

function getClaimStatus(claim: InsuranceClaim): string {
  const map: Record<string, string> = {
    pending: "بانتظار الاعتماد",
    approved: "قيد العمل",
    paid: "مدفوعة",
    rejected: "مرفوضة",
    cancelled: "ملغاة",
  };
  return map[claim.status] || String(claim.status || "—");
}

function chooseLatestInvoice(invoices: InsuranceInvoice[]): InsuranceInvoice | null {
  const active = invoices.filter((invoice) => invoice.status !== "cancelled");
  if (!active.length) return null;
  return [...active].sort((a, b) => {
    const ad = dateForRange(invoiceDateValue(a) || a.issued_at || a.created_at);
    const bd = dateForRange(invoiceDateValue(b) || b.issued_at || b.created_at);
    return bd - ad;
  })[0];
}

function paymentSum(claimId: string, invoice: InsuranceInvoice | null, payments: ClaimPayment[]): number {
  const sum = payments
    .filter((payment) => payment.claim_id === claimId && payment.status !== "bounced")
    .reduce((total, payment) => roundMoney(total + Number(payment.amount || 0)), 0);
  if (sum > 0) return roundMoney(sum);
  return roundMoney(invoice?.paid_amount || 0);
}

function collectionStatus(invoice: InsuranceInvoice | null, paid: number, total: number): InsuranceCollectionStatus {
  if (!invoice) return "غير مفوتر";
  if (paid <= 0.001) return "غير مدفوع";
  if (paid + 0.001 < total) return "مدفوع جزئيًا";
  return "مدفوع بالكامل";
}

function workshopDays(arrival: string | null, delivered: string | null): number {
  if (!arrival) return 0;
  const start = new Date(`${arrival}T00:00:00`).getTime();
  const end = delivered ? new Date(`${delivered}T00:00:00`).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - start) / DAY_MS));
}

function isCancelledOrDeleted(claim: InsuranceClaim): boolean {
  const c = claim as any;
  return claim.status === "cancelled" || !!c.deleted_at || !!c.archived_at;
}

export function buildInsuranceCollectionRows(options: BuildInsuranceCollectionRowsOptions): InsuranceCollectionRow[] {
  const {
    claims,
    invoices,
    payments,
    companyId,
    companyName,
    periodFrom,
    periodTo,
    pendingCollectionOnly = true,
    includeCancelled = false,
  } = options;
  const invoiceMap = new Map<string, InsuranceInvoice[]>();
  invoices.forEach((invoice) => {
    if (!invoice.claim_id) return;
    if (companyId && invoice.insurance_company_id && invoice.insurance_company_id !== companyId) return;
    const list = invoiceMap.get(invoice.claim_id) || [];
    list.push(invoice);
    invoiceMap.set(invoice.claim_id, list);
  });

  return claims
    .filter((claim) => {
      if (!includeCancelled && isCancelledOrDeleted(claim)) return false;
      if (companyId && claim.insurance_company_id && claim.insurance_company_id !== companyId) return false;
      if (companyName && !companyId && claim.insurance_company !== companyName) return false;
      return true;
    })
    .map((claim) => {
      const invoice = chooseLatestInvoice(invoiceMap.get(claim.id) || []);
      const estimateDate = claimDate(claim, "estimate_date", "approved_at", "created_at");
      const arrival = claimDate(claim, "workshop_arrival_date", "vehicle_received_at", "received_at", "created_at");
      const started = claimDate(claim, "work_started_at", "repair_started_at");
      const completed = claimDate(claim, "work_completed_at", "quality_checked_at");
      const delivered = claimDate(claim, "delivered_at", "vehicle_delivered_at");
      const fallbackSubtotal = roundMoney(Number(claim.approved_amount || claim.estimated_amount || 0));
      const subtotal = invoice ? roundMoney(invoice.subtotal || fallbackSubtotal) : fallbackSubtotal;
      const vat = invoice && invoice.vat !== null && invoice.vat !== undefined
        ? roundMoney(invoice.vat)
        : calculateVatExclusive(subtotal).vatAmount;
      const total = invoice ? roundMoney(invoice.total || subtotal + vat) : calculateVatExclusive(subtotal).totalIncludingVat;
      const paid = paymentSum(claim.id, invoice, payments);
      const status = collectionStatus(invoice, paid, total);
      const remaining = roundMoney(total - paid);
      const invDate = invoiceDateValue(invoice);
      const sortDate = delivered || invDate || estimateDate || claim.created_at;
      return {
        claimId: claim.id,
        invoiceId: invoice?.id || null,
        sortDate,
        claimNumber: toEnglishDigits(claim.claim_number || "—"),
        vehicleNumber: plateWithLetters(claim, invoice),
        vehicleMakeModel: vehicleMakeModel(claim, invoice),
        customerName: customerName(claim),
        estimateDate: dateForDisplay(estimateDate),
        workshopArrivalDate: dateForDisplay(arrival),
        workStartedAt: dateForDisplay(started),
        workCompletedAt: dateForDisplay(completed),
        deliveredAt: dateForDisplay(delivered),
        invoiceDateNumber: invoice ? toEnglishDigits(`${invoice.invoice_number || "—"} / ${invDate ? formatDateLatin(invDate) : "—"}`) : "—",
        workshopDays: workshopDays(arrival, delivered),
        status: getClaimStatus(claim),
        approvedBeforeVat: subtotal,
        vatAmount: vat,
        totalIncludingVat: total,
        paidAmount: paid,
        collectionStatus: status,
        remainingAmount: remaining,
      } satisfies InsuranceCollectionRow;
    })
    .filter((row) => {
      if (!inRange(row.sortDate, periodFrom, periodTo)) return false;
      if (!pendingCollectionOnly) return true;
      return (
        row.invoiceId !== null &&
        row.deliveredAt !== "—" &&
        row.remainingAmount > 0.001 &&
        (row.collectionStatus === "غير مدفوع" || row.collectionStatus === "مدفوع جزئيًا")
      );
    })
    .sort((a, b) => {
      const ad = dateForRange(a.sortDate);
      const bd = dateForRange(b.sortDate);
      return bd - ad || a.claimNumber.localeCompare(b.claimNumber);
    });
}

export function insuranceCollectionRowToArray(row: InsuranceCollectionRow): Array<string | number> {
  return [
    row.claimNumber,
    row.vehicleNumber,
    row.vehicleMakeModel,
    row.customerName,
    row.estimateDate,
    row.workshopArrivalDate,
    row.workStartedAt,
    row.workCompletedAt,
    row.deliveredAt,
    row.invoiceDateNumber,
    row.workshopDays,
    row.status,
    row.approvedBeforeVat,
    row.vatAmount,
    row.totalIncludingVat,
    row.paidAmount,
    row.collectionStatus,
  ];
}

export function formatOmr3(value: number): string {
  return toEnglishDigits(roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }));
}

function downloadXlsxBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function freezeHeaderRow(workbookArray: ArrayBuffer): Promise<Blob> {
  const zip = await JSZip.loadAsync(workbookArray);
  const sheet = zip.file("xl/worksheets/sheet1.xml");
  const fallback = () => new Blob([workbookArray], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  if (!sheet) return fallback();

  let xml = await sheet.async("string");
  const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>';

  if (xml.includes('state="frozen"')) {
    return fallback();
  }

  if (/<sheetView\b[^>]*>/.test(xml)) {
    xml = xml.replace(
      /(<sheetView\b[^>]*>)([\s\S]*?)(<\/sheetView>)/,
      (_match, open, content, close) => {
        const cleaned = String(content)
          .replace(/<pane\b[\s\S]*?\/>/g, "")
          .replace(/<selection\b[^>]*\/>/g, "");
        return `${open}${pane}${cleaned}${close}`;
      },
    );
  } else {
    xml = xml.replace(
      /(<sheetFormatPr\b)/,
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>$1`,
    );
  }

  zip.file("xl/worksheets/sheet1.xml", xml);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function exportInsuranceCollectionRowsToXlsx(
  rows: InsuranceCollectionRow[],
  filename: string,
): Promise<void> {
  if (!rows.length) {
    throw new Error("لا توجد سجلات مطابقة للتصدير");
  }
  const aoa = [
    [...INSURANCE_COLLECTION_HEADERS],
    ...rows.map(insuranceCollectionRowToArray),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: INSURANCE_COLLECTION_HEADERS.length - 1 } }) };
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!cols"] = INSURANCE_COLLECTION_HEADERS.map((header, index) => {
    const max = Math.max(
      String(header).length,
      ...rows.map((row) => String(insuranceCollectionRowToArray(row)[index] ?? "").length),
    );
    return { wch: Math.min(Math.max(max + 3, 12), 36) };
  });
  for (let r = 1; r < aoa.length; r += 1) {
    for (const c of [12, 13, 14, 15]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.t = "n";
        cell.z = "#,##0.000";
      }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Claims Collection");
  const workbookArray = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = await freezeHeaderRow(workbookArray);
  downloadXlsxBlob(blob, filename);
}
