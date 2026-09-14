import type { PdfTemplateSettings } from "@/lib/pdfGenerator";
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
  receiverName?: string | null;
  receiverIdNumber?: string | null;
  receiverNotes?: string | null;
  receiverSignatureDataUrl?: string | null;
  handoverAt?: string | null;
}

const e = (input: unknown): string => String(input ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
const value = (input: unknown) => e(input || "—");
const latin = (input: unknown) => e(toEnglishDigits(String(input || "—")));

export function buildCancelledClaimVehicleHandoverHtml(
  data: CancelledClaimVehicleHandoverData,
  settings: PdfTemplateSettings,
): string {
  const cancellationDate = data.cancelledAt ? String(data.cancelledAt).slice(0, 10) : "—";
  const handoverInstant = new Date(data.handoverAt || Date.now());
  const handoverDate = Number.isNaN(handoverInstant.getTime())
    ? String(data.handoverAt || "—")
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Muscat",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(handoverInstant).replace(",", "");
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
    .declaration{margin-top:3mm;border:1px solid #cbd5e1;background:#f8fafc;padding:3mm;border-radius:2mm;font-size:7.2pt;line-height:1.45}.declaration h2{font-size:8.5pt;margin:0 0 1.2mm;color:#0f2746}.terms{margin:0;padding:0 4.5mm 0 0}.terms li{margin:.6mm 0}.receiver{display:grid;grid-template-columns:1fr 1fr 1.2fr;margin-top:2.5mm;border:1px solid #94a3b8;border-radius:2mm;overflow:hidden}.receiver .cell{border-bottom:0}.receiver .cell:not(:last-child){border-left:1px solid #cbd5e1}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm;margin-top:5mm;text-align:center}.sig{min-height:24mm;border-top:1px solid #334155;padding-top:2mm;font-size:7pt;line-height:1.5}.stamp{max-width:28mm;max-height:21mm;object-fit:contain}.stamp-placeholder{height:21mm;border:1px dashed #94a3b8;display:grid;place-items:center;color:#64748b;line-height:1.45}
    .footer{position:absolute;right:10mm;left:10mm;bottom:5mm;border-top:1px solid #cbd5e1;padding-top:1.5mm;text-align:center;font-size:6.5pt;color:#64748b}
    @media print{html,body,.page{width:210mm;height:296mm;max-height:296mm}.page{margin:0!important;break-after:avoid-page}}
  </style></head><body><main class="page">
    <header class="header">${logo}<div class="company"><h1>${value(settings.companyName)}</h1><p dir="ltr">${value(settings.companyNameEn)}</p></div><div class="meta">CR: ${latin(settings.commercialReg)}<br/>VAT: ${latin(settings.vatNumber)}<br/>${latin(settings.phone)}<br/>${value(settings.email)}</div></header>
    <div class="cancelled"><strong>تسليم مركبة بعد إلغاء المطالبة</strong><span>CANCELLED CLAIM VEHICLE HANDOVER</span></div>
    <section class="grid">
      <div class="cell"><div class="label">رقم المطالبة / Claim No.</div><div class="val" dir="ltr">${latin(data.claimNumber)}</div></div>
      <div class="cell"><div class="label">تاريخ إلغاء المطالبة / Claim Cancellation Date</div><div class="val" dir="ltr">${latin(cancellationDate)}</div></div>
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
    <section class="declaration">
      <h2>إقرار معاينة واستلام وإنهاء حيازة المركبة / VEHICLE RECEIPT AND CUSTODY ACKNOWLEDGEMENT</h2>
      <ol class="terms">
        <li>أقر بأنني عاينت المركبة وقت التسليم واستلمتها بالحالة الظاهرة والمثبتة في هذا المستند وسجل الدخول والصور المتاحة، وأتيحت لي فرصة فحصها وإثبات أي تحفظ أدناه.</li>
        <li>أقر باستلام المفاتيح والمستندات والملحقات والمحتويات المسجلة عند دخول المركبة، وكافة القطع القديمة أو المفكوكة والمتاحة التي عُرضت عليّ عند التسليم، ولا توجد لدي مطالبة بنقص أي منها عدا ما أثبته صراحة في خانة التحفظات.</li>
        <li>أفهم أن المطالبة التأمينية ملغاة، وأن هذا المستند يثبت التسليم فقط ولا يُعد فاتورة أو موافقة على إصلاح أو إقرارًا بإتمام أعمال إصلاح.</li>
        <li>تنتهي حيازة الورشة ومسؤوليتها عن حفظ المركبة والمحتويات والقطع المسلّمة من تاريخ ووقت التسليم الفعلي وانتقال المركبة إلى حيازتي أو حيازة من أمثله.</li>
        <li>بالنسبة إلى الأغراض الشخصية، الثمينة وغير الثمينة، يعتمد الاستلام على سجل الدخول والصور والتحفظات المثبتة؛ ولا تعد الورشة أمين حفظ مستقلًا لأي غرض لم يُسلّم إليها أو لم يُثبت في السجل.</li>
        <li>يُعد هذا الإقرار إثباتًا نهائيًا لواقعة الاستلام والعناصر المبينة فيه، دون إخلال بأي حقوق أو التزامات لا يجوز قانونًا التنازل عنها.</li>
      </ol>
      <div dir="ltr" style="margin-top:1.2mm;font-size:6.4pt;color:#475569">I confirm inspection and receipt of the vehicle, recorded contents, keys, documents, accessories, and all available old or removed parts presented at handover. Workshop custody ends upon actual handover, subject to rights and liabilities that cannot legally be waived.</div>
    </section>
    <section class="receiver">
      <div class="cell"><div class="label">اسم المستلم / Receiver Name</div><div class="val">${value(data.receiverName)}</div></div>
      <div class="cell"><div class="label">رقم الهوية/الجواز / ID or Passport No.</div><div class="val" dir="ltr">${latin(data.receiverIdNumber)}</div></div>
      <div class="cell"><div class="label">تاريخ ووقت التسليم / Handover Date & Time</div><div class="val" dir="ltr">${latin(handoverDate)}</div></div>
    </section>
    <section class="reason" style="min-height:12mm;max-height:18mm"><div class="label">تحفظات المستلم عند التسليم / Receiver Reservations at Handover</div><div class="val">${value(data.receiverNotes || "لا توجد تحفظات")}</div></section>
    <section class="signatures"><div class="sig">${data.receiverSignatureDataUrl ? `<img src="${e(data.receiverSignatureDataUrl)}" alt="Receiver signature" style="display:block;max-width:55mm;max-height:17mm;margin:0 auto 1mm;object-fit:contain"/>` : ""}توقيع المستلم المذكور أعلاه<br/>Receiver Signature</div><div class="sig">اسم وتوقيع موظف الورشة<br/>Workshop Representative</div><div class="sig">${stamp}</div></section>
    <footer class="footer">${value(settings.footerText || settings.companyNameEn)}</footer>
  </main></body></html>`;
}
