import { escapeHtml, sanitizePdfHtml, PDF_HTML_SANDBOX } from "@/lib/safeHtml";
import { summarizeSettlements, type SettlementReportRow } from "./insuranceSettlementReport";

export const SETTLEMENT_COLUMNS = ["invoiceNumber", "invoiceDate", "claimNumber", "company", "plate", "vehicle",
  "total", "paid", "recordedDiscount", "verifiedDiscount", "difference", "remaining", "discountPercent",
  "settlementDates", "paymentNumbers", "reasons", "approvers", "status"] as const;
export type SettlementColumn = typeof SETTLEMENT_COLUMNS[number];
export const DEFAULT_SETTLEMENT_COLUMNS: SettlementColumn[] = ["invoiceNumber", "claimNumber", "company", "plate",
  "total", "paid", "recordedDiscount", "remaining", "settlementDates", "reasons", "status"];
type Translate = (key: string) => string;
export const settlementNumericColumns = new Set<SettlementColumn>(["total", "paid", "recordedDiscount", "verifiedDiscount", "difference", "remaining", "discountPercent"]);
export function settlementCell(row: SettlementReportRow, key: SettlementColumn, t: Translate): string | number {
  if (key === "status") return row.issues.length ? row.issues.map(i => t(`insuranceSettlements.${i}`)).join(" / ") : t("insuranceSettlements.verified");
  if (key === "settlementDates") return row.settlementDates.join(" / ");
  return row[key];
}
export function settlementExportMatrix(rows: SettlementReportRow[], columns: SettlementColumn[], t: Translate) {
  if (!columns.length) throw new Error("SETTLEMENT_COLUMNS_REQUIRED");
  const sumKeys = new Set<SettlementColumn>(["total", "paid", "recordedDiscount", "verifiedDiscount", "difference", "remaining"]);
  return [columns.map(k => t(`insuranceSettlements.fields.${k}`)),
    ...rows.map(row => columns.map(k => settlementCell(row, k, t))),
    columns.map((k, index) => sumKeys.has(k)
      ? Math.round(rows.reduce((n, row) => n + Number(row[k]), 0) * 1000) / 1000
      : index === 0 ? t("insuranceSettlements.totals") : "")];
}
export async function exportSettlementXlsx(rows: SettlementReportRow[], columns: SettlementColumn[], t: Translate, rtl: boolean, stillCurrent = () => true) {
  const XLSX = await import("xlsx");
  if (!stillCurrent()) throw new Error("SETTLEMENT_EXPORT_SCOPE_CHANGED");
  const sheet = XLSX.utils.aoa_to_sheet(settlementExportMatrix(rows, columns, t));
  columns.forEach((k, c) => {
    if (settlementNumericColumns.has(k)) for (let r = 1; r <= rows.length + 1; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === "n") cell.z = "0.000";
    }
  });
  sheet["!cols"] = columns.map(k => ({ wch: ["company", "vehicle", "reasons", "status", "approvers"].includes(k) ? 32 : 22 }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }) };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Settlements");
  book.Workbook = { Views: [{ RTL: rtl }] };
  XLSX.writeFile(book, `insurance-settlement-discounts-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
export function settlementReportHtml(rows: SettlementReportRow[], columns: SettlementColumn[], t: Translate, rtl: boolean, filterLabel: string) {
  const e = escapeHtml;
  const summary = summarizeSettlements(rows);
  const matrix = settlementExportMatrix(rows, columns, t);
  const [head, ...body] = matrix;
  const heading = head.map(c => `<th>${e(c)}</th>`).join("");
  const perPage = columns.length > 12 ? 10 : 14;
  const data = body.slice(0, -1);
  const total = body[body.length - 1];
  const pageCount = Math.max(1, Math.ceil(data.length / perPage));
  // Use the established .page contract. The shared PDF pipeline zeroes @page
  // margins and applies the user's configured margins to .page containers.
  const pages = Array.from({ length: pageCount }, (_, page) => {
    const pageRows = data.slice(page * perPage, (page + 1) * perPage);
    const last = page === pageCount - 1;
    const tableRows = [...pageRows, ...(last ? [total] : [])].map((row, index) => `<tr${last && index === pageRows.length ? ' class="report-totals"' : ""}>${row.map(value =>
      `<td>${e(typeof value === "number" ? value.toFixed(3) : value || "—")}</td>`).join("")}</tr>`).join("");
    return `<section class="page"><h1>${e(t("insuranceSettlements.title"))}</h1><p>${e(t("insuranceSettlements.internal"))} · ${e(filterLabel)}</p>
      <p>${e(t("insuranceSettlements.scope"))}</p>
      <p>${e(t("insuranceSettlements.invoices"))}: ${summary.invoices} · ${e(t("insuranceSettlements.recordedDiscount"))}: ${summary.recordedDiscount.toFixed(3)} OMR · ${e(t("insuranceSettlements.verifiedDiscount"))}: ${summary.verifiedDiscount.toFixed(3)} OMR</p>
      ${summary.review ? `<p>${e(t("insuranceSettlements.reviewNote"))} (${summary.review})</p>` : ""}
      <table><thead><tr>${heading}</tr></thead><tbody>${tableRows}</tbody></table>
      <footer>${e(t("insuranceSettlements.subtitle"))} · <bdi dir="ltr" data-settlement-page-number>${page + 1} / ${pageCount}</bdi></footer></section>`;
  }).join("");
  return sanitizePdfHtml(`<!doctype html><html lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">
    <style>
    @page{size:A4 landscape;margin:0}body{font-family:Arial,Tahoma,sans-serif;color:#17212b;margin:0;font-size:12px}
    .page{width:297mm;min-height:210mm;padding:10mm;box-sizing:border-box;break-after:page}.page:last-of-type{break-after:auto}
    h1{font-size:20px;margin:0 0 8px}p{line-height:1.7;margin:8px 0}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}
    th,td{border:1px solid #ccd1d7;padding:5px;overflow-wrap:anywhere;text-align:start;vertical-align:top}th,.report-totals{background:#f1f3f5;font-weight:700}
    thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:12px}</style></head><body>
    ${pages}</body></html>`);
}

/** Measure ATTACHED rows at the final width/margins. Fixed row-count chunks cannot
 * predict wrapping of insurer names, references and settlement reasons. Keep this
 * preparation local to this report: no global invoice/PDF behavior is changed. */
export function paginateSettlementDocument(doc: Document): HTMLElement[] {
  const originals = [...doc.querySelectorAll<HTMLElement>(".page")];
  if (!originals.length) throw new Error("SETTLEMENT_PDF_PAGE_REQUIRED");
  const template = originals[0].cloneNode(true) as HTMLElement;
  const rows = originals.flatMap(page => [...page.querySelectorAll<HTMLTableRowElement>("tbody tr")].map(row => row.cloneNode(true) as HTMLTableRowElement));
  template.querySelector("tbody")!.replaceChildren();
  doc.body.replaceChildren();
  const pages: HTMLElement[] = [];
  const create = () => {
    const page = template.cloneNode(true) as HTMLElement;
    Object.assign(page.style, { width: "1123px", height: "794px", minHeight: "794px", maxHeight: "794px", boxSizing: "border-box" });
    const counter = page.querySelector("[data-settlement-page-number]");
    if (counter) counter.textContent = "9999 / 9999"; // reserve final counter width
    doc.body.appendChild(page); // must precede every layout measurement
    pages.push(page);
    return page;
  };
  const fits = (page: HTMLElement) => {
    const window = doc.defaultView;
    if (!window || !page.isConnected) throw new Error("SETTLEMENT_PDF_MEASUREMENT_UNAVAILABLE");
    const bounds = page.getBoundingClientRect();
    const footer = page.querySelector("footer")!.getBoundingClientRect();
    const padding = parseFloat(window.getComputedStyle(page).paddingBottom) || 0;
    return footer.bottom <= bounds.bottom - padding + 1
      && page.scrollWidth <= page.clientWidth + 1 && page.scrollHeight <= page.clientHeight + 1;
  };
  let current = create();
  for (const row of rows) {
    let body = current.querySelector("tbody")!;
    body.appendChild(row);
    if (fits(current)) continue;
    row.remove();
    if (!body.children.length) throw new Error("SETTLEMENT_PDF_ROW_TOO_TALL");
    current = create(); body = current.querySelector("tbody")!; body.appendChild(row);
    if (!fits(current)) throw new Error("SETTLEMENT_PDF_ROW_TOO_TALL");
  }
  pages.forEach((page, index) => { const counter = page.querySelector("[data-settlement-page-number]"); if (counter) counter.textContent = `${index + 1} / ${pages.length}`; });
  // The existing preview/export renderer preserves a pre-paginated document.
  // Both consume the SAME prepared HTML, including exact page breaks/counters.
  doc.documentElement.setAttribute("data-pdf-paginated", "1");
  return pages;
}

export async function prepareSettlementReportHtml(html: string, stillCurrent = () => true): Promise<string> {
  const [{ buildHtmlWithPageMarginStyle }, { waitForPdfAssets }] = await Promise.all([
    import("@/lib/pdfLayoutSettings"), import("@/lib/pdfDocumentRenderer"),
  ]);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", PDF_HTML_SANDBOX);
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1123px", height: "794px", border: "0" });
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("SETTLEMENT_PDF_DOCUMENT_UNAVAILABLE");
    doc.open(); doc.write(sanitizePdfHtml(buildHtmlWithPageMarginStyle(html, "landscape"))); doc.close();
    await waitForPdfAssets(doc);
    if (!stillCurrent()) throw new Error("SETTLEMENT_EXPORT_SCOPE_CHANGED");
    paginateSettlementDocument(doc);
    return sanitizePdfHtml(`<!doctype html>${doc.documentElement.outerHTML}`);
  } finally { frame.remove(); }
}
