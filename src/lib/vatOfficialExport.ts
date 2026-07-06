// طھطµط¯ظٹط± ط¶ط±ظٹط¨ظٹ ط±ط³ظ…ظٹ (PDF + Excel) ظ…طھظˆط§ظپظ‚ ظ…ط¹ ظ…طھط·ظ„ط¨ط§طھ ط¬ظ‡ط§ط² ط§ظ„ط¶ط±ط§ط¦ط¨ ط§ظ„ط¹ظڈظ…ط§ظ†ظٹ (5%).
// ظٹط¬ظ…ظ‘ط¹: VAT ط§ظ„ظ…ط®ط±ط¬ط© (ظ…ط¨ظٹط¹ط§طھ + طھط£ظ…ظٹظ†) + VAT ط§ظ„ظ…ط¯ط®ظ„ط© (ظپظˆط§طھظٹط± ط´ط±ط§ط، ظپط¹ظ„ظٹط©) + ط§ظ„طµط§ظپظٹ.
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
    supabase.from("insurance_invoices" as any).select("invoice_number,issued_at,insurance_company_name,subtotal,vat,total")
      .gte("issued_at", range.from).lte("issued_at", range.to + "T23:59:59"),
    supabase.from("purchase_invoices" as any).select("invoice_number,date,supplier_name,subtotal,vat,total")
      .gte("date", range.from).lte("date", range.to),
    supabase.from("expenses").select("id,voucher_number,date,amount,beneficiary,category_name,meta")
      .is("deleted_at", null).is("archived_at", null).gte("date", range.from).lte("date", range.to),
  ]);

  const rows: VatRow[] = [];
  (sales.data || []).forEach((s: any) => rows.push({
    source: "ظ…ط¨ظٹط¹ط§طھ", doc_number: s.doc_number, date: s.date, who: s.customer_name || "â€”",
    subtotal: Number(s.subtotal || 0), vat: Number(s.tax_total || 0), total: Number(s.total || 0), kind: "output",
  }));
  (insInv.data || []).forEach((i: any) => rows.push({
    source: "طھط£ظ…ظٹظ†", doc_number: i.invoice_number, date: (i.issued_at || "").slice(0, 10),
    who: i.insurance_company_name || "â€”", subtotal: Number(i.subtotal || 0), vat: Number(i.vat || 0),
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
<title>ط¥ظ‚ط±ط§ط± ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</title>
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
<h1>ط¥ظ‚ط±ط§ط± ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© - ط³ظ„ط·ظ†ط© ط¹ظڈظ…ط§ظ† (5%)</h1>
<div class="meta">ط§ظ„ظپطھط±ط©: ${esc(range.from)} ط¥ظ„ظ‰ ${esc(range.to)} آ· طھط§ط±ظٹط® ط§ظ„طھظ‚ط±ظٹط±: ${new Date().toISOString().slice(0,10)}</div>

<h3>ط§ظ„ظ…ط®ط±ط¬ط§طھ (ظ…ط¨ظٹط¹ط§طھ + طھط£ظ…ظٹظ†)</h3>
<table><thead><tr><th>ط§ظ„ظپط¦ط©</th><th>ط§ظ„ط±ظ‚ظ…</th><th>ط§ظ„طھط§ط±ظٹط®</th><th>ط§ظ„ط¬ظ‡ط©</th><th>ط§ظ„طµط§ظپظٹ</th><th>VAT</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th></tr></thead><tbody>
${data.rows.filter(r=>r.kind==="output").map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.doc_number)}</td><td>${esc(r.date)}</td><td>${esc(r.who)}</td><td>${formatMoney(r.subtotal)}</td><td>${formatMoney(r.vat)}</td><td>${formatMoney(r.total)}</td></tr>`).join("")}
<tr class="total-row"><td colspan="4">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط®ط±ط¬ط§طھ</td><td>${formatMoney(data.outputBase)}</td><td>${formatMoney(data.outputVat)}</td><td>${formatMoney(data.outputBase+data.outputVat)}</td></tr>
</tbody></table>

<h3>ط§ظ„ظ…ط¯ط®ظ„ط§طھ (ظ…ط´طھط±ظٹط§طھ)</h3>
<table><thead><tr><th>ط§ظ„ظپط¦ط©</th><th>ط§ظ„ط±ظ‚ظ…</th><th>ط§ظ„طھط§ط±ظٹط®</th><th>ط§ظ„ظ…ظˆط±ط¯</th><th>ط§ظ„طµط§ظپظٹ</th><th>VAT</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th></tr></thead><tbody>
${data.rows.filter(r=>r.kind==="input").map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.doc_number)}</td><td>${esc(r.date)}</td><td>${esc(r.who)}</td><td>${formatMoney(r.subtotal)}</td><td>${formatMoney(r.vat)}</td><td>${formatMoney(r.total)}</td></tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:#999">ظ„ط§ طھظˆط¬ط¯ ظپظˆط§طھظٹط± ط´ط±ط§ط، ظپظٹ ط§ظ„ظپطھط±ط©</td></tr>`}
<tr class="total-row"><td colspan="4">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط¯ط®ظ„ط§طھ</td><td>${formatMoney(data.inputBase)}</td><td>${formatMoney(data.inputVat)}</td><td>${formatMoney(data.inputBase+data.inputVat)}</td></tr>
</tbody></table>

<table class="summary">
<tr><td>ط§ظ„ظˆط¹ط§ط، ط§ظ„ظ…ط®ط±ط¬</td><td style="text-align:left">${formatMoney(data.outputBase)}</td></tr>
<tr><td>VAT ط§ظ„ظ…ط®ط±ط¬ط© (ط§ظ„ظ…ط³طھط­ظ‚ط© ط¹ظ„ظٹظƒ)</td><td style="text-align:left">${formatMoney(data.outputVat)}</td></tr>
<tr><td>VAT ط§ظ„ظ…ط¯ط®ظ„ط© (ط§ظ„ظ‚ط§ط¨ظ„ط© ظ„ظ„ط®طµظ…)</td><td style="text-align:left">(${formatMoney(data.inputVat)})</td></tr>
<tr class="net"><td>طµط§ظپظٹ VAT ظ„ظ„ط³ط¯ط§ط¯</td><td style="text-align:left">${formatMoney(data.net)}</td></tr>
</table>
<div style="clear:both"></div>
<p style="margin-top:30px;font-size:10px;color:#666">ظ‡ط°ط§ ط§ظ„طھظ‚ط±ظٹط± ظ…ظڈظˆظ„ظ‘ط¯ ط¢ظ„ظٹط§ظ‹ ظ…ظ† ط§ظ„ظ†ط¸ط§ظ… ظ„ظ„ط£ط؛ط±ط§ط¶ ط§ظ„ظ…ط­ط§ط³ط¨ظٹط© ظˆط§ظ„طھظ‚ط¯ظٹظ… ظ„ط¬ظ‡ط§ط² ط§ظ„ط¶ط±ط§ط¦ط¨.</p>
</div></body></html>`;
  await generatePdfFromHtml({
    htmlContent: buildHtmlWithPageMarginStyle(html),
    fileName: `VAT-${range.from}_to_${range.to}`,
    download: true,
  });
}
