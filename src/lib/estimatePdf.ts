import { formatOMR } from "@/lib/money";
import {
  ESTIMATE_CATEGORY_LABEL,
  ESTIMATE_TYPE_LABEL,
  type UnifiedEstimate,
} from "@/lib/unifiedEstimates";

function esc(value: unknown) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { numberingSystem: "latn" });
}

export function buildEstimatePdfHtml(estimate: UnifiedEstimate, lang: "ar" | "en" = "ar") {
  const isAr = lang === "ar";
  const typeLabel = ESTIMATE_TYPE_LABEL[estimate.estimate_type]?.[lang] || estimate.estimate_type;
  const customerName = estimate.customer?.name || "—";
  const vehicle = [estimate.vehicle?.brand || estimate.vehicle?.make, estimate.vehicle?.model, estimate.vehicle?.year].filter(Boolean).join(" ") || "—";
  const plate = estimate.vehicle?.plate_number || "—";
  const vin = estimate.vehicle?.vin || "—";
  const rows = (estimate.items || []).map((item, index) => {
    const desc = isAr
      ? item.description_ar || item.description_en || "—"
      : item.description_en || item.description_ar || "—";
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${esc(ESTIMATE_CATEGORY_LABEL[item.category]?.[lang] || item.category)}</td>
        <td class="desc">${esc(desc)}</td>
        <td>${Number(item.quantity).toFixed(3)}</td>
        <td>${formatOMR(item.unit_price, "")}</td>
        <td>${formatOMR(item.line_subtotal, "")}</td>
        <td>${formatOMR(item.vat_amount, "")}</td>
        <td>${formatOMR(item.line_total, "")}</td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="${lang}" dir="${isAr ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8" />
  <title>${esc(typeLabel)} ${esc(estimate.estimate_number)}</title>
  <style>
    @page { size: A4; margin: 12mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Tahoma, sans-serif; color: #10213b; font-size: 11px; }
    .page { min-height: 269mm; display: flex; flex-direction: column; gap: 8px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b2341; padding-bottom: 8px; }
    .brand { text-align: ${isAr ? "right" : "left"}; line-height: 1.5; }
    .titleBox { background: #0b2341; color: white; padding: 12px 18px; border-radius: 4px; min-width: 170px; text-align: center; }
    .titleBox .type { font-size: 14px; font-weight: bold; }
    .titleBox .no { font-size: 22px; font-weight: 800; letter-spacing: 1px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .box { border: 1px solid #ccd6e3; border-radius: 6px; padding: 8px; }
    .box h3 { margin: 0 0 6px; font-size: 12px; color: #0b4a8f; }
    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 4px; margin: 3px 0; }
    [dir="rtl"] .kv { grid-template-columns: 1fr 110px; }
    .label { color: #64748b; }
    .value { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; page-break-inside: auto; }
    th { background: #0b2341; color: white; padding: 7px 5px; font-size: 10px; }
    td { border-bottom: 1px solid #d9e2ec; padding: 7px 5px; text-align: center; vertical-align: top; }
    td.desc { text-align: ${isAr ? "right" : "left"}; }
    tr { page-break-inside: avoid; }
    .totals { margin-top: 8px; margin-inline-start: auto; width: 255px; border: 1px solid #ccd6e3; border-radius: 6px; overflow: hidden; }
    .totals div { display: flex; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid #e5edf5; }
    .totals div:last-child { background: #0b2341; color: white; font-weight: 800; font-size: 14px; border-bottom: 0; }
    .terms { white-space: pre-wrap; line-height: 1.6; }
    .signature { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding-top: 12px; }
    .sigBox { border-top: 1px solid #94a3b8; min-height: 32px; padding-top: 6px; color: #475569; }
    .footer { border-top: 1px solid #d4af37; padding-top: 6px; color: #64748b; text-align: center; font-size: 10px; }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div class="titleBox">
        <div class="type">${esc(typeLabel)}</div>
        <div class="no">${esc(estimate.estimate_number)}</div>
      </div>
      <div class="brand">
        <strong>Al Wafa Integrated Business Company LLC</strong><br />
        TEMO Auto ERP<br />
        Muscat, Sultanate of Oman
      </div>
    </section>

    <section class="grid">
      <div class="box">
        <h3>${isAr ? "بيانات العميل" : "Customer"}</h3>
        <div class="kv"><span class="label">${isAr ? "العميل" : "Customer"}</span><span class="value">${esc(customerName)}</span></div>
        <div class="kv"><span class="label">${isAr ? "الهاتف" : "Phone"}</span><span class="value">${esc(estimate.customer?.phone)}</span></div>
        <div class="kv"><span class="label">${isAr ? "كود العميل" : "Code"}</span><span class="value">${esc(estimate.customer?.customer_code)}</span></div>
      </div>
      <div class="box">
        <h3>${isAr ? "بيانات التقدير" : "Estimate"}</h3>
        <div class="kv"><span class="label">${isAr ? "التاريخ" : "Date"}</span><span class="value">${fmtDate(estimate.estimate_date)}</span></div>
        <div class="kv"><span class="label">${isAr ? "الصلاحية" : "Valid until"}</span><span class="value">${fmtDate(estimate.valid_until)}</span></div>
        <div class="kv"><span class="label">${isAr ? "الحالة" : "Status"}</span><span class="value">${esc(estimate.status)}</span></div>
      </div>
      <div class="box">
        <h3>${isAr ? "بيانات المركبة" : "Vehicle"}</h3>
        <div class="kv"><span class="label">${isAr ? "المركبة" : "Vehicle"}</span><span class="value">${esc(vehicle)}</span></div>
        <div class="kv"><span class="label">${isAr ? "اللوحة" : "Plate"}</span><span class="value">${esc(plate)}</span></div>
        <div class="kv"><span class="label">VIN</span><span class="value">${esc(vin)}</span></div>
      </div>
      <div class="box">
        <h3>${isAr ? "بيانات مرتبطة" : "References"}</h3>
        <div class="kv"><span class="label">${isAr ? "المطالبة" : "Claim"}</span><span class="value">${esc(estimate.claim?.claim_number)}</span></div>
        <div class="kv"><span class="label">${isAr ? "شركة التأمين" : "Insurance"}</span><span class="value">${esc(estimate.claim?.insurance_company)}</span></div>
        <div class="kv"><span class="label">${isAr ? "أمر العمل" : "Work order"}</span><span class="value">${esc(estimate.work_order?.order_number)}</span></div>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>#</th><th>${isAr ? "الفئة" : "Category"}</th><th>${isAr ? "الوصف" : "Description"}</th>
          <th>${isAr ? "الكمية" : "Qty"}</th><th>${isAr ? "السعر" : "Rate"}</th>
          <th>${isAr ? "قبل الضريبة" : "Subtotal"}</th><th>VAT 5%</th><th>${isAr ? "الإجمالي" : "Total"}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="8">${isAr ? "لا توجد بنود" : "No items"}</td></tr>`}</tbody>
    </table>

    <section class="totals">
      <div><span>${isAr ? "المجموع قبل الضريبة" : "Subtotal before VAT"}</span><strong>${formatOMR(estimate.subtotal)}</strong></div>
      <div><span>VAT ${Number(estimate.vat_rate).toFixed(2)}%</span><strong>${formatOMR(estimate.vat_amount)}</strong></div>
      <div><span>${isAr ? "الإجمالي" : "Total"}</span><strong>${formatOMR(estimate.total)}</strong></div>
    </section>

    ${estimate.terms ? `<section class="box terms"><h3>${isAr ? "الشروط" : "Terms"}</h3>${esc(estimate.terms)}</section>` : ""}
    ${estimate.notes ? `<section class="box terms"><h3>${isAr ? "ملاحظات" : "Notes"}</h3>${esc(estimate.notes)}</section>` : ""}

    <section class="signature">
      <div class="sigBox">${isAr ? "توقيع العميل" : "Customer signature"}</div>
      <div class="sigBox">${isAr ? "اعتماد الورشة" : "Workshop approval"}</div>
    </section>
    <footer class="footer">Al Wafa Integrated Business Company LLC • ${new Date().getFullYear()} • ${esc(estimate.estimate_number)}</footer>
  </main>
</body>
</html>`;
}
