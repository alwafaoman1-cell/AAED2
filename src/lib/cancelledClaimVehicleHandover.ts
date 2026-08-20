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
    @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#0f172a;font-family:Tahoma,Arial,sans-serif}
    .page{width:210mm;min-height:297mm;padding:12mm 13mm;position:relative;background:#fff;overflow:hidden}
    .header{display:grid;grid-template-columns:34mm 1fr 52mm;gap:7mm;align-items:center;border-bottom:1.2mm solid #0f2746;padding-bottom:5mm}
    .logo{width:25mm;height:25mm;object-fit:contain;justify-self:center}.placeholder{border:1px solid #cbd5e1;border-radius:50%;display:grid;place-items:center;font-weight:800}
    .company{text-align:center}.company h1{font-size:15pt;margin:0 0 2mm}.company p{font-size:9pt;margin:1mm 0;color:#475569}.meta{font-size:8pt;line-height:1.7;text-align:left;direction:ltr}
    .cancelled{margin:7mm 0 5mm;border:1px solid #b91c1c;background:#fef2f2;color:#991b1b;padding:4mm;text-align:center;border-radius:2mm}.cancelled strong{font-size:18pt;display:block}.cancelled span{font-size:9pt;letter-spacing:1px}
    h2{font-size:12pt;margin:5mm 0 3mm;color:#0f2746}.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #94a3b8;border-radius:2mm;overflow:hidden}.cell{padding:4mm;border-bottom:1px solid #cbd5e1}.cell:nth-child(odd){border-left:1px solid #cbd5e1}.label{font-size:8pt;color:#64748b;margin-bottom:1.5mm}.val{font-size:10pt;font-weight:700;min-height:5mm}.reason{margin-top:5mm;border:1px solid #fecaca;background:#fff7f7;border-radius:2mm;padding:4mm;min-height:25mm}.reason .val{font-weight:500;line-height:1.8}
    .declaration{margin-top:6mm;border:1px solid #cbd5e1;background:#f8fafc;padding:5mm;border-radius:2mm;font-size:9pt;line-height:1.9}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7mm;margin-top:11mm;text-align:center}.sig{min-height:37mm;border-top:1px solid #334155;padding-top:3mm;font-size:8pt}.stamp{max-width:34mm;max-height:28mm;object-fit:contain}.stamp-placeholder{height:27mm;border:1px dashed #94a3b8;display:grid;place-items:center;color:#64748b;line-height:1.7}
    .footer{position:absolute;right:13mm;left:13mm;bottom:8mm;border-top:1px solid #cbd5e1;padding-top:2mm;text-align:center;font-size:7pt;color:#64748b}
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
