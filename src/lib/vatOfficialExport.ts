// تصدير ضريبي رسمي (PDF + Excel) متوافق مع متطلبات جهاز الضرائب العُماني (5%).
// يجمّع: VAT المخرجة (مبيعات + تأمين) + VAT المدخلة (فواتير شراء فعلية) + الصافي.
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/pdfGenerator";
import * as XLSX from "xlsx";
import { calculateVatExclusive, roundMoney } from "@/lib/money";
import { buildHtmlWithPageMarginStyle } from "@/lib/pdfLayoutSettings";
import { generatePdfFromHtml } from "@/lib/htmlToPdf";

export interface VatExportRange { from: string; to: string }

export interface VatRow {
  source: string;
  doc_number: string;
  date: string;
  who: string;
  subtotal: number;
  vat: number;
  total: number;
  kind: "output" | "input";
}

export async function fetchOfficialVatData(range: VatExportRange) {
  const [sales, insInv, purchases, expenses] = await Promise.all([
    supabase.from("sales_documents").select("doc_type,doc_number,date,customer_name,subtotal,tax_total,total")
      .eq("doc_type", "invoice").gte("date", range.from).lte("date", range.to),
    supabase.from("insurance_invoices" as any).select("invoice_number,invoice_date,issued_at,insurance_company_name,subtotal,vat,total")
      .gte("invoice_date", range.from).lte("invoice_date", range.to),
    supabase.from("purchase_invoices" as any).select("invoice_number,date,supplier_name,subtotal,vat,total")
      .gte("date", range.from).lte("date", range.to),
    supabase.from("expenses").select("id,voucher_number,date,amount,beneficiary,category_name,meta")
      .is("deleted_at", null).is("archived_at", null).gte("date", range.from).lte("date", range.to),
  ]);

  const rows: VatRow[] = [];
  (sales.data || []).forEach((s: any) => rows.push({
    source: "مبيعات", doc_number: s.doc_number, date: s.date, who: s.customer_name || "—",
    subtotal: Number(s.subtotal || 0), vat: Number(s.tax_total || 0), total: Number(s.total || 0), kind: "output",
  }));
  (insInv.data || []).forEach((i: any) => rows.push({
    source: "تأمين", doc_number: i.invoice_number, date: (i.invoice_date || i.issued_at || "").slice(0, 10),
    who: i.insurance_company_name || "—", subtotal: Number(i.subtotal || 0), vat: Number(i.vat || 0),
    total: Number(i.total || 0), kind: "output",
  }));
  (purchases.data || []).forEach((p: any) => rows.push({
    source: "Purchase", doc_number: p.invoice_number, date: p.date, who: p.supplier_name || "—",
    subtotal: roundMoney(p.subtotal || 0), vat: roundMoney(p.vat || 0), total: roundMoney(p.total || 0), kind: "input",
  }));
  (expenses.data || []).forEach((e: any) => {
    const breakdown = calculateVatExclusive(e.amount || 0);
    rows.push({
      source: "Expense",
      doc_number: e.meta?.supplierInvoiceNumber || e.voucher_number || e.id,
      date: e.date,
      who: e.beneficiary || e.category_name || "—",
      subtotal: breakdown.subtotalBeforeVat,
      vat: breakdown.vatAmount,
      total: breakdown.totalIncludingVat,
      kind: "input",
    });
  });

  const outputVat = rows.filter(r => r.kind === "output").reduce((s, r) => s + r.vat, 0);
  const inputVat = rows.filter(r => r.kind === "input").reduce((s, r) => s + r.vat, 0);
  const outputBase = rows.filter(r => r.kind === "output").reduce((s, r) => s + r.subtotal, 0);
  const inputBase = rows.filter(r => r.kind === "input").reduce((s, r) => s + r.subtotal, 0);
  return { rows, outputVat, inputVat, outputBase, inputBase, net: outputVat - inputVat };
}

export async function exportVatExcel(range: VatExportRange) {
  const data = await fetchOfficialVatData(range);
  const rows = data.rows.map((r) => ({
    Type: r.kind === "output" ? "Output VAT" : "Input VAT",
    Category: r.source,
    "Invoice Number": r.doc_number,
    Date: r.date,
    "Customer / Supplier": r.who,
    "Subtotal Before VAT": roundMoney(r.subtotal),
    "VAT 5%": roundMoney(r.vat),
    "Total Including VAT": roundMoney(r.total),
  }));
  rows.push({} as any);
  rows.push({ Type: "Summary", Category: "Output VAT", "Total Including VAT": roundMoney(data.outputVat) } as any);
  rows.push({ Type: "Summary", Category: "Input VAT", "Total Including VAT": roundMoney(data.inputVat) } as any);
  rows.push({ Type: "Summary", Category: "Net VAT Payable", "Total Including VAT": roundMoney(data.net) } as any);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "VAT Report");
  XLSX.writeFile(wb, `VAT_Report_${range.from}_to_${range.to}.xlsx`);
}

export async function exportVatPdf(range: VatExportRange) {
  const data = await fetchOfficialVatData(range);
  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>إقرار ضريبة القيمة المضافة</title>
<style>
  @page{size:A4;margin:0}
  *{box-sizing:border-box}
  body{font-family:'Tajawal','Noto Naskh Arabic',Arial,sans-serif;direction:rtl;color:#111;margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;min-height:297mm;margin:0 auto;padding:12mm 10mm;background:#fff}
  h1{text-align:center;margin:0 0 4px;font-size:18px}
  .meta{text-align:center;color:#666;font-size:11px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:10px;margin-top:10px;page-break-inside:auto}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  tr,td,th{page-break-inside:avoid;break-inside:avoid}
  th,td{border:1px solid #999;padding:4px 6px;text-align:right}
  th{background:#f0f0f0}
  .total-row td{background:#fafafa;font-weight:700}
  .summary{margin-top:18px;width:50%;float:left;font-size:12px}
  .summary td{padding:6px}
  .net{background:#fff7e6;font-weight:700;font-size:14px}
  @media print{button{display:none}}
</style></head><body><div class="page">
<h1>إقرار ضريبة القيمة المضافة - سلطنة عُمان (5%)</h1>
<div class="meta">الفترة: ${esc(range.from)} إلى ${esc(range.to)} · تاريخ التقرير: ${new Date().toISOString().slice(0,10)}</div>

<h3>المخرجات (مبيعات + تأمين)</h3>
<table><thead><tr><th>الفئة</th><th>الرقم</th><th>التاريخ</th><th>الجهة</th><th>الصافي</th><th>VAT</th><th>الإجمالي</th></tr></thead><tbody>
${data.rows.filter(r=>r.kind==="output").map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.doc_number)}</td><td>${esc(r.date)}</td><td>${esc(r.who)}</td><td>${formatMoney(r.subtotal)}</td><td>${formatMoney(r.vat)}</td><td>${formatMoney(r.total)}</td></tr>`).join("")}
<tr class="total-row"><td colspan="4">إجمالي المخرجات</td><td>${formatMoney(data.outputBase)}</td><td>${formatMoney(data.outputVat)}</td><td>${formatMoney(data.outputBase+data.outputVat)}</td></tr>
</tbody></table>

<h3>المدخلات (مشتريات)</h3>
<table><thead><tr><th>الفئة</th><th>الرقم</th><th>التاريخ</th><th>المورد</th><th>الصافي</th><th>VAT</th><th>الإجمالي</th></tr></thead><tbody>
${data.rows.filter(r=>r.kind==="input").map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.doc_number)}</td><td>${esc(r.date)}</td><td>${esc(r.who)}</td><td>${formatMoney(r.subtotal)}</td><td>${formatMoney(r.vat)}</td><td>${formatMoney(r.total)}</td></tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:#999">لا توجد فواتير شراء في الفترة</td></tr>`}
<tr class="total-row"><td colspan="4">إجمالي المدخلات</td><td>${formatMoney(data.inputBase)}</td><td>${formatMoney(data.inputVat)}</td><td>${formatMoney(data.inputBase+data.inputVat)}</td></tr>
</tbody></table>

<table class="summary">
<tr><td>الوعاء المخرج</td><td style="text-align:left">${formatMoney(data.outputBase)}</td></tr>
<tr><td>VAT المخرجة (المستحقة عليك)</td><td style="text-align:left">${formatMoney(data.outputVat)}</td></tr>
<tr><td>VAT المدخلة (القابلة للخصم)</td><td style="text-align:left">(${formatMoney(data.inputVat)})</td></tr>
<tr class="net"><td>صافي VAT للسداد</td><td style="text-align:left">${formatMoney(data.net)}</td></tr>
</table>
<div style="clear:both"></div>
<p style="margin-top:30px;font-size:10px;color:#666">هذا التقرير مُولّد آلياً من النظام للأغراض المحاسبية والتقديم لجهاز الضرائب.</p>
</div></body></html>`;
  await generatePdfFromHtml({
    htmlContent: buildHtmlWithPageMarginStyle(html),
    fileName: `VAT-${range.from}_to_${range.to}`,
    download: true,
  });
}
