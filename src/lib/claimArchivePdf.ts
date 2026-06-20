// Unified Claim Archive PDF — يجمع كل بيانات وصور ومستندات المطالبة في PDF واحد منسّق.
// يستخدم نفس مولّد htmlToPdf الموجود في المشروع. RTL عربي + إنجليزي.

import { generatePdfFromHtml } from "./htmlToPdf";
import { getTemplateSettings } from "./pdfGenerator";
import { toEnglishDigits } from "./numberUtils";

export interface ArchiveSectionFile {
  url: string;
  name: string;
  kind: "image" | "pdf";
  meta?: string;
  createdAt?: string;
}

export interface ClaimArchivePdfData {
  claim: {
    claim_number: string;
    insurance_company: string;
    policy_number?: string | null;
    estimated_amount?: number;
    approved_amount?: number;
    status: string;
    estimation_type?: string;
    incident_date?: string | null;
    estimate_date?: string | null;
    incident_location?: string | null;
    incident_description?: string | null;
    notes?: string | null;
    created_at: string;
    approved_at?: string | null;
    delivered_at?: string | null;
    receiver_name?: string | null;
    receiver_id_number?: string | null;
    customer?: { name?: string | null; phone?: string | null } | null;
    vehicle?: { brand?: string; model?: string; plate_number?: string; year?: number | null } | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_plate?: string | null;
    vehicle_year?: number | null;
    vehicle_color?: string | null;
    vehicle_owner_name?: string | null;
    vehicle_owner_phone?: string | null;
  };
  workOrder?: { order_number?: string; status?: string; description?: string | null; diagnosis?: string | null } | null;
  invoices: { invoice_number: string; total: number; status: string; issued_at: string; pdf_url?: string | null }[];
  payments?: { payment_number: string; amount: number; payment_method: string; payment_date: string; status: string; reference_number?: string | null }[];
  sections: { title: string; titleEn: string; files: ArchiveSectionFile[] }[];
}

const STATUS_AR: Record<string, string> = {
  pending: "قيد المراجعة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};

function fmtMoney(n?: number) {
  if (n == null || isNaN(n as number)) return "—";
  return toEnglishDigits(Number(n).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
}
function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return toEnglishDigits(new Date(s).toLocaleDateString("en-GB")); } catch { return s; }
}
function fmtDateTime(s?: string | null) {
  if (!s) return "—";
  try { return toEnglishDigits(new Date(s).toLocaleString("en-GB")); } catch { return s; }
}
function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** يحاول جلب صورة كـ dataURL لتضمينها في html2canvas (CORS-safe) */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function buildHeader(data: ClaimArchivePdfData, settings: ReturnType<typeof getTemplateSettings>) {
  const { claim } = data;
  const company = settings.companyName || "Alwafa Integrated Services";
  const logo = settings.logoUrl
    ? `<img src="${esc(settings.logoUrl)}" crossorigin="anonymous" style="height:48px;width:auto;object-fit:contain"/>`
    : `<div style="width:48px;height:48px;border-radius:8px;background:#1e3a8a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">A</div>`;
  return `
    <header style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1e3a8a;padding-bottom:10px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        ${logo}
        <div>
          <div style="font-size:14px;font-weight:700;color:#0f172a">${esc(company)}</div>
          <div style="font-size:9px;color:#64748b">${esc(settings.address || "")}</div>
          <div style="font-size:9px;color:#64748b">${esc(settings.phone || "")} ${settings.email ? "· " + esc(settings.email) : ""}</div>
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:18px;font-weight:800;color:#1e3a8a">CLAIM ARCHIVE</div>
        <div style="font-size:11px;color:#0f172a;font-weight:600">أرشيف المطالبة</div>
        <div style="font-family:monospace;font-size:10px;color:#475569;margin-top:2px">#${esc(claim.claim_number)}</div>
      </div>
    </header>
  `;
}

function buildClaimInfo(data: ClaimArchivePdfData) {
  const c = data.claim;
  const customer = c.customer?.name || c.vehicle_owner_name || "—";
  const phone = c.customer?.phone || c.vehicle_owner_phone || "—";
  const vehicle = c.vehicle
    ? `${c.vehicle.brand || ""} ${c.vehicle.model || ""} ${c.vehicle.year || ""}`.trim()
    : `${c.vehicle_make || ""} ${c.vehicle_model || ""} ${c.vehicle_year || ""}`.trim() || "—";
  const plate = c.vehicle?.plate_number || c.vehicle_plate || "—";

  const row = (l: string, v: string) => `
    <tr>
      <td style="padding:5px 8px;background:#f1f5f9;font-weight:700;width:32%;border:1px solid #e2e8f0;font-size:10px">${l}</td>
      <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:10px">${v}</td>
    </tr>`;

  return `
    <section style="margin-bottom:14px">
      <h2 style="font-size:12px;font-weight:700;color:#1e3a8a;border-right:3px solid #1e3a8a;padding-right:6px;margin:0 0 6px 0">بيانات المطالبة • Claim Information</h2>
      <table style="width:100%;border-collapse:collapse">
        ${row("رقم المطالبة / Claim #", `<span style="font-family:monospace">${esc(c.claim_number)}</span>`)}
        ${row("شركة التأمين / Insurance Co.", esc(c.insurance_company))}
        ${row("رقم الوثيقة / Policy #", esc(c.policy_number || "—"))}
        ${row("الحالة / Status", `<strong>${STATUS_AR[c.status] || c.status}</strong>`)}
        ${row("نوع التقدير / Type", c.estimation_type === "upl" ? "UPL (تفصيلي)" : "LUMP SUM (مقطوع)")}
        ${row("العميل / Customer", `${esc(customer)} — <span style="font-family:monospace" dir="ltr">${esc(phone)}</span>`)}
        ${row("المركبة / Vehicle", `${esc(vehicle)} — <span style="font-family:monospace" dir="ltr">${esc(plate)}</span>`)}
        ${row("تاريخ التقدير / Estimate", fmtDate(c.estimate_date || c.incident_date))}
        ${row("موقع الحادث / Location", esc(c.incident_location || "—"))}
        ${row("المبلغ المقدر / Estimated", fmtMoney(c.estimated_amount) + " OMR")}
        ${row("المبلغ المعتمد / Approved", fmtMoney(c.approved_amount) + " OMR")}
        ${row("تاريخ الإنشاء / Created", fmtDateTime(c.created_at))}
        ${c.approved_at ? row("تاريخ الاعتماد / Approved at", fmtDateTime(c.approved_at)) : ""}
        ${c.delivered_at ? row("تاريخ التسليم / Delivered at", fmtDateTime(c.delivered_at)) : ""}
      </table>
      ${c.incident_description ? `
        <div style="margin-top:8px;padding:8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;font-size:10px;line-height:1.6">
          <strong>وصف الحادث:</strong> ${esc(c.incident_description)}
        </div>` : ""}
      ${c.notes ? `
        <div style="margin-top:6px;padding:8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;font-size:10px;line-height:1.6">
          <strong>ملاحظات:</strong> ${esc(c.notes)}
        </div>` : ""}
    </section>
  `;
}

function buildWorkOrder(data: ClaimArchivePdfData) {
  if (!data.workOrder) return "";
  const w = data.workOrder;
  return `
    <section style="margin-bottom:14px">
      <h2 style="font-size:12px;font-weight:700;color:#1e3a8a;border-right:3px solid #1e3a8a;padding-right:6px;margin:0 0 6px 0">أمر العمل • Work Order</h2>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <tr>
          <td style="padding:5px 8px;background:#f1f5f9;font-weight:700;border:1px solid #e2e8f0;width:32%">رقم أمر العمل / WO #</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0"><span style="font-family:monospace">${esc(w.order_number || "—")}</span></td>
        </tr>
        <tr>
          <td style="padding:5px 8px;background:#f1f5f9;font-weight:700;border:1px solid #e2e8f0">الحالة / Status</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0">${esc(w.status || "—")}</td>
        </tr>
        ${w.description ? `<tr><td style="padding:5px 8px;background:#f1f5f9;font-weight:700;border:1px solid #e2e8f0">الوصف</td><td style="padding:5px 8px;border:1px solid #e2e8f0;line-height:1.6">${esc(w.description)}</td></tr>` : ""}
        ${w.diagnosis ? `<tr><td style="padding:5px 8px;background:#f1f5f9;font-weight:700;border:1px solid #e2e8f0">التشخيص</td><td style="padding:5px 8px;border:1px solid #e2e8f0;line-height:1.6">${esc(w.diagnosis)}</td></tr>` : ""}
      </table>
    </section>
  `;
}

function buildInvoices(data: ClaimArchivePdfData) {
  if (!data.invoices.length) return "";
  return `
    <section style="margin-bottom:14px">
      <h2 style="font-size:12px;font-weight:700;color:#1e3a8a;border-right:3px solid #1e3a8a;padding-right:6px;margin:0 0 6px 0">الفواتير الضريبية • Tax Invoices</h2>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead>
          <tr style="background:#1e3a8a;color:#fff">
            <th style="padding:6px;border:1px solid #1e3a8a;width:34%">رقم الفاتورة</th>
            <th style="padding:6px;border:1px solid #1e3a8a">التاريخ</th>
            <th style="padding:6px;border:1px solid #1e3a8a">الإجمالي (OMR)</th>
            <th style="padding:6px;border:1px solid #1e3a8a">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${data.invoices.map((inv) => `
            <tr>
              <td style="padding:5px 8px;border:1px solid #e2e8f0;font-family:monospace">${esc(inv.invoice_number)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0">${fmtDate(inv.issued_at)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:left;font-family:monospace">${fmtMoney(inv.total)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0">${esc(inv.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function buildPayments(data: ClaimArchivePdfData) {
  if (!data.payments?.length) return "";
  return `
    <section style="margin-bottom:14px">
      <h2 style="font-size:12px;font-weight:700;color:#1e3a8a;border-right:3px solid #1e3a8a;padding-right:6px;margin:0 0 6px 0">الدفعات • Payments</h2>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead>
          <tr style="background:#1e3a8a;color:#fff">
            <th style="padding:6px;border:1px solid #1e3a8a">رقم الدفعة</th>
            <th style="padding:6px;border:1px solid #1e3a8a">التاريخ</th>
            <th style="padding:6px;border:1px solid #1e3a8a">المبلغ (OMR)</th>
            <th style="padding:6px;border:1px solid #1e3a8a">الطريقة</th>
            <th style="padding:6px;border:1px solid #1e3a8a">الحالة</th>
            <th style="padding:6px;border:1px solid #1e3a8a">المرجع</th>
          </tr>
        </thead>
        <tbody>
          ${data.payments.map((p) => `
            <tr>
              <td style="padding:5px 8px;border:1px solid #e2e8f0;font-family:monospace">${esc(p.payment_number)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0">${fmtDate(p.payment_date)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:left;font-family:monospace">${fmtMoney(p.amount)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0">${esc(p.payment_method)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0">${esc(p.status)}</td>
              <td style="padding:5px 8px;border:1px solid #e2e8f0;font-family:monospace">${esc(p.reference_number || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

async function buildPhotoSection(title: string, titleEn: string, files: ArchiveSectionFile[]): Promise<string> {
  const images = files.filter((f) => f.kind === "image");
  const docs = files.filter((f) => f.kind === "pdf");
  if (!images.length && !docs.length) return "";

  // حمّل الصور كـ dataURL لضمان ظهورها
  const imgsHtml: string[] = [];
  for (const im of images) {
    const data = await fetchAsDataUrl(im.url);
    const src = data || im.url;
    imgsHtml.push(`
      <div style="break-inside:avoid;page-break-inside:avoid;border:1px solid #e2e8f0;border-radius:4px;padding:4px;background:#fff">
        <img src="${esc(src)}" crossorigin="anonymous" style="width:100%;height:120px;object-fit:cover;border-radius:3px;display:block"/>
        <div style="font-size:8px;color:#475569;margin-top:3px;font-family:monospace;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" dir="ltr">${esc(im.name)}</div>
      </div>`);
  }

  const docsHtml = docs.length
    ? `<div style="margin-top:6px">
        <div style="font-size:9px;color:#475569;margin-bottom:3px">📎 المستندات المرفقة (${docs.length})</div>
        <ul style="margin:0;padding-right:16px;font-size:9px;color:#0f172a;line-height:1.7">
          ${docs.map((d) => `<li><span style="font-family:monospace" dir="ltr">${esc(d.name)}</span>${d.meta ? ` <span style="color:#64748b">— ${esc(d.meta)}</span>` : ""}</li>`).join("")}
        </ul>
       </div>`
    : "";

  return `
    <section style="margin-bottom:16px;break-inside:avoid">
      <h2 style="font-size:12px;font-weight:700;color:#1e3a8a;border-right:3px solid #1e3a8a;padding-right:6px;margin:0 0 6px 0">
        ${esc(title)} <span style="font-weight:400;color:#64748b">• ${esc(titleEn)}</span>
        <span style="float:left;background:#dbeafe;color:#1e3a8a;font-size:9px;padding:2px 8px;border-radius:10px;font-weight:600">${images.length + docs.length}</span>
      </h2>
      ${images.length ? `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          ${imgsHtml.join("")}
        </div>` : ""}
      ${docsHtml}
    </section>
  `;
}

/** يبني HTML الكامل للأرشيف ثم يولّد PDF حقيقي */
export async function generateClaimArchivePdf(data: ClaimArchivePdfData): Promise<Blob> {
  const settings = getTemplateSettings();

  // ابنِ أقسام الصور/المستندات بالترتيب
  const sectionsHtml: string[] = [];
  for (const s of data.sections) {
    if (!s.files.length) continue;
    sectionsHtml.push(await buildPhotoSection(s.title, s.titleEn, s.files));
  }

  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>Claim Archive ${esc(data.claim.claim_number)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
  @page{size:A4;margin:0}
  *{box-sizing:border-box}
  body{margin:0;padding:0;font-family:'Cairo',Arial,sans-serif;color:#0f172a;background:#fff}
  .page{width:210mm;min-height:297mm;padding:12mm 10mm;background:#fff}
  h1,h2,h3{margin:0}
  table{width:100%;border-collapse:collapse;page-break-inside:auto}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  tr,td,th{page-break-inside:avoid;break-inside:avoid}
</style>
</head>
<body>
<div class="page">
  ${buildHeader(data, settings)}

  <div style="padding:8px 12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;font-size:10px;color:#78350f;margin-bottom:12px">
    📁 هذا الملف هو <strong>أرشيف موحّد للقراءة فقط</strong> يجمع كل بيانات وصور ومستندات المطالبة في وثيقة واحدة. تاريخ التوليد: ${fmtDateTime(new Date().toISOString())}
  </div>

  ${buildClaimInfo(data)}
  ${buildWorkOrder(data)}
  ${buildInvoices(data)}
  ${buildPayments(data)}

  ${sectionsHtml.join("")}

  <footer style="margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#64748b">
    <span>${esc(settings.companyName || "Alwafa Integrated Services")}</span>
    <span style="font-family:monospace" dir="ltr">Generated ${fmtDateTime(new Date().toISOString())}</span>
  </footer>
</div>
</body>
</html>`;

  return await generatePdfFromHtml({
    htmlContent: html,
    fileName: `Claim-Archive-${data.claim.claim_number}`,
    download: true,
    margins: { top: 8, right: 8, bottom: 8, left: 8 },
  });
}
