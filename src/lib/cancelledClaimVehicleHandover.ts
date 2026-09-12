import type { PdfTemplateSettings } from "@/lib/pdfGenerator";
import { escapeHtml } from "@/lib/insurancePdfTemplates";
import { toEnglishDigits } from "@/lib/numberUtils";

export interface CancelledClaimVehicleHandoverData {
  claimNumber: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  insuranceCompany?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | number | null;
  plateNumber?: string | null;
  plateLetters?: string | null;
  plateCountry?: string | null;
  vin?: string | null;
  workshopArrivalDate?: string | null;
}

const e = escapeHtml;
const value = (input: unknown) => e(input || "—");
const latin = (input: unknown) => e(toEnglishDigits(String(input || "—")));

export function buildCancelledClaimVehicleHandoverHtml(
  data: CancelledClaimVehicleHandoverData,
  settings: PdfTemplateSettings,
): string {
  const handoverDate = data.cancelledAt ? String(data.cancelledAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const vehicleName = [data.vehicleMake, data.vehicleModel, data.vehicleYear].filter(Boolean).join(" ") || "—";
  const plate = [data.plateNumber, data.plateLetters, data.plateCountry].filter(Boolean).join(" ") || "—";
  const logo = settings.logoUrl
    ? `<img src="${e(settings.logoUrl)}" alt="logo" class="logo" />`
    : `<div class="logo placeholder">${e((settings.companyNameEn || settings.companyName || "AW").slice(0, 2))}</div>`;
  const stamp = settings.stampEnabled && settings.stampUrl
    ? `<img src="${e(settings.stampUrl)}" alt="stamp" class="stamp" />`
    : `<div class="stamp-placeholder">ختم الشركة<br/>COMPANY STAMP</div>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <style>
    @page{size:A4;margin:0}*{box-sizing:border-box}html,body{width:210mm;margin:0;padding:0;background:#fff;color:#0f172a;font-family:Tahoma,Arial,sans-serif}body{overflow:hidden}
    .page{width:210mm;height:296mm;max-height:296mm;padding:8.5mm 10mm;position:relative;background:#fff;overflow:hidden;break-inside:avoid;page-break-inside:avoid;page-break-after:avoid}
    .header{display:grid;grid-template-columns:27mm 1fr 46mm;gap:4mm;align-items:center;border-bottom:0.8mm solid #0f2746;padding-bottom:3mm}
    .logo{width:20mm;height:20mm;object-fit:contain;justify-self:center}.placeholder{border:1px solid #cbd5e1;border-radius:50%;display:grid;place-items:center;font-weight:800}
    .company{text-align:center}.company h1{font-size:12pt;margin:0 0 1mm;line-height:1.3}.company p{font-size:7.5pt;margin:.5mm 0;color:#475569;line-height:1.35}.meta{font-size:7pt;line-height:1.45;text-align:left;direction:ltr;overflow-wrap:anywhere}
    .cancelled{margin:4mm 0 3mm;border:1px solid #b91c1c;background:#fef2f2;color:#991b1b;padding:2.5mm;text-align:center;border-radius:2mm}.cancelled strong{font-size:14pt;line-height:1.3;display:block}.cancelled span{font-size:7.5pt;letter-spacing:.7px}
    .grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #94a3b8;border-radius:2mm;overflow:hidden}.cell{padding:2.6mm 3mm;border-bottom:1px solid #cbd5e1;min-width:0}.cell:nth-child(odd){border-left:1px solid #cbd5e1}.label{font-size:7pt;line-height:1.35;color:#64748b;margin-bottom:.8mm}.val{font-size:9pt;line-height:1.35;font-weight:700;min-height:4mm;overflow-wrap:anywhere}.reason{margin-top:3mm;border:1px solid #fecaca;background:#fff7f7;border-radius:2mm;padding:3mm;min-height:18mm;max-height:30mm;overflow:hidden}.reason .val{font-weight:500;line-height:1.55}
    .declaration{margin-top:3.5mm;border:1px solid #cbd5e1;background:#f8fafc;padding:3.5mm;border-radius:2mm;font-size:7.8pt;line-height:1.6}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm;margin-top:6mm;text-align:center}.sig{min-height:27mm;border-top:1px solid #334155;padding-top:2mm;font-size:7pt;line-height:1.5}.stamp{max-width:28mm;max-height:23mm;object-fit:contain}.stamp-placeholder{height:23mm;border:1px dashed #94a3b8;display:grid;place-items:center;color:#64748b;line-height:1.45}
    .footer{position:absolute;right:10mm;left:10mm;bottom:5mm;border-top:1px solid #cbd5e1;padding-top:1.5mm;text-align:center;font-size:6.5pt;color:#64748b}
    @media print{html,body,.page{width:210mm;height:296mm;max-height:296mm}.page{margin:0!important;break-after:avoid-page}}
  </style></head><body><main class="page">
    <header class="header">${logo}<div class="company"><h1>${value(settings.companyName)}</h1><p dir="ltr">${value(settings.companyNameEn)}</p></div><div class="meta">CR: ${latin(settings.commercialReg)}<br/>VAT: ${latin(settings.vatNumber)}<br/>${latin(settings.phone)}<br/>${value(settings.email)}</div></header>
    <div class="cancelled"><strong>تسليم مركبة بعد إلغاء المطالبة</strong><span>CANCELLED CLAIM VEHICLE HANDOVER</span></div>
    <section class="grid">
      <div class="cell"><div class="label">رقم المطالبة / Claim No.</div><div class="val" dir="ltr">${latin(data.claimNumber)}</div></div>
      <div class="cell"><div class="label">تاريخ الإلغاء والتسليم / Cancellation & Handover Date</div><div class="val" dir="ltr">${latin(handoverDate)}</div></div>
      <div class="cell"><div class="label">العميل / Customer</div><div class="val">${value(data.customerName)}</div></div>
      <div class="cell"><div class="label">الهاتف / Phone</div><div class="val" dir="ltr">${latin(data.customerPhone)}</div></div>
      <div class="cell"><div class="label">شركة التأمين / Insurance Company</div><div class="val">${value(data.insuranceCompany)}</div></div>
      <div class="cell"><div class="label">وصول الورشة / Workshop Arrival</div><div class="val" dir="ltr">${latin(data.workshopArrivalDate)}</div></div>
      <div class="cell"><div class="label">المركبة / Vehicle</div><div class="val">${value(vehicleName)}</div></div>
      <div class="cell"><div class="label">اللوحة / Plate</div><div class="val" dir="ltr">${latin(plate)}</div></div>
      <div class="cell"><div class="label">رقم الهيكل / VIN</div><div class="val" dir="ltr">${latin(data.vin)}</div></div>
      <div class="cell"><div class="label">حالة الملف / File Status</div><div class="val" style="color:#991b1b">مطالبة ملغاة / Cancelled</div></div>
    </section>
    <section class="reason"><div class="label">سبب إلغاء المطالبة / Cancellation Reason</div><div class="val">${value(data.cancellationReason)}</div></section>
    <section class="declaration">أقر باستلام المركبة الموضحة أعلاه من الورشة بعد إلغاء المطالبة، بالحالة الظاهرة وقت التسليم. هذا المستند يثبت تسليم المركبة فقط ولا يُعد فاتورة أو موافقة على إصلاح أو إقرارًا بإتمام أعمال إصلاح.<br/><span dir="ltr">I acknowledge receipt of the vehicle after cancellation of the claim. This document confirms vehicle handover only and is not an invoice, repair approval, or confirmation that repairs were completed.</span></section>
    <section class="signatures"><div class="sig">اسم وتوقيع المستلم<br/>Receiver Name & Signature</div><div class="sig">توقيع موظف الورشة<br/>Workshop Representative</div><div class="sig">${stamp}</div></section>
    <footer class="footer">${value(settings.footerText || settings.companyNameEn)}</footer>
  </main></body></html>`;
}
