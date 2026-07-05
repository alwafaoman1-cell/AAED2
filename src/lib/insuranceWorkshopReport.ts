// Insurance company workshop operations report (PDF/HTML)
// Mirrors the Excel-style table the operator uses for daily handover with insurers:
// Vehicle reported date | Approval date | Claim number | Vehicle no | Status | Delivered date
import { getTemplateSettings, type PdfTemplateSettings } from "./pdfGenerator";
import { formatDateLatin } from "./numberUtils";
import { durationLevel, durationHex } from "./claimDurationStatus";
import { splitVatInclusiveAmount } from "./workOrderCosting";

export type CollectionStatus = "paid" | "partial" | "pending" | "overdue" | "n/a";

const COLLECTION_LABELS: Record<CollectionStatus, string> = {
  paid: "تم التحصيل",
  partial: "تحصيل جزئي",
  pending: "بانتظار التحصيل",
  overdue: "تحصيل متأخر",
  "n/a": "—",
};

const COLLECTION_COLOR: Record<CollectionStatus, string> = {
  paid: "#15803d",
  partial: "#c2410c",
  pending: "#a16207",
  overdue: "#b91c1c",
  "n/a": "#6b7280",
};

export interface WorkshopReportRow {
  reportedDate: string | null;
  estimateDate?: string | null;
  arrivalDate?: string | null;
  workStartedAt?: string | null;
  workCompletedAt?: string | null;
  approvalDate: string | null;
  invoiceDate?: string | null;
  invoiceNumber?: string | null;
  claimNumber: string;
  vehicleNo: string;
  vehicleMakeModel?: string;
  customerName?: string;
  status: string;
  inWorkshopDays?: number | null;
  estimatedAmount?: number;
  approvedAmount?: number;
  paidAmount?: number;
  deliveredDate: string | null;
  collectionStatus?: CollectionStatus;
}

export type WorkshopColumnKey =
  | "claimNumber" | "vehicleNo" | "makeModel" | "customer"
  | "estimateDate" | "arrival" | "start" | "completed" | "delivered" | "invoice"
  | "days" | "status"
  | "approved" | "vat" | "totalWithVat" | "paid" | "collection";

export const DEFAULT_WORKSHOP_COLUMNS: Record<WorkshopColumnKey, boolean> = {
  claimNumber: true, vehicleNo: true, makeModel: true, customer: true,
  estimateDate: true, arrival: true, start: false, completed: false,
  delivered: true, invoice: true, days: true, status: true,
  approved: true, vat: true, totalWithVat: true, paid: true, collection: true,
};

export const WORKSHOP_COLUMN_LABELS: Record<WorkshopColumnKey, string> = {
  claimNumber: "رقم المطالبة",
  vehicleNo: "رقم السيارة",
  makeModel: "الماركة / الموديل",
  customer: "اسم العميل",
  estimateDate: "تاريخ التقدير",
  arrival: "وصول الورشة",
  start: "بدء العمل",
  completed: "إنجاز العمل",
  delivered: "تاريخ التسليم",
  invoice: "تاريخ/رقم الفاتورة",
  days: "أيام الورشة",
  status: "الحالة",
  approved: "المعتمد (قبل الضريبة)",
  vat: "الضريبة 5%",
  totalWithVat: "الإجمالي شامل الضريبة",
  paid: "المدفوع",
  collection: "حالة التحصيل",
};

export interface WorkshopReportData {
  companyName: string;
  branchCity?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  periodFrom?: string;
  periodTo?: string;
  rows: WorkshopReportRow[];
  vatRate?: number; // 0.05 default
  columns?: Partial<Record<WorkshopColumnKey, boolean>>;
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fd = (d: string | null) => (d ? formatDateLatin(d) : "—");

export function getInsuranceWorkshopReportHtml(data: WorkshopReportData): string {
  const s: PdfTemplateSettings = getTemplateSettings();
  const rows = data.rows;
  const vatRate = data.vatRate ?? 0.05;
  const cols: Record<WorkshopColumnKey, boolean> = { ...DEFAULT_WORKSHOP_COLUMNS, ...(data.columns ?? {}) };
  const order: WorkshopColumnKey[] = [
    "claimNumber","vehicleNo","makeModel","customer",
    "estimateDate","arrival","start","completed","delivered","invoice",
    "days","status","approved","vat","totalWithVat","paid","collection",
  ];
  const active = order.filter((k) => cols[k]);

  const totalEstimated = rows.reduce((a, r) => a + (r.estimatedAmount || 0), 0);
  const totalBreakdown = rows.reduce((a, r) => {
    const breakdown = splitVatInclusiveAmount(r.approvedAmount || 0, vatRate);
    return {
      subtotal: a.subtotal + breakdown.subtotalBeforeVat,
      vat: a.vat + breakdown.vatAmount,
      total: a.total + breakdown.totalIncludingVat,
    };
  }, { subtotal: 0, vat: 0, total: 0 });
  const totalApproved = +totalBreakdown.subtotal.toFixed(3);
  const totalVat = +totalBreakdown.vat.toFixed(3);
  const totalWithVat = +totalBreakdown.total.toFixed(3);
  const totalPaid = rows.reduce((a, r) => a + (r.paidAmount || 0), 0);
  const delivered = rows.filter((r) => r.deliveredDate).length;
  const inProgress = rows.length - delivered;

  const periodLabel = data.periodFrom || data.periodTo
    ? `${data.periodFrom ? fd(data.periodFrom) : "البداية"} → ${data.periodTo ? fd(data.periodTo) : "اليوم"}`
    : "كل الفترات";

  const headerCell = (k: WorkshopColumnKey): string => {
    const label = WORKSHOP_COLUMN_LABELS[k];
    return `<th>${label}</th>`;
  };

  const renderCell = (k: WorkshopColumnKey, r: WorkshopReportRow): string => {
    const breakdown = splitVatInclusiveAmount(r.approvedAmount || 0, vatRate);
    const approved = breakdown.subtotalBeforeVat;
    const vat = breakdown.vatAmount;
    const gross = breakdown.totalIncludingVat;
    const lvl = durationLevel(r.inWorkshopDays);
    const dCol = durationHex(lvl);
    const col = r.collectionStatus ?? "n/a";
    const cls = r.deliveredDate ? "status-delivered" : r.approvalDate ? "status-progress" : "status-pending";
    switch (k) {
      case "claimNumber":  return `<td class="num">${r.claimNumber}</td>`;
      case "vehicleNo":    return `<td class="num"><strong>${r.vehicleNo}</strong></td>`;
      case "makeModel":    return `<td>${r.vehicleMakeModel || "—"}</td>`;
      case "customer":     return `<td>${r.customerName || "—"}</td>`;
      case "estimateDate": return `<td>${fd(r.estimateDate ?? null)}</td>`;
      case "arrival":      return `<td>${fd(r.arrivalDate ?? r.reportedDate)}</td>`;
      case "start":        return `<td>${fd(r.workStartedAt ?? null)}</td>`;
      case "completed":    return `<td>${fd(r.workCompletedAt ?? null)}</td>`;
      case "delivered":    return `<td>${fd(r.deliveredDate)}</td>`;
      case "invoice":      return `<td>${r.invoiceDate ? `<div>${fd(r.invoiceDate)}</div>${r.invoiceNumber ? `<div style="font-size:9px;color:#3b82f6">#${r.invoiceNumber}</div>` : ""}` : "—"}</td>`;
      case "days":         return `<td style="background:${dCol.bg};color:${dCol.fg};font-weight:700">${r.inWorkshopDays != null ? r.inWorkshopDays : "—"}</td>`;
      case "status":       return `<td class="${cls}">${r.status}</td>`;
      case "approved":     return `<td class="num">${approved ? fmt(approved) : "—"}</td>`;
      case "vat":          return `<td class="num" style="color:#8b5cf6">${approved ? fmt(vat) : "—"}</td>`;
      case "totalWithVat": return `<td class="num" style="font-weight:700;background:#fef3c7">${approved ? fmt(gross) : "—"}</td>`;
      case "paid":         return `<td class="num" style="color:#27ae60">${r.paidAmount ? fmt(r.paidAmount) : "—"}</td>`;
      case "collection":   return `<td style="color:${COLLECTION_COLOR[col]};font-weight:600;font-size:9px">${COLLECTION_LABELS[col]}</td>`;
    }
  };

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير عمليات الورشة - ${data.companyName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap');
@page { size: A4 landscape; margin: 0 }
* { margin: 0; padding: 0; box-sizing: border-box }
body { font-family: 'Noto Sans Arabic', Tahoma, sans-serif; direction: rtl; color: #1a1a2e; background: #f8f9fa; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 297mm; min-height: 210mm; margin: 8mm auto; background: white; padding: 10mm 12mm; box-shadow: 0 2px 20px rgba(0,0,0,0.08); position: relative }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${s.primaryColor}; padding-bottom: 10px; margin-bottom: 14px }
.company h1 { font-size: 18px; font-weight: 700 }
.company .details { font-size: 10px; color: #888; line-height: 1.6; margin-top: 4px }
.badge { background: linear-gradient(135deg, ${s.primaryColor}, #b8902f); color: white; padding: 10px 18px; border-radius: 8px; text-align: center }
.badge .t { font-size: 12px; font-weight: 600 }
.badge .d { font-size: 10px; opacity: 0.9; margin-top: 3px }
.logo { max-height: 50px; margin-bottom: 4px }
.info-block { background: #f8f9fa; border-right: 4px solid ${s.primaryColor}; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px }
.info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 18px; font-size: 11px }
.info-row { display: flex; gap: 6px }
.info-row .l { color: #888 }
.info-row .v { font-weight: 600 }
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px }
.kpi { background: #fafbfc; border: 1px solid #eee; border-radius: 6px; padding: 8px 10px; text-align: center }
.kpi .k { font-size: 9px; color: #888; margin-bottom: 2px }
.kpi .v { font-size: 13px; font-weight: 700; direction: ltr; color: ${s.primaryColor} }
table { width: 100%; border-collapse: collapse; font-size: 10px }
thead th { background: #1a1a2e; color: white; padding: 8px 6px; text-align: center; font-weight: 600; font-size: 10px; border: 1px solid #1a1a2e }
tbody td { padding: 6px; border: 1px solid #ddd; text-align: center; vertical-align: middle }
tbody tr:nth-child(even) { background: #fafbfc }
.num { font-family: monospace; direction: ltr; text-align: left }
.idx { background: #eef2f7; font-weight: 700; color: #555; width: 28px }
.status-delivered { color: #27ae60; font-weight: 600 }
.status-progress { color: #d97706; font-weight: 600 }
.status-pending { color: #6b7280; font-weight: 600 }
.totals { margin-top: 12px; background: linear-gradient(135deg, #1a1a2e, #2c3e50); color: white; padding: 12px 16px; border-radius: 8px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px }
.totals .item { text-align: center }
.totals .item .l { font-size: 11px; opacity: 0.8; margin-bottom: 3px }
.totals .item .v { font-size: 15px; font-weight: 700; direction: ltr }
.stamp-area { margin-top: 24px; display: flex; justify-content: space-between; align-items: end }
.signature-box { text-align: center; font-size: 11px }
.signature-box .line { border-top: 1.5px solid #444; margin-top: 40px; padding-top: 5px; min-width: 170px }
.stamp-img { max-width: 110px; max-height: 110px; opacity: 0.85 }
.footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 9px; color: #888 }
@media print { html, body { background: white !important; margin: 0 !important } .page { box-shadow: none !important; margin: 0 !important; width: 100% !important } }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company">
        ${s.logoUrl ? `<img class="logo" src="${s.logoUrl}" alt="logo" />` : ""}
        <h1>${s.companyName}</h1>
        <div class="details">
          ${s.address ?? ""}<br/>
          ${s.phone ? `هاتف: ${s.phone}` : ""}${s.email ? ` • ${s.email}` : ""}<br/>
          ${s.vatNumber ? `الرقم الضريبي: ${s.vatNumber}` : ""}
        </div>
      </div>
      <div class="badge">
        <div class="t">تقرير عمليات الورشة</div>
        <div class="d">Workshop Operations Report</div>
        <div class="d" style="margin-top: 6px">${formatDateLatin(new Date())}</div>
      </div>
    </div>

    <div class="info-block">
      <div class="info-grid">
        <div class="info-row"><span class="l">شركة التأمين:</span><span class="v">${data.companyName}${data.branchCity ? ` — ${data.branchCity}` : ""}</span></div>
        <div class="info-row"><span class="l">جهة الاتصال:</span><span class="v">${data.contactPerson ?? "—"}</span></div>
        <div class="info-row"><span class="l">الهاتف:</span><span class="v">${data.phone ?? "—"}</span></div>
        <div class="info-row"><span class="l">الفترة:</span><span class="v">${periodLabel}</span></div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="k">إجمالي السيارات</div><div class="v">${rows.length}</div></div>
      <div class="kpi"><div class="k">تم التسليم</div><div class="v" style="color:#27ae60">${delivered}</div></div>
      <div class="kpi"><div class="k">قيد العمل</div><div class="v" style="color:#d97706">${inProgress}</div></div>
      <div class="kpi"><div class="k">إجمالي قبل الضريبة</div><div class="v">${fmt(totalApproved)}</div></div>
      <div class="kpi"><div class="k">الضريبة ${(vatRate*100).toFixed(0)}%</div><div class="v" style="color:#8b5cf6">${fmt(totalVat)}</div></div>
      <div class="kpi"><div class="k">الإجمالي شامل الضريبة</div><div class="v" style="color:#d97706">${fmt(totalWithVat)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          ${active.map(headerCell).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0
          ? `<tr><td colspan="${active.length + 1}" style="padding:24px;color:#888">لا توجد بيانات</td></tr>`
          : rows.map((r, i) => `<tr>
                <td class="idx">${i + 1}</td>
                ${active.map((k) => renderCell(k, r)).join("")}
              </tr>`).join("")}
      </tbody>
    </table>

    <div class="totals">
      <div class="item"><div class="l">إجمالي المُقدَّر</div><div class="v">${fmt(totalEstimated)}</div></div>
      <div class="item"><div class="l">قبل الضريبة</div><div class="v">${fmt(totalApproved)}</div></div>
      <div class="item"><div class="l">الضريبة ${(vatRate*100).toFixed(0)}%</div><div class="v" style="color:#fde68a">${fmt(totalVat)}</div></div>
      <div class="item"><div class="l">شامل الضريبة</div><div class="v" style="color:#fbbf24">${fmt(totalWithVat)}</div></div>
      <div class="item"><div class="l">إجمالي المدفوع</div><div class="v" style="color:#86efac">${fmt(totalPaid)}</div></div>
    </div>

    <div class="stamp-area">
      <div class="signature-box">
        <div>المدير المسؤول / Manager</div>
        <div class="line">${s.responsibleName ?? ""}</div>
      </div>
      ${s.stampUrl ? `<img class="stamp-img" src="${s.stampUrl}" alt="Company Stamp" />` : `<div class="signature-box"><div>Company Stamp / ختم الشركة</div></div>`}
    </div>

    <div class="footer">
      <span>${s.footerText ?? ""}</span>
      <span>${s.companyName} • ${new Date().toLocaleString("en-GB")}</span>
    </div>
  </div>
</body>
</html>`;
}
