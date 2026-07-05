// 3 قوالب PDF احترافية خاصة بمنظومة التأمين:
// 1) تقدير المطالبة (Claim Estimate)
// 2) فاتورة ضريبية لشركة التأمين (Tax Invoice with ZATCA-style QR)
// 3) محضر تسليم (Delivery Proof) مع صور التسليم/الرضاء/الهوية والتوقيع
//
// تستخدم القوالب نفس إعدادات الفروع/الشعار/الختم/التوقيع من pdfGenerator.ts
// لضمان توحيد الهوية البصرية مع باقي مستندات النظام.

import { getTemplateSettings, type PdfTemplateSettings } from "./pdfGenerator";
import { buildZatcaQrDataUrl } from "./zatcaQr";
import { renderWithCustomTemplate } from "./printTemplates/resolver";
import { vehicleColorToEn } from "./vehicleColors";
import { toEnglishDigits } from "./numberUtils";

export interface ClaimVehicleInfo {
  make?: string | null;
  model?: string | null;
  plate?: string | null;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
}

export interface UplItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface ClaimEstimatePayload {
  claimNumber: string;
  date: string;
  insuranceCompany: string;
  policyNumber?: string | null;
  policyExpiry?: string | null;
  adjusterName?: string | null;
  adjusterPhone?: string | null;
  incidentDate?: string | null;
  incidentLocation?: string | null;
  incidentDescription?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  vehicle: ClaimVehicleInfo;
  estimationType: "lump_sum" | "upl";
  lumpSumAmount?: number;
  uplItems?: UplItem[];
  approvedAmount?: number | null;
  deductibleAmount?: number;
  notes?: string | null;
  damagePhotos?: string[];
}

export interface ClaimTaxInvoicePayload {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  claimNumber: string;
  insuranceCompany: string;
  insuranceCompanyVat?: string | null;
  insuranceCompanyCR?: string | null;
  insuranceCompanyAddress?: string | null;
  insuranceCompanyPhone?: string | null;
  insuranceCompanyLogoUrl?: string | null;
  vehicle: ClaimVehicleInfo;
  customerName?: string | null;
  items: { description: string; quantity: number; unit_price: number }[];
  vatRate?: number;
  notes?: string | null;
  lpoNumber?: string | null;
  estimationType?: "lump_sum" | "upl" | null;
  verifyUrl?: string | null;
}

export interface ClaimDeliveryPayload {
  claimNumber: string;
  deliveryDate: string;
  insuranceCompany: string;
  vehicle: ClaimVehicleInfo;
  customerName?: string | null;
  receiverName?: string | null;
  receiverIdNumber?: string | null;
  receiverIdPhotoUrl?: string | null;
  deliveryPhotos?: string[];
  satisfactionPhotos?: string[];
  notes?: string | null;
}

// ─── Shared Styles (مطابقة لروح pdfGenerator) ───────────────────
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** يهرّب القيم المُدخلة من المستخدم قبل إدراجها داخل HTML لمنع XSS. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const e = escapeHtml;

function baseStyles(s: PdfTemplateSettings) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;direction:rtl;color:#1a1a2e;background:#f8f9fa;padding:0}
    .page{width:210mm;min-height:297mm;margin:10mm auto;background:white;padding:15mm 18mm;box-shadow:0 2px 20px rgba(0,0,0,0.1);position:relative}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${s.primaryColor};padding-bottom:15px;margin-bottom:25px}
    .company-info h1{font-size:20px;font-weight:700;color:#1a1a2e;margin-bottom:2px}
    .company-info .en-name{font-size:13px;color:#444;font-weight:600;margin-bottom:6px;font-family:'Inter',sans-serif}
    .company-info .details{font-size:9.5px;color:#888;line-height:1.7}
    .doc-badge{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;padding:10px 20px;border-radius:8px;text-align:center;min-width:170px}
    .doc-badge .label-ar{font-size:11px;opacity:0.95;font-weight:600}
    .doc-badge .label-en{font-size:9px;opacity:0.85;font-family:'Inter',sans-serif;text-transform:uppercase;letter-spacing:0.5px}
    .doc-badge .number{font-size:17px;font-weight:700;direction:ltr;font-family:'Inter',sans-serif;margin:3px 0}
    .doc-badge .date{font-size:9.5px;opacity:0.85;font-family:'Inter',sans-serif;direction:ltr}

    .insurance-banner{display:flex;align-items:center;gap:14px;padding:12px 16px;background:linear-gradient(135deg,#0d47a1,#1976d2);color:white;border-radius:10px;margin-bottom:20px}
    .insurance-banner .icon{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-size:22px}
    .insurance-banner .info{flex:1}
    .insurance-banner .info .label{font-size:10px;opacity:0.85;text-transform:uppercase;letter-spacing:0.4px}
    .insurance-banner .info .name{font-size:15px;font-weight:700;margin-top:2px}
    .insurance-banner .meta{text-align:left;font-size:11px;line-height:1.6;direction:ltr}

    .vehicle-card{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#fff8e1;border:2px solid #ffd54f;border-radius:10px;margin-bottom:18px}
    .vehicle-card .left{flex:1}
    .vehicle-card .left .lbl{font-size:10px;color:#8a6d3b;text-transform:uppercase;letter-spacing:0.4px}
    .vehicle-card .left .val{font-size:18px;font-weight:700;color:#5d4037;margin-top:2px}
    .vehicle-card .right{display:grid;grid-template-columns:auto auto;gap:4px 16px;font-size:11.5px;color:#5d4037}
    .vehicle-card .right .k{color:#8a6d3b}
    .vehicle-card .right .v{font-weight:600}
    .vehicle-plate{display:inline-block;padding:6px 18px;background:white;border:2px solid #5d4037;border-radius:6px;font-family:'Inter',monospace;font-weight:700;font-size:18px;letter-spacing:2px;direction:ltr}

    .section-title{font-size:13px;font-weight:600;color:${s.primaryColor};border-right:3px solid ${s.primaryColor};padding-right:10px;margin:18px 0 10px 0}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;margin-bottom:18px}
    .info-row{display:flex;gap:8px;font-size:11.5px;padding:3px 0}
    .info-row .label{color:#888;min-width:120px;font-weight:500}
    .info-row .value{color:#1a1a2e;font-weight:600;flex:1}

    table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11.5px;page-break-inside:auto}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    tr,td,th{page-break-inside:avoid;break-inside:avoid}
    thead th{background:#1a1a2e;color:white;padding:9px 10px;text-align:right;font-weight:600;font-size:10.5px}
    thead th:first-child{border-radius:0 6px 6px 0}
    thead th:last-child{border-radius:6px 0 0 6px}
    tbody td{padding:9px 10px;border-bottom:1px solid #eee}

    .totals-box{margin-top:18px;margin-right:auto;width:300px;border:2px solid #eee;border-radius:8px;overflow:hidden}
    .totals-row{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;font-size:11.5px}
    .totals-row:not(:last-child){border-bottom:1px solid #eee}
    .totals-row .amount{font-family:'Inter',sans-serif;font-weight:600;direction:ltr}
    .totals-row.total{background:linear-gradient(135deg,${s.primaryColor},${adjustColor(s.primaryColor,-15)});color:white;font-weight:700;font-size:13.5px}

    .qr-area{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;gap:20px}
    .qr-area .qr-img{width:120px;height:120px;border:1px solid #eee;padding:4px;background:white}
    .qr-area .legal{font-size:9.5px;color:#777;line-height:1.7;flex:1}
    .qr-area .legal strong{color:#333}

    .photos-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
    .photos-grid .ph{position:relative;border:1px solid #eee;border-radius:6px;overflow:hidden;aspect-ratio:4/3;background:#f8f8f8}
    .photos-grid .ph img{width:100%;height:100%;object-fit:cover;display:block}
    .photos-grid .ph .cap{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.55);color:white;padding:3px 6px;font-size:9px;text-align:center}

    .signature-area{margin-top:30px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px}
    .signature-area .sig{border:1px dashed #bbb;border-radius:8px;padding:12px;text-align:center}
    .signature-area .sig .name{font-size:11px;font-weight:600;margin-bottom:6px;color:#333}
    .signature-area .sig .area{height:50px;display:flex;align-items:center;justify-content:center}
    .signature-area .sig .area img{max-height:44px;max-width:100%}
    .signature-area .sig .lbl{font-size:9.5px;color:#777;margin-top:6px}

    .notes-box{margin-top:18px;padding:11px 14px;background:#f8f9fa;border-radius:8px;border-right:3px solid ${s.primaryColor};font-size:10.5px;color:#555;line-height:1.7}
    .footer{position:absolute;bottom:12mm;left:18mm;right:18mm;text-align:center;font-size:8.5px;color:#aaa;border-top:1px solid #eee;padding-top:8px;line-height:1.6}
    .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:78px;font-weight:700;color:rgba(13,71,161,0.05);pointer-events:none;white-space:nowrap;font-family:'Inter',sans-serif}
    .stamp-bottom-right{position:absolute;bottom:25mm;left:18mm;width:95px;opacity:0.92}
    .stamp-bottom-right img{max-width:100%;max-height:95px}
    .estimation-badge{display:flex;justify-content:center;margin-top:14px}
    .estimation-badge span{display:inline-block;padding:6px 28px;border:3px solid #0d47a1;color:#0d47a1;font-size:20pt;font-weight:900;letter-spacing:5px;direction:ltr;border-radius:6px;background:rgba(13,71,161,0.04)}

    @media print{body{background:white;padding:0}.page{margin:0;box-shadow:none;width:100%}}
  `;
}

function wrapHtml(title: string, styles: string, body: string) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>${toEnglishDigits(title)}</title><style>${styles}</style></head><body>${toEnglishDigits(body)}</body></html>`;
}

function money3(value: number): string {
  return (Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function textOrDash(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text ? text : "—";
}

function vehicleName(vehicle: ClaimVehicleInfo): string {
  const make = textOrDash(vehicle.make) === "—" ? "" : String(vehicle.make).trim();
  const model = textOrDash(vehicle.model) === "—" ? "" : String(vehicle.model).trim();
  const year = vehicle.year ? String(vehicle.year) : "";
  return [make, model].filter(Boolean).join(" ") + (year ? ` - ${year}` : "") || "—";
}

function referenceInsuranceInvoiceStyles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff;color:#10213c}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;font-size:11px}
    .page{width:210mm;min-height:297mm;margin:0 auto;padding:22mm 18mm 11mm;background:#fff;position:relative;overflow:hidden}
    .mono,.num,.money{font-family:'Inter','Noto Sans Arabic',sans-serif;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:embed}
    .top{display:grid;grid-template-columns:64mm 1fr;gap:18mm;align-items:start;margin-top:0;direction:ltr}
    .invoice-card{width:54mm;background:#0f243e;color:#fff;border-radius:3px;text-align:center;padding:7mm 5mm 4mm;box-shadow:0 2px 5px rgba(15,36,62,.18)}
    .invoice-card .ar{font-size:13px;font-weight:700;margin-bottom:2mm}
    .invoice-card .en{font-family:'Inter',sans-serif;font-size:10px;font-weight:700;letter-spacing:.5px;margin-bottom:2mm}
    .invoice-card .no{font-family:'Inter',sans-serif;font-size:25px;font-weight:800;line-height:1}
    .invoice-date{width:54mm;text-align:center;margin-top:4mm;color:#53657f;font-family:'Inter',sans-serif;font-size:12px}
    .company{display:flex;align-items:flex-start;justify-content:flex-end;gap:8mm;text-align:right;padding-top:1mm;direction:rtl}
    .company-text h1{font-size:20px;line-height:1.25;margin:0 0 1mm;font-weight:800;color:#10213c}
    .company-text .en{font-family:'Inter',sans-serif;font-size:13px;font-weight:700;margin-bottom:5mm}
    .company-text .meta{font-family:'Inter','Noto Sans Arabic',sans-serif;color:#52647f;font-size:11px;line-height:1.7}
    .logo-box{width:26mm;height:32mm;display:flex;align-items:flex-start;justify-content:center;border-inline-start:1px solid #cdd6e3;padding-inline-start:5mm}
    .logo-box img{max-width:23mm;max-height:30mm;object-fit:contain}
    .logo-fallback{width:20mm;height:25mm;background:#0f243e;border:2px solid #d9a11e;clip-path:polygon(50% 0,95% 45%,50% 100%,5% 45%);display:block}
    .rule{height:1px;background:#d8dee8;margin:10mm 0 4.5mm}
    .claim-box{border:1px solid #cfd8e6;border-radius:2px;min-height:19mm;display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:3mm 5mm;margin-bottom:4mm;direction:ltr}
    .claim-box .claim{text-align:left;direction:ltr}
    .label{font-family:'Inter','Noto Sans Arabic',sans-serif;text-transform:uppercase;font-size:9px;color:#475b76;font-weight:800;letter-spacing:.25px;margin-bottom:2mm}
    .big-val{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:15px;font-weight:800;color:#10213c}
    .insurance-side{display:flex;align-items:center;justify-content:flex-end;gap:4mm;text-align:center;direction:rtl}
    .insurance-logo{width:18mm;height:18mm;border:1px solid #d8dee8;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;color:#0f766e;font-weight:800}
    .insurance-logo img{max-width:16mm;max-height:16mm;object-fit:contain}
    .vehicle-box{border:1px solid #cfd8e6;border-radius:2px;display:grid;grid-template-columns:1fr 1fr 43mm;min-height:30mm;overflow:hidden;margin-bottom:4mm;direction:ltr}
    .vehicle-cell{padding:6mm 5mm 4mm;text-align:center}
    .vehicle-cell.color{text-align:left}
    .vehicle-cell .v{font-size:14px;font-weight:800;color:#10213c}
    .vehicle-cell .sub{font-family:'Inter',sans-serif;font-size:10px;color:#61728a;margin-top:4mm}
    .plate-box{background:#0f243e;color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:5mm}
    .plate-no{border:1px solid rgba(255,255,255,.8);min-width:22mm;text-align:center;padding:4mm 5mm;font-family:'Inter',sans-serif;font-size:19px;font-weight:800;margin-bottom:3mm}
    .plate-label{font-family:'Inter','Noto Sans Arabic',sans-serif;font-size:9px;font-weight:800;color:#fff}
    .bill-row{border-top:1px solid #d8dee8;border-bottom:1px solid #d8dee8;display:grid;grid-template-columns:1fr 1fr 1fr 1.25fr;gap:7mm;padding:5mm 0;margin:4mm 0 5mm;text-align:center;direction:ltr}
    .bill-row .cell:last-child{text-align:right}
    .bill-row .v{font-size:12px;font-weight:800;color:#10213c}
    .bill-row .sub{font-size:9px;color:#64748b;margin-top:1.5mm}
    table.items{width:100%;border-collapse:collapse;margin-top:1mm;font-size:11px}
    .items thead th{border-bottom:1px solid #d8dee8;padding:0 3mm 3mm;color:#475b76;font-family:'Inter','Noto Sans Arabic',sans-serif;font-weight:800;text-align:right}
    .items thead th.c,.items tbody td.c{text-align:center}
    .items thead th.l,.items tbody td.l{text-align:left}
    .items tbody td{padding:7mm 3mm;border-bottom:1px solid #e3e8f0;vertical-align:top;color:#10213c}
    .items .desc{font-size:13px;font-weight:800;line-height:1.7}
    .items .desc small{display:block;font-family:'Inter',sans-serif;font-size:11px;margin-top:1mm}
    .summary-box{border:1px solid #cfd8e6;border-radius:2px;margin-top:5mm;display:grid;grid-template-columns:1fr 48mm;gap:9mm;padding:4mm 7mm 4mm 5mm;align-items:center;direction:ltr}
    .totals{max-width:94mm}
    .total-line{display:grid;grid-template-columns:26mm 1fr 28mm;gap:4mm;align-items:center;padding:2mm 0;color:#31445f}
    .total-line .cur{font-family:'Inter',sans-serif;font-size:10px;font-weight:700}
    .total-line .lbl{text-align:right;font-weight:700;color:#475b76}
    .total-line .amount{font-family:'Inter',sans-serif;text-align:left;font-weight:800;color:#10213c}
    .payable{margin-top:3mm;background:#0f243e;color:#fff;border-radius:2px;display:grid;grid-template-columns:1fr 38mm;align-items:center;padding:5mm 7mm}
    .payable .p-label{text-align:right;font-size:15px;font-weight:800}
    .payable .p-label span{display:block;font-family:'Inter',sans-serif;font-size:10px;margin-top:1mm;font-weight:700}
    .payable .p-amount{font-family:'Inter',sans-serif;font-size:25px;font-weight:800;text-align:left}
    .payable .cur-small{font-size:9px;font-weight:500;margin-top:1mm}
    .qr-box{text-align:center;justify-self:end}
    .qr-frame{border:1px solid #cfd8e6;padding:3mm;background:#fff;width:39mm;height:39mm;display:flex;align-items:center;justify-content:center}
    .qr-frame img{width:33mm;height:33mm;object-fit:contain}
    .qr-caption{font-family:'Inter',sans-serif;color:#66758d;margin-top:2mm;font-size:10px}
    .signatures{display:grid;grid-template-columns:1fr 1.3fr;gap:16mm;align-items:end;margin:8mm 9mm 0;direction:ltr}
    .sig-title,.stamp-title{font-size:11px;font-weight:800;color:#263b57;margin-bottom:3mm}
    .signature-line{height:23mm;display:flex;align-items:end}
    .signature-line:after{content:"";display:block;width:48mm;border-bottom:1px solid #10213c}
    .signature-line img{max-height:18mm;max-width:48mm;object-fit:contain}
    .stamp-placeholder{border:2px solid #2459a6;border-radius:4px;height:23mm;display:flex;align-items:center;justify-content:center;color:#2459a6;font-weight:800;text-align:center;font-size:10px;padding:2mm}
    .stamp-placeholder img{max-height:21mm;max-width:70mm;object-fit:contain}
    .legal{text-align:center;color:#42536c;font-size:10px;line-height:1.8;margin:8mm 8mm 0}
    .footer{position:absolute;left:18mm;right:18mm;bottom:6mm;border-top:2px solid #d9a11e;text-align:center;color:#53657f;font-size:10px;padding-top:3mm;font-family:'Inter','Noto Sans Arabic',sans-serif}
    @media print{body{background:#fff}.page{margin:0;box-shadow:none;break-after:auto}.footer{bottom:6mm}}
  `;
}

function renderReferenceInsuranceInvoice(p: {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  claimNumber: string;
  insuranceCompany: string;
  insuranceCompanyVat?: string | null;
  insuranceCompanyCR?: string | null;
  insuranceCompanyAddress?: string | null;
  insuranceCompanyPhone?: string | null;
  insuranceCompanyLogoUrl?: string | null;
  customerName?: string | null;
  vehicle: ClaimVehicleInfo;
  items: { description: string; quantity: number; unit_price: number }[];
  vatRate?: number;
  notes?: string | null;
  lpoNumber?: string | null;
  qrDataUrl?: string | null;
}, s: PdfTemplateSettings): string {
  const rate = Number.isFinite(Number(p.vatRate)) ? Number(p.vatRate) : (Number(s.vatRate) || 5);
  const rows = (p.items || []).filter((it) => String(it.description || "").trim()).map((it, idx) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;
    const line = Number((qty * unit).toFixed(3));
    return { idx: idx + 1, description: it.description, qty, unit, line };
  });
  const effectiveRows = rows.length ? rows : [{ idx: 1, description: `إصلاح أضرار المركبة - مطالبة ${p.claimNumber}`, qty: 1, unit: 0, line: 0 }];
  const subtotal = Number(effectiveRows.reduce((sum, it) => sum + it.line, 0).toFixed(3));
  const vatAmount = Number((subtotal * (rate / 100)).toFixed(3));
  const total = Number((subtotal + vatAmount).toFixed(3));
  const logo = s.logoUrl ? `<img src="${e(s.logoUrl)}" alt="logo"/>` : `<span class="logo-fallback"></span>`;
  const insuranceLogo = p.insuranceCompanyLogoUrl
    ? `<img src="${e(p.insuranceCompanyLogoUrl)}" alt="insurance logo"/>`
    : "∿";
  const stamp = s.stampEnabled && s.stampOnInvoice && s.stampUrl
    ? `<img src="${e(s.stampUrl)}" alt="stamp"/>`
    : `${e(s.companyName)}<br/>${e(s.companyNameEn)}<br/>CR : ${e(s.commercialReg)}`;
  const signature = s.signatureUrl
    ? `<img src="${e(s.signatureUrl)}" alt="signature"/>`
    : "";
  const itemsHtml = effectiveRows.map((it) => `
    <tr>
      <td class="c mono">${it.idx}</td>
      <td class="desc">${e(it.description)}<small>${e(p.claimNumber)}</small></td>
      <td class="c mono">${money3(it.qty)}</td>
      <td class="l mono">${money3(it.unit)}</td>
      <td class="l mono">${money3(it.line)}</td>
    </tr>
  `).join("");

  const body = `
    <div class="page">
      <div class="top">
        <div>
          <div class="invoice-card">
            <div class="ar">فاتورة ضريبية</div>
            <div class="en">TAX INVOICE</div>
            <div class="no">${e(textOrDash(p.invoiceNumber))}</div>
          </div>
          <div class="invoice-date">${e(textOrDash(p.invoiceDate))}</div>
        </div>
        <div class="company">
          <div class="company-text">
            <h1>${e(s.companyName)}</h1>
            <div class="en">${e(s.companyNameEn)}</div>
            <div class="meta">
              CR: ${e(s.commercialReg)} <span>:</span> السجل التجاري<br/>
              VAT: ${e(s.vatNumber)} <span>:</span> الرقم الضريبي<br/>
              ${e(s.email)} • ${e(s.phone)}<br/>
              ${e(s.address)}
            </div>
          </div>
          <div class="logo-box">${logo}</div>
        </div>
      </div>

      <div class="rule"></div>

      <div class="claim-box">
        <div class="claim">
          <div class="label"># CLAIM</div>
          <div class="big-val">${e(textOrDash(p.claimNumber))}</div>
        </div>
        <div class="insurance-side">
          <div>
            <div class="label">INSURANCE PROVIDER / شركة التأمين</div>
            <div class="big-val">${e(textOrDash(p.insuranceCompany))}</div>
          </div>
          <div class="insurance-logo">${insuranceLogo}</div>
        </div>
      </div>

      <div class="vehicle-box">
        <div class="vehicle-cell color">
          <div class="label">اللون / COLOR</div>
          <div class="v">${e(vehicleColorToEn(p.vehicle.color || "") || textOrDash(p.vehicle.color))}</div>
          <div class="sub">${e(textOrDash(p.lpoNumber))}</div>
        </div>
        <div class="vehicle-cell">
          <div class="label">المركبة / VEHICLE</div>
          <div class="v">${e(vehicleName(p.vehicle))}</div>
          <div class="sub">VIN / رقم الهيكل</div>
          <div class="v mono" style="font-size:12px">${e(textOrDash(p.vehicle.vin))}</div>
        </div>
        <div class="plate-box">
          <div class="plate-no">${e(textOrDash(p.vehicle.plate))}</div>
          <div class="plate-label">PLATE / رقم اللوحة</div>
        </div>
      </div>

      <div class="bill-row">
        <div class="cell">
          <div class="label">تاريخ الاستحقاق / تاريخ الحقاق</div>
          <div class="label">DUE DATE</div>
          <div class="v mono">${e(textOrDash(p.dueDate))}</div>
        </div>
        <div class="cell">
          <div class="label">الرقم التجاري</div>
          <div class="label">COMMERCIAL ID</div>
          <div class="v mono">${e(textOrDash(p.insuranceCompanyCR))}</div>
        </div>
        <div class="cell">
          <div class="label">الرقم الضريبي</div>
          <div class="label">VAT REG / VAT</div>
          <div class="v mono">${e(textOrDash(p.insuranceCompanyVat))}</div>
        </div>
        <div class="cell">
          <div class="label">إلى / BILL TO</div>
          <div class="v">${e(textOrDash(p.insuranceCompany))}</div>
          ${p.customerName ? `<div class="sub">${e(p.customerName)}</div>` : ""}
          ${p.insuranceCompanyAddress ? `<div class="sub">${e(p.insuranceCompanyAddress)}</div>` : ""}
        </div>
      </div>

      <table class="items">
        <thead>
          <tr>
            <th class="c">#</th>
            <th>الوصف / DESCRIPTION</th>
            <th class="c">الكمية / QTY</th>
            <th class="l">الوحدة / RATE</th>
            <th class="l">الإجمالي / TOTAL</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div class="summary-box">
        <div class="totals">
          <div class="total-line"><span class="cur">OMR</span><span class="amount">${money3(subtotal)}</span><span class="lbl">Subtotal / المجموع الفرعي</span></div>
          <div class="total-line"><span class="cur">OMR</span><span class="amount">${money3(vatAmount)}</span><span class="lbl">VAT ${money3(rate).replace(".000", "")}% / ضريبة القيمة المضافة</span></div>
          <div class="payable">
            <div class="p-amount">${money3(total)}<div class="cur-small">OMR / ريال عماني</div></div>
            <div class="p-label">الإجمالي المستحق<span>TOTAL PAYABLE</span></div>
          </div>
        </div>
        <div class="qr-box">
          <div class="qr-frame">${p.qrDataUrl ? `<img src="${e(p.qrDataUrl)}" alt="QR"/>` : "QR"}</div>
          <div class="qr-caption">ZATCA TLV QR</div>
        </div>
      </div>

      <div class="signatures">
        <div>
          <div class="sig-title">التوقيع / SIGNATURE</div>
          <div class="signature-line">${signature}</div>
        </div>
        <div>
          <div class="stamp-title">ختم الشركة / COMPANY STAMP</div>
          <div class="stamp-placeholder">${stamp}</div>
        </div>
      </div>

      <div class="legal"><strong>إفادة قانونية:</strong> هذه فاتورة ضريبية صادرة وفقًا لأنظمة الضرائب المعمول بها في سلطنة عمان وغير مصرح رد ضريبة QR.</div>
      <div class="footer">${e(s.companyNameEn)} • © ${new Date().getFullYear()} • ${e(s.companyName)}</div>
    </div>
  `;

  return wrapHtml(`Tax Invoice ${p.invoiceNumber}`, referenceInsuranceInvoiceStyles(), body);
}

function headerHtml(s: PdfTemplateSettings, labelAr: string, labelEn: string, num: string, date: string) {
  const logo = s.logoUrl
    ? `<img src="${s.logoUrl}" alt="logo" style="max-height:62px;max-width:140px;object-fit:contain;margin-bottom:8px;display:block;" />`
    : "";
  return `
    <div class="header">
      <div class="company-info">
        ${logo}
        <h1>${s.companyName}</h1>
        <div class="en-name">${s.companyNameEn}</div>
        <div class="details">
          السجل التجاري / CR: ${s.commercialReg}<br/>
          الرقم الضريبي / VAT: ${s.vatNumber}<br/>
          ${s.phone} • ${s.email}<br/>
          ${s.address}
        </div>
      </div>
      <div class="doc-badge">
        <div class="label-ar">${labelAr}</div>
        <div class="label-en">${labelEn}</div>
        <div class="number">${num}</div>
        <div class="date">${date}</div>
      </div>
    </div>`;
}

function insuranceBanner(insuranceCompany: string, claimNumber: string, policyNumber?: string | null) {
  return `
    <div class="insurance-banner">
      <div class="icon">🛡️</div>
      <div class="info">
        <div class="label">شركة التأمين / Insurance Provider</div>
        <div class="name">${e(insuranceCompany)}</div>
      </div>
      <div class="meta">
        <div>Claim #: <b>${e(claimNumber)}</b></div>
        ${policyNumber ? `<div>Policy: <b>${e(policyNumber)}</b></div>` : ""}
      </div>
    </div>`;
}

function vehicleCard(v: ClaimVehicleInfo) {
  const title = [v.make, v.model].filter(Boolean).join(" ") || "—";
  return `
    <div class="vehicle-card">
      <div class="left">
        <div class="lbl">المركبة / Vehicle</div>
        <div class="val">${e(title)} ${v.year ? `· ${e(v.year)}` : ""}</div>
        ${v.color ? `<div style="margin-top:4px;font-size:11px;color:#8a6d3b">اللون: <b>${e(v.color)}</b></div>` : ""}
        ${v.vin ? `<div style="margin-top:2px;font-size:10px;color:#8a6d3b;direction:ltr;text-align:right">VIN: <b>${e(v.vin)}</b></div>` : ""}
      </div>
      <div class="right">
        <div class="k">رقم اللوحة</div>
        <div class="v"><span class="vehicle-plate">${e(v.plate || "—")}</span></div>
      </div>
    </div>`;
}


function footerHtml(s: PdfTemplateSettings) {
  return `<div class="footer">${s.companyName} • ${s.companyNameEn} • © ${new Date().getFullYear()}</div>`;
}

function stampBlock(s: PdfTemplateSettings, on: boolean) {
  if (!s.stampEnabled || !on || !s.stampUrl) return "";
  return `<div class="stamp-bottom-right"><img src="${s.stampUrl}" alt="ختم" /></div>`;
}

// ─────────────────────────────────────────────────────────────────
// 1) تقدير المطالبة
// ─────────────────────────────────────────────────────────────────
export function getClaimEstimateHtml(p: ClaimEstimatePayload): string {
  // ملاحظة: تم تعطيل القالب المخصص لتقدير المطالبة لتوحيد الشكل الجديد
  // لكلا النوعين LUMP SUM و UPL مع الحفاظ على الختم لكل واحد.
  const s = getTemplateSettings();
  const styles = baseStyles(s);

  let itemsHtml = "";
  let subtotal = 0;

  if (p.estimationType === "upl" && p.uplItems?.length) {
    itemsHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:8%">#</th>
            <th>البند / Item</th>
            <th style="width:12%">الكمية</th>
            <th style="width:18%">سعر الوحدة</th>
            <th style="width:18%">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${p.uplItems
            .map((it, i) => {
              const total = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
              subtotal += total;
              return `<tr>
                <td>${i + 1}</td>
                <td>${it.description}</td>
                <td>${it.quantity}</td>
                <td style="font-family:'Inter';direction:ltr">${it.unit_price.toFixed(3)}</td>
                <td style="font-family:'Inter';direction:ltr"><b>${total.toFixed(3)}</b></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  } else {
    subtotal = p.lumpSumAmount || 0;
    itemsHtml = `
      <table>
        <thead><tr><th>الوصف / Description</th><th style="width:25%">الإجمالي / Total</th></tr></thead>
        <tbody>
          <tr>
            <td>تقدير شامل لإصلاح أضرار المركبة بناءً على المعاينة الفنية<br/><span style="color:#888;font-size:10px">Lump-sum estimation based on technical inspection</span></td>
            <td style="font-family:'Inter';direction:ltr;font-weight:700">${subtotal.toFixed(3)} OMR</td>
          </tr>
        </tbody>
      </table>`;
  }

  const deductible = p.deductibleAmount || 0;
  const netAmount = subtotal - deductible;

  const damagePhotosHtml = (p.damagePhotos || []).slice(0, 6).length
    ? `
      <div class="section-title">صور الأضرار / Damage Photos</div>
      <div class="photos-grid">
        ${(p.damagePhotos || [])
          .slice(0, 6)
          .map((url, i) => `<div class="ph"><img src="${url}" alt="damage ${i + 1}" /><div class="cap">صورة ${i + 1}</div></div>`)
          .join("")}
      </div>`
    : "";

  const body = `
    <div class="page">
      ${s.showWatermark ? `<div class="watermark">ESTIMATE</div>` : ""}
      ${headerHtml(s, "تقدير مطالبة", "CLAIM ESTIMATE", p.claimNumber, p.date)}
      ${insuranceBanner(p.insuranceCompany, p.claimNumber, p.policyNumber)}
      ${vehicleCard(p.vehicle)}

      <div class="section-title">بيانات الحادث / Incident Information</div>
      <div class="info-grid">
        ${p.incidentDate ? `<div class="info-row"><span class="label">تاريخ التقدير</span><span class="value">${p.incidentDate}</span></div>` : ""}
        ${p.incidentLocation ? `<div class="info-row"><span class="label">موقع الحادث</span><span class="value">${p.incidentLocation}</span></div>` : ""}
        ${p.policyExpiry ? `<div class="info-row"><span class="label">انتهاء الوثيقة</span><span class="value">${p.policyExpiry}</span></div>` : ""}
        ${p.adjusterName ? `<div class="info-row"><span class="label">المُسوِّي</span><span class="value">${p.adjusterName} ${p.adjusterPhone ? `(${p.adjusterPhone})` : ""}</span></div>` : ""}
        ${p.customerName ? `<div class="info-row"><span class="label">مالك المركبة</span><span class="value">${p.customerName} ${p.customerPhone ? `(${p.customerPhone})` : ""}</span></div>` : ""}
      </div>
      ${p.incidentDescription ? `<div class="notes-box"><b>وصف الحادث:</b> ${p.incidentDescription}</div>` : ""}

      <div class="section-title">${p.estimationType === "upl" ? "بنود التقدير (UPL)" : "التقدير الإجمالي (Lump Sum)"}</div>
      ${itemsHtml}

      <div class="totals-box">
        <div class="totals-row"><span>الإجمالي المقدّر / Estimated</span><span class="amount">${subtotal.toFixed(3)} OMR</span></div>
        ${deductible > 0 ? `<div class="totals-row"><span>التحمّل / Deductible</span><span class="amount">- ${deductible.toFixed(3)}</span></div>` : ""}
        ${p.approvedAmount != null ? `<div class="totals-row"><span>المعتمد من التأمين / Approved</span><span class="amount" style="color:#2e7d32">${Number(p.approvedAmount).toFixed(3)}</span></div>` : ""}
        <div class="totals-row total"><span>الصافي المستحق / Net Due</span><span class="amount">${netAmount.toFixed(3)} OMR</span></div>
      </div>
      ${p.estimationType ? `<div class="estimation-badge"><span>${p.estimationType === "upl" ? "UPL" : "LUMP SUM"}</span></div>` : ""}

      ${damagePhotosHtml}
      ${p.notes ? `<div class="notes-box"><b>ملاحظات:</b> ${p.notes}</div>` : ""}

      <div class="signature-area">
        <div class="sig">
          <div class="name">المُقدِّر / Estimator</div>
          <div class="area">${s.signatureUrl ? `<img src="${s.signatureUrl}" alt="signature"/>` : ""}</div>
          <div class="lbl">${s.responsibleName || "اسم المسؤول"}</div>
        </div>
        <div class="sig">
          <div class="name">ختم الورشة / Workshop Stamp</div>
          <div class="area">${s.stampUrl ? `<img src="${s.stampUrl}" alt="stamp"/>` : ""}</div>
          <div class="lbl">${s.companyName}</div>
        </div>
        <div class="sig">
          <div class="name">مندوب التأمين / Insurance Rep</div>
          <div class="area"></div>
          <div class="lbl">التوقيع والختم</div>
        </div>
      </div>
      ${footerHtml(s)}
    </div>`;
  return wrapHtml(`تقدير ${p.claimNumber}`, styles, body);
}

// ─────────────────────────────────────────────────────────────────
// 2) فاتورة ضريبية لشركة التأمين (مع QR ZATCA)
//    تصميم Slate موحّد — مستند محاسبي هادئ بلون واحد + رمادي محايد.
//    أنماط الفاتورة معزولة في كتلة CSS خاصة بها ولا تعتمد على baseStyles.
// ─────────────────────────────────────────────────────────────────
export async function getClaimTaxInvoiceHtml(p: ClaimTaxInvoicePayload): Promise<string> {
  const s = getTemplateSettings();
  const vatRate = (p.vatRate ?? s.vatRate ?? 5) / 100;

  let subtotal = 0;
  const itemsHtml = p.items
    .map((it, i) => {
      const total = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
      subtotal += total;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="desc">${e(it.description)}</td>
        <td class="qty">${it.quantity}</td>
        <td class="rate">${Number(it.unit_price).toFixed(3)}</td>
        <td class="total">${total.toFixed(3)}</td>
      </tr>`;
    })
    .join("");

  const vatAmount = subtotal * vatRate;
  const total = subtotal + vatAmount;

  // Secure QR — يحتوي رابط مشفّر فقط (لا يكشف رقم/ID الفاتورة)
  const QRCodeLib = (await import("qrcode")).default;
  const verifyUrl = p.verifyUrl && p.verifyUrl.trim().length > 0
    ? p.verifyUrl
    : (typeof window !== "undefined" ? `${window.location.origin}/invoice/view/unknown` : "");
  const qrDataUrl = verifyUrl
    ? await QRCodeLib.toDataURL(verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 220, color: { dark: "#000000", light: "#FFFFFF" } })
    : await buildZatcaQrDataUrl({
        sellerName: s.companyName,
        vatNumber: s.vatNumber,
        timestamp: new Date(p.invoiceDate).toISOString(),
        total,
        vat: vatAmount,
      });

  return renderReferenceInsuranceInvoice(
    {
      ...p,
      qrDataUrl,
    },
    s,
  );

  const logoBlock = s.logoUrl
    ? `<img src="${s.logoUrl}" alt="logo" class="logo" />`
    : "";

  const stampHtml = (s.stampEnabled && s.stampOnInvoice && s.stampUrl)
    ? `<div class="stamp"><img src="${s.stampUrl}" alt="ختم" /></div>`
    : "";

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Noto Sans Arabic','Inter','Segoe UI',Tahoma,sans-serif;direction:rtl;color:#1e293b;background:#f8fafc}
    .page{width:210mm;min-height:297mm;margin:10mm auto;background:white;border:1px solid #e2e8f0;position:relative;display:flex;flex-direction:column}
    .mono,.num,.rate,.total,.amount,.plate-text{font-family:'Inter','Noto Sans Arabic',monospace;font-variant-numeric:tabular-nums}

    /* HEADER */
    .header{padding:14mm 14mm 8mm;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #f1f5f9;gap:18px}
    .header .brand h1{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:2px;line-height:1.3}
    .header .brand .en{font-size:10.5px;color:#64748b;font-weight:500;margin-bottom:6px;font-family:'Inter',sans-serif}
    .header .brand .meta{font-size:9px;color:#94a3b8;line-height:1.7}
    .header .logo{max-height:82px;max-width:170px;object-fit:contain;margin-bottom:6px;display:block}
    .badge{text-align:center}
    .badge .box{background:#1e293b;color:#ffffff;padding:14px 22px;border-radius:3px;display:inline-block;min-width:170px}
    .badge .lbl-ar{font-size:9.5px;opacity:0.85;line-height:1.1;margin-bottom:1px;color:#ffffff}
    .badge .lbl-en{font-size:8.5px;opacity:0.75;letter-spacing:0.6px;font-family:Arial,sans-serif;margin-bottom:6px;color:#ffffff}
    .badge .number{font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif;display:block;line-height:1.2;unicode-bidi:plaintext;text-align:center}
    .badge .date{font-size:10px;color:#475569;margin-top:5px;font-family:Arial,sans-serif;unicode-bidi:plaintext}

    /* INSURANCE BAR */
    .ins-bar{margin:8mm 14mm 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;display:flex;justify-content:space-between;align-items:center}
    .ins-bar .left{display:flex;align-items:center;gap:14px}
    .ins-bar .badge-icon{width:72px;height:72px;border-radius:50%;background:#ffffff;display:flex;align-items:center;justify-content:center;font-size:22px;color:#475569;overflow:hidden;border:2px solid #cbd5e1;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
    .ins-bar .badge-icon img{width:100%;height:100%;object-fit:contain;display:block;padding:4px;background:#fff}
    .ins-bar .lbl{font-size:9px;color:#64748b;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:2px;font-family:'Inter',sans-serif}
    .ins-bar .name{font-size:13px;font-weight:700;color:#1e293b}
    .ins-bar .meta{display:flex;gap:24px}
    .ins-bar .meta .col{text-align:right}
    .ins-bar .meta .val{font-size:11.5px;font-weight:600;color:#334155;font-family:'Inter',sans-serif;direction:ltr;text-align:right}

    /* VEHICLE */
    .vehicle{margin:5mm 14mm 0;border:1px solid #e2e8f0;border-radius:3px;display:flex;overflow:hidden;background:white}
    .vehicle .plate{background:#1e293b;color:white;padding:14px 18px;display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:155px;gap:6px}
    .vehicle .plate .box{border:1px solid rgba(255,255,255,0.3);border-radius:3px;padding:6px 14px}
    .vehicle .plate .plate-text{font-size:16px;font-weight:700;letter-spacing:2.5px;direction:ltr}
    .vehicle .plate .cap{font-size:8.5px;opacity:0.75;letter-spacing:0.4px;font-family:'Inter',sans-serif}
    .vehicle .info{flex:1;padding:14px 18px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .vehicle .info .cell .k{font-size:9px;color:#64748b;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:3px;font-family:'Inter',sans-serif}
    .vehicle .info .cell .v{font-size:12px;font-weight:700;color:#1e293b}
    .vehicle .info .cell.right{text-align:left}

    /* LPO INLINE */
    .lpo{margin:4mm 14mm 0;padding:9px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;display:flex;justify-content:space-between;align-items:center;font-size:11px}
    .lpo .k{color:#64748b;font-weight:600}
    .lpo .v{font-family:'Inter',sans-serif;font-weight:700;color:#1e293b;direction:ltr}

    /* BILL TO */
    .billto{margin:6mm 14mm 0;padding-top:6mm;border-top:1px solid #f1f5f9;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:18px}
    .billto .cell .k{font-size:8.5px;color:#94a3b8;letter-spacing:0.4px;text-transform:uppercase;font-weight:700;margin-bottom:3px;font-family:'Inter',sans-serif}
    .billto .cell .v{font-size:10.5px;color:#334155;font-weight:500}
    .billto .cell.main .v{font-weight:700;color:#1e293b;font-size:11.5px}
    .billto .cell .sub{font-size:10px;color:#94a3b8;margin-top:2px}
    .billto .cell.end{text-align:left}

    /* TABLE */
    .items{margin:7mm 14mm 0;flex:1}
    table{width:100%;border-collapse:collapse;font-size:10px}
    thead tr{border-bottom:1px solid #e2e8f0}
    thead th{padding:0 8px 10px;text-align:right;font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;text-transform:uppercase;font-family:'Inter',sans-serif}
    thead th.c{text-align:center}
    thead th.l{text-align:left}
    tbody tr{border-bottom:1px solid #f1f5f9}
    tbody td{padding:9px 8px;vertical-align:middle}
    tbody td.num{text-align:center;color:#94a3b8;width:32px;font-size:10.5px}
    tbody td.desc{color:#1e293b;font-weight:500}
    tbody td.qty{text-align:center;color:#475569;width:60px}
    tbody td.rate{text-align:left;color:#475569;width:90px;direction:ltr}
    tbody td.total{text-align:left;color:#1e293b;font-weight:700;width:90px;direction:ltr}

    /* TOTALS + QR */
    .summary{margin-top:auto;padding:8mm 14mm;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
    .summary .qr{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
    .summary .qr img{width:96px;height:96px;border:1px solid #e2e8f0;padding:3px;background:white}
    .summary .qr .cap{font-size:8.5px;color:#94a3b8;letter-spacing:0.4px;font-family:'Inter',sans-serif}
    .summary .totals{width:300px;display:flex;flex-direction:column;gap:6px}
    .summary .totals .row{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:10.5px;color:#475569}
    .summary .totals .row .amount{color:#1e293b;font-weight:600}
    .summary .totals .grand{background:#1e293b;color:white;padding:14px 16px;border-radius:3px;display:flex;justify-content:space-between;align-items:center;margin-top:4px}
    .summary .totals .grand .lbl-ar{font-size:11px;font-weight:600;opacity:0.85;line-height:1.2;margin-bottom:2px}
    .summary .totals .grand .lbl-en{font-size:8.5px;opacity:0.6;letter-spacing:0.5px;text-transform:uppercase;font-family:'Inter',sans-serif}
    .summary .totals .grand .val{text-align:left}
    .summary .totals .grand .val .big{font-size:20px;font-weight:700;letter-spacing:0.5px}
    .summary .totals .grand .val .cur{font-size:9.5px;opacity:0.7;font-family:'Inter',sans-serif}

    /* LEGAL FOOTER */
    .legal{padding:6mm 14mm 4mm;text-align:center;font-size:9.5px;color:#94a3b8;line-height:1.7}
    .legal strong{color:#475569}
    .footer{padding:0 14mm 8mm;text-align:center;font-size:9px;color:#cbd5e1;border-top:1px solid #f1f5f9;padding-top:6px}

    /* STAMP */
    .stamp{position:absolute;bottom:38mm;left:14mm;width:90px;opacity:0.92}
    .stamp img{max-width:100%;max-height:90px}

    @media print{body{background:white}.page{margin:0;border:none}}
  `;

  const body = `
    <div class="page">

      <!-- HEADER -->
      <div class="header">
        <div class="brand">
          ${logoBlock}
          <h1>${e(s.companyName)}</h1>
          <div class="en">${e(s.companyNameEn)}</div>
          <div class="meta">
            السجل التجاري / CR: ${e(s.commercialReg)}<br/>
            الرقم الضريبي / VAT: ${e(s.vatNumber)}<br/>
            ${e(s.phone)} • ${e(s.email)}<br/>
            ${e(s.address)}
          </div>
        </div>
        <div class="badge">
          <div class="box">
            <div class="lbl-ar">فاتورة ضريبية</div>
            <div class="lbl-en">TAX INVOICE</div>
            <div class="number"><bdi>${e(p.invoiceNumber && p.invoiceNumber.trim() ? p.invoiceNumber : "—")}</bdi></div>
          </div>
          <div class="date"><bdi>${e(p.invoiceDate)}</bdi></div>
        </div>
      </div>

      <!-- INSURANCE -->
      <div class="ins-bar">
        <div class="left">
          <div class="badge-icon">${p.insuranceCompanyLogoUrl ? `<img src="${e(p.insuranceCompanyLogoUrl)}" alt="logo" />` : "◆"}</div>
          <div>
            <div class="lbl">شركة التأمين / Insurance Provider</div>
            <div class="name">${e(p.insuranceCompany)}</div>
          </div>
        </div>
        <div class="meta">
          <div class="col">
            <div class="lbl">CLAIM #</div>
            <div class="val">${e(p.claimNumber)}</div>
          </div>
          ${p.lpoNumber ? `
          <div class="col">
            <div class="lbl">L.P.O</div>
            <div class="val">${e(p.lpoNumber)}</div>
          </div>` : ""}
        </div>
      </div>

      <!-- VEHICLE -->
      <div class="vehicle">
        <div class="plate">
          <div class="box"><span class="plate-text">${e(p.vehicle.plate || "—")}</span></div>
          <div class="cap">رقم اللوحة / PLATE</div>
        </div>
        <div class="info">
          <div class="cell">
            <div class="k">Vehicle / المركبة</div>
            <div class="v">${e([p.vehicle.make, p.vehicle.model].filter(Boolean).join(" ") || "—")}${p.vehicle.year ? ` · ${e(p.vehicle.year)}` : ""}</div>
          </div>
          <div class="cell right">
            <div class="k">Color / اللون</div>
            <div class="v" style="font-family:'Inter',sans-serif">${e(vehicleColorToEn(p.vehicle.color) || "—")}</div>
          </div>
          <div class="cell" style="grid-column:1/-1">
            <div class="k">VIN / رقم الهيكل</div>
            <div class="v mono" style="direction:ltr;font-size:11.5px;text-align:left;font-family:'Inter',sans-serif">${e(p.vehicle.vin || "—")}</div>
          </div>
        </div>
      </div>

      <!-- BILL TO -->
      <div class="billto">
        <div class="cell main">
          <div class="k">بيانات العميل / Bill To</div>
          <div class="v">${e(p.insuranceCompany)}</div>
          ${p.insuranceCompanyAddress ? `<div class="sub">${e(p.insuranceCompanyAddress)}</div>` : ""}
          ${p.customerName ? `<div class="sub">المؤمَّن له: ${e(p.customerName)}</div>` : ""}
        </div>
        <div class="cell">
          <div class="k">Tax Reg / VAT</div>
          <div class="v mono" style="direction:ltr;text-align:right">${e(p.insuranceCompanyVat || "—")}</div>
        </div>
        <div class="cell">
          <div class="k">Commercial ID</div>
          <div class="v mono" style="direction:ltr;text-align:right">${e(p.insuranceCompanyCR || "—")}</div>
        </div>
        <div class="cell end">
          <div class="k">Due Date</div>
          <div class="v mono" style="direction:ltr">${e(p.dueDate || "—")}</div>
          ${p.insuranceCompanyPhone ? `<div class="sub" style="direction:ltr">${e(p.insuranceCompanyPhone)}</div>` : ""}
        </div>
      </div>

      <!-- ITEMS -->
      <div class="items">
        <table>
          <thead>
            <tr>
              <th class="c" style="width:32px">#</th>
              <th>الوصف / Description</th>
              <th class="c" style="width:60px">الكمية / Qty</th>
              <th class="l" style="width:90px">سعر الوحدة / Rate</th>
              <th class="l" style="width:90px">الإجمالي / Total</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>

      <!-- SUMMARY -->
      <div class="summary">
        <div class="qr">
          <img src="${qrDataUrl}" alt="Secure Invoice QR" />
          <div class="cap">امسح للتحقق / Scan to verify</div>
        </div>
        <div class="totals">
          <div class="row">
            <span>المجموع الفرعي / Subtotal</span>
            <span class="amount">${subtotal.toFixed(3)} OMR</span>
          </div>
          <div class="row">
            <span>ضريبة القيمة المضافة / VAT (${(vatRate * 100).toFixed(0)}%)</span>
            <span class="amount">${vatAmount.toFixed(3)} OMR</span>
          </div>
          <div class="grand">
            <div>
              <div class="lbl-ar">الإجمالي المستحق</div>
              <div class="lbl-en">Total Payable</div>
            </div>
            <div class="val">
              <div class="big">${total.toFixed(3)}</div>
              <div class="cur">OMR / ريال عُماني</div>
            </div>
          </div>
        </div>
      </div>

      <!-- LEGAL -->
      <div class="legal">
        <strong>إفادة قانونية:</strong> هذه فاتورة ضريبية صادرة وفقاً للأنظمة المعمول بها في سلطنة عُمان. يُرجى التحقق عبر مسح رمز QR.
        ${p.notes ? `<br/><strong>ملاحظات:</strong> ${e(p.notes)}` : ""}
      </div>
      <div class="footer">${e(s.companyName)} • ${e(s.companyNameEn)} • © ${new Date().getFullYear()}</div>

      ${stampHtml}
    </div>`;

  return wrapHtml(`فاتورة ${p.invoiceNumber}`, styles, body);
}


// ─────────────────────────────────────────────────────────────────
// 3) محضر تسليم
// ─────────────────────────────────────────────────────────────────
export function getClaimDeliveryHtml(p: ClaimDeliveryPayload): string {
  try {
    const custom = renderWithCustomTemplate("delivery_proof", { ...p, ...getTemplateSettings() }, `Delivery ${p.claimNumber}`);
    if (custom) return custom;
  } catch {}
  const s = getTemplateSettings();
  const styles = baseStyles(s);

  const renderPhotoGrid = (photos: string[], label: string) => {
    if (!photos.length) return "";
    return `
      <div class="section-title">${label}</div>
      <div class="photos-grid">
        ${photos.slice(0, 6).map((u, i) => `<div class="ph"><img src="${u}" alt="${label} ${i + 1}" /><div class="cap">${label} ${i + 1}</div></div>`).join("")}
      </div>`;
  };

  const body = `
    <div class="page">
      ${s.showWatermark ? `<div class="watermark">DELIVERY</div>` : ""}
      ${headerHtml(s, "محضر تسليم", "DELIVERY PROOF", p.claimNumber, p.deliveryDate)}
      ${insuranceBanner(p.insuranceCompany, p.claimNumber)}
      ${vehicleCard(p.vehicle)}

      <div class="section-title">بيانات المُستلم / Receiver Information</div>
      <div class="info-grid">
        <div class="info-row"><span class="label">اسم المستلم</span><span class="value">${p.receiverName || "—"}</span></div>
        <div class="info-row"><span class="label">رقم الهوية</span><span class="value" style="font-family:'Inter';direction:ltr;text-align:right">${p.receiverIdNumber || "—"}</span></div>
        ${p.customerName ? `<div class="info-row"><span class="label">مالك المركبة</span><span class="value">${p.customerName}</span></div>` : ""}
        <div class="info-row"><span class="label">تاريخ التسليم</span><span class="value">${p.deliveryDate}</span></div>
      </div>

      ${p.receiverIdPhotoUrl ? `
        <div class="section-title">صورة الهوية / ID Photo</div>
        <div style="text-align:center"><img src="${p.receiverIdPhotoUrl}" alt="ID" style="max-width:340px;max-height:200px;border:1px solid #eee;border-radius:8px;padding:4px;background:white"/></div>
      ` : ""}

      ${renderPhotoGrid(p.deliveryPhotos || [], "صور التسليم / Delivery")}
      ${renderPhotoGrid(p.satisfactionPhotos || [], "صور إقرار الرضاء / Satisfaction")}

      ${p.notes ? `<div class="notes-box"><b>ملاحظات التسليم:</b> ${p.notes}</div>` : ""}

      <div class="notes-box" style="margin-top:14px;border-right-color:#0d47a1;background:#e3f2fd;color:#0d47a1">
        <b>إقرار:</b> أُقرّ أنا الموقّع أدناه باستلام المركبة الموصوفة أعلاه بحالتها الظاهرة بعد إتمام أعمال الإصلاح المطلوبة بناءً على مطالبة التأمين رقم <b>${p.claimNumber}</b>،
        وأعفي الورشة من أي مسؤولية عن أعطال أو ملاحظات لاحقة لم تُذكر في هذا المحضر.
      </div>

      <div class="signature-area">
        <div class="sig">
          <div class="name">توقيع المستلم / Receiver Signature</div>
          <div class="area"></div>
          <div class="lbl">${p.receiverName || "—"}</div>
        </div>
        <div class="sig">
          <div class="name">ختم الورشة / Workshop Stamp</div>
          <div class="area">${s.stampUrl ? `<img src="${s.stampUrl}" alt="stamp"/>` : ""}</div>
          <div class="lbl">${s.companyName}</div>
        </div>
        <div class="sig">
          <div class="name">مسؤول التسليم</div>
          <div class="area">${s.signatureUrl ? `<img src="${s.signatureUrl}" alt="signature"/>` : ""}</div>
          <div class="lbl">${s.responsibleName || "—"}</div>
        </div>
      </div>
      ${footerHtml(s)}
    </div>`;
  return wrapHtml(`تسليم ${p.claimNumber}`, styles, body);
}
