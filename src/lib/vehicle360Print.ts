import { getTemplateSettings } from "@/lib/pdfGenerator";
import type { Vehicle } from "@/lib/vehiclesStore";
import type { Vehicle360Snapshot } from "@/lib/vehicle360";
import { escapeHtml } from "@/lib/pdf-v2/pdfFormatters";

export type VehicleFileReportType = "client" | "insurance" | "internal";
export type VehicleFileSection = "vehicle" | "customer" | "workOrders" | "claims" | "estimates" | "invoices" | "payments" | "expenses" | "media" | "signatures" | "communications" | "timeline" | "delivery" | "notes";
export interface VehicleFilePrintOptions {
  reportType: VehicleFileReportType;
  sections: VehicleFileSection[];
  showFinancials: boolean;
  showInternalExpenses: boolean;
  showProfitability: boolean;
  showInternalNotes: boolean;
  generatedBy?: string;
  english?: boolean;
}

const money = (value: unknown) => `OMR ${Number(value || 0).toFixed(3)}`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-GB") : "—";
const has = (o: VehicleFilePrintOptions, section: VehicleFileSection) => o.sections.includes(section);
const cells = (values: unknown[]) => values.map((value) => `<td>${escapeHtml(value ?? "—")}</td>`).join("");
const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r)}</tr>`).join("") || `<tr><td colspan="${headers.length}">—</td></tr>`}</tbody></table>`;
const section = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

export function getVehicle360FileHtml(vehicle: Vehicle, data: Vehicle360Snapshot, options: VehicleFilePrintOptions) {
  const s = getTemplateSettings();
  const en = !!options.english;
  const t = (ar: string, english: string) => en ? english : ar;
  const internal = options.reportType === "internal";
  const insurance = options.reportType === "insurance";
  const allowExpenses = internal && options.showInternalExpenses;
  const allowProfit = internal && options.showProfitability;
  const allowFinancial = options.showFinancials;
  const latestImage = data.media.find((row) => row.media_type !== "document" && row.public_url)?.public_url || vehicle.coverImageUrl || vehicle.thumbnailUrl || "";
  const generatedAt = new Date().toLocaleString("en-GB");
  const content: string[] = [];

  if (has(options, "vehicle")) content.push(section(t("بيانات المركبة", "Vehicle Details"), table(
    [t("اللوحة", "Plate"), "VIN", t("الماركة/الموديل", "Make/Model"), t("السنة", "Year"), t("اللون", "Color")],
    [[vehicle.plate, vehicle.vin, vehicle.type, vehicle.year, vehicle.color]],
  )));
  if (has(options, "customer")) content.push(section(t("بيانات العميل", "Customer Details"), table([t("الاسم", "Name"), t("الهاتف", "Phone")], [[vehicle.owner, vehicle.ownerPhone]])));
  if (has(options, "workOrders")) content.push(section(t("أوامر العمل", "Work Orders"), table(
    [t("الرقم", "Number"), t("التاريخ", "Date"), t("النوع", "Type"), t("الحالة", "Status"), ...(allowFinancial ? [t("قبل الضريبة", "Before VAT")] : [])],
    data.workOrders.map((r) => [r.order_number, date(r.entry_date || r.created_at), r.work_order_type, r.status, ...(allowFinancial ? [money(r.subtotal || r.final_total)] : [])]),
  )));
  if (has(options, "claims")) content.push(section(t("المطالبات", "Claims"), table(
    [t("رقم المطالبة", "Claim"), t("شركة التأمين", "Insurer"), t("الحالة", "Status"), t("المعتمد", "Approved"), "LPO"],
    data.claims.map((r) => [r.claim_number, r.insurance_company, r.status, allowFinancial ? money(r.approved_amount || r.lpo_amount) : "—", r.lpo_number]),
  )));
  if (has(options, "estimates")) content.push(section(t("التقديرات والموافقات", "Estimates & Approvals"), table(
    [t("الرقم", "Number"), t("التاريخ", "Date"), t("النوع", "Type"), t("الحالة", "Status"), t("الإجمالي", "Total")],
    data.estimates.map((r) => [r.estimate_number, date(r.estimate_date || r.created_at), r.estimate_type || r.estimation_type, r.status, allowFinancial ? money(r.total || r.lump_sum_amount) : "—"]),
  )));
  if (allowFinancial && has(options, "invoices")) content.push(section(t("الفواتير", "Invoices"), table(
    [t("النوع", "Type"), t("الرقم", "Number"), t("التاريخ", "Date"), t("قبل الضريبة", "Before VAT"), t("الضريبة", "VAT"), t("الإجمالي", "Total")],
    [...data.cashInvoices.map((r) => [t("كاش", "Cash"), r.doc_number, date(r.issued_at || r.date), money(r.subtotal), money(r.tax_total), money(r.total)]), ...data.insuranceInvoices.map((r) => [t("تأمين", "Insurance"), r.invoice_number, date(r.issued_at || r.invoice_date), money(r.subtotal), money(r.vat), money(r.total)])],
  )));
  if (allowFinancial && has(options, "payments")) content.push(section(t("سندات القبض والدفعات", "Receipts & Payments"), table(
    [t("النوع", "Type"), t("الرقم", "Number"), t("التاريخ", "Date"), t("المبلغ", "Amount"), t("الحالة", "Status")],
    [...data.cashPayments.map((r) => [t("كاش", "Cash"), r.payment_number, date(r.date), money(r.amount), t("محصل", "Collected")]), ...data.insurancePayments.map((r) => [t("تأمين", "Insurance"), r.payment_number, date(r.payment_date), money(r.amount), r.status])],
  )));
  if (allowExpenses && has(options, "expenses")) content.push(section(t("المصروفات الداخلية", "Internal Expenses"), table([t("السند", "Voucher"), t("التاريخ", "Date"), t("التصنيف", "Category"), t("قبل الضريبة", "Before VAT")], data.expenses.map((r) => [r.voucher_number, date(r.date), r.category_name || r.expense_type, money(r.subtotal ?? Number(r.total || r.amount || 0) - Number(r.vat_amount || 0))]))));
  if (allowProfit) content.push(section(t("ملخص الربحية", "Profitability Summary"), table([t("الإيراد قبل الضريبة", "Revenue before VAT"), t("التكلفة قبل الضريبة", "Cost before VAT"), t("الربح/الخسارة", "Profit/Loss"), t("الهامش", "Margin")], [[money(data.financial.billedBeforeVat), money(data.financial.directCostBeforeVat), money(data.financial.actualProfit), `${data.financial.profitMarginPct.toFixed(2)}%`]])));
  if (has(options, "media")) content.push(section(t("الصور والمستندات", "Photos & Documents"), `<div class="media">${data.media.map((r) => r.public_url && r.media_type !== "document" ? `<figure><img src="${escapeHtml(r.public_url)}"/><figcaption>${escapeHtml(r.caption || r.category || "")}</figcaption></figure>` : `<div class="document">${escapeHtml(r.file_name || r.caption || r.category || "Document")}</div>`).join("") || "—"}</div>`));
  if (has(options, "signatures")) content.push(section(t("التوقيعات", "Signatures"), `<div class="signatures">${data.signatures.map((r) => `<div><b>${escapeHtml(r.signature_role || "Signature")}</b>${r.signature_data_url ? `<img src="${escapeHtml(r.signature_data_url)}"/>` : ""}<small>${escapeHtml(r.signer_name || r.recipient_name || "—")} · ${escapeHtml(date(r.signed_at || r.finalized_at || r.created_at))}</small></div>`).join("") || "—"}</div>`));
  if (internal && has(options, "communications")) content.push(section(t("المراسلات", "Communications"), table([t("القناة", "Channel"), t("التاريخ", "Date"), t("الموضوع", "Subject"), t("الحالة", "Status")], data.communications.map((r) => [r.channel || r.message_type, date(r.sent_at || r.created_at), r.subject || r.body || r.message, r.status]))));
  if (has(options, "delivery")) content.push(section(t("سجل التسليم", "Delivery History"), table([t("رقم الإقرار", "Receipt"), t("التاريخ", "Date"), t("المستلم", "Recipient"), t("الحالة", "Status")], data.handovers.map((r) => [r.receipt_number, date(r.delivered_at || r.created_at), r.recipient_name, r.status]))));
  if (has(options, "timeline")) content.push(section(t("السجل الزمني", "Vehicle Timeline"), table([t("التاريخ", "Date"), t("الحدث", "Event"), t("الوصف", "Description"), t("الحالة", "Status")], data.timeline.map((r) => [date(r.occurredAt), en ? r.titleEn : r.titleAr, en ? r.detailEn : r.detailAr, r.status]))));
  if (internal && options.showInternalNotes && has(options, "notes")) content.push(section(t("الملاحظات الإدارية", "Administrative Notes"), `<p>${escapeHtml(vehicle.notes || "—")}</p>`));

  const reportLabel = options.reportType === "client" ? t("ملف العميل", "Client File") : insurance ? t("ملف التأمين", "Insurance File") : t("الملف الإداري الكامل", "Internal Full File");
  return `<!doctype html><html lang="${en ? "en" : "ar"}" dir="${en ? "ltr" : "rtl"}"><head><meta charset="utf-8"><title>${escapeHtml(reportLabel)} - ${escapeHtml(vehicle.plate)}</title><style>
  @page{size:A4;margin:18mm 12mm 17mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Arabic",sans-serif;color:#0b1f3a;font-size:10px;margin:0}.cover{min-height:245mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always}.logo{max-height:26mm;max-width:55mm}.vehicle-image{width:120mm;height:65mm;object-fit:cover;border:1px solid #ccd5e0;border-radius:4mm;margin:8mm 0}.plate{font-size:30px;font-weight:800;border:2px solid #0b315f;padding:4mm 12mm;border-radius:3mm}.meta{margin-top:4mm;line-height:1.8}section{break-inside:auto;margin:0 0 6mm}h2{font-size:14px;background:#082b55;color:#fff;padding:2.5mm 3mm;margin:0 0 2mm}table{width:100%;border-collapse:collapse;break-inside:auto}th,td{border:1px solid #c7d0db;padding:2mm;vertical-align:top}th{background:#edf2f7;font-weight:700}tr{break-inside:avoid}.media{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}.media figure{margin:0;border:1px solid #d5dce5;padding:1.5mm;break-inside:avoid}.media img{width:100%;height:40mm;object-fit:cover}.media figcaption,.document{padding:1.5mm;font-size:8px}.signatures{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}.signatures>div{border:1px solid #ccd5e0;padding:3mm;break-inside:avoid}.signatures img{width:100%;height:25mm;object-fit:contain;display:block}.signatures small{display:block;margin-top:2mm}.footer{position:fixed;bottom:-12mm;left:0;right:0;border-top:1px solid #9eabb9;padding-top:2mm;display:flex;justify-content:space-between;font-size:8px;color:#536274}.page-number:after{content:counter(page)}
  </style></head><body><div class="footer"><span>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.vin || "—")}</span><span>${escapeHtml(generatedAt)} · ${escapeHtml(options.generatedBy || "—")}</span><span>${t("صفحة", "Page")} <span class="page-number"></span></span></div><div class="cover">${s.logoUrl ? `<img class="logo" src="${escapeHtml(s.logoUrl)}"/>` : ""}<h1>${escapeHtml(s.companyName)}</h1><div>${escapeHtml(s.companyNameEn)}</div><h2 style="background:none;color:#0b315f;font-size:24px">${escapeHtml(reportLabel)}<br/>Vehicle File</h2>${latestImage ? `<img class="vehicle-image" src="${escapeHtml(latestImage)}"/>` : ""}<div class="plate">${escapeHtml(vehicle.plate)}</div><div class="meta"><b>VIN:</b> ${escapeHtml(vehicle.vin || "—")}<br/>${escapeHtml(vehicle.type)} · ${escapeHtml(vehicle.year || "—")}<br/>${escapeHtml(vehicle.owner)}<br/>${t("أول دخول", "First entry")}: ${escapeHtml(data.firstVisitAt || "—")} · ${t("آخر إجراء", "Last activity")}: ${escapeHtml(data.timeline[0]?.occurredAt || data.lastVisitAt || "—")}</div></div>${content.join("")}</body></html>`;
}
