// Insurance company account statement (PDF/HTML)
// Uses shared template settings for logo, colors, stamp.
import { getTemplateSettings, type PdfTemplateSettings } from "./pdfGenerator";
import { renderWithCustomTemplate } from "./printTemplates/resolver";
import { splitVatInclusiveAmount } from "./workOrderCosting";

export interface StatementClaim {
  claim_number: string;
  created_at: string;
  estimated_amount: number;
  approved_amount: number;
  status: string;
}

export interface StatementPayment {
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  status: string;
  reference_number?: string | null;
}

export interface StatementInvoice {
  invoice_number: string;
  claim_number?: string | null;
  issued_at: string;
  subtotal: number;
  vat: number;
  total: number;
  status: string;
}

export interface StatementData {
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  commercialRegistration?: string | null;
  taxNumber?: string | null;
  poBox?: string | null;
  branchCity?: string | null;
  bankName?: string | null;
  iban?: string | null;
  bankAccountName?: string | null;
  periodFrom?: string;
  periodTo?: string;
  /** نسبة VAT المستخدمة لاحتساب الدين على المطالبات بدون فاتورة (افتراضي 0.05). */
  vatRate?: number;
  claims: StatementClaim[];
  /** الفواتير الضريبية المصدرة لمطالبات هذه الشركة — هي مصدر الدين الفعلي. */
  invoices?: StatementInvoice[];
  payments: StatementPayment[];
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "تحويل بنكي",
  cheque: "شيك",
  offset: "مقاصة",
  cash: "نقدي",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "معلق",
  cleared: "محصل",
  bounced: "مرتجع",
  approved: "معتمدة",
  paid: "مدفوعة",
  rejected: "مرفوضة",
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
import { formatDateLatin } from "./numberUtils";
function fmtDate(d: string) { return formatDateLatin(d); }

export function getInsuranceStatementHtml(data: StatementData): string {
  const vatRate0 = data.vatRate ?? 0.05;
  const activeInvoices0 = (data.invoices ?? []).filter((i) => i.status !== "cancelled");
  const invoicedClaimSet0 = new Set(activeInvoices0.map((i) => (i.claim_number ?? "").trim()).filter(Boolean));
  const invoiceDebit0 = activeInvoices0.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const fallbackDebit0 = data.claims
    .filter((c) => !invoicedClaimSet0.has((c.claim_number ?? "").trim()))
    .reduce((s, c) => {
      return s + splitVatInclusiveAmount(Number(c.approved_amount) || Number(c.estimated_amount) || 0, vatRate0).totalIncludingVat;
    }, 0);
  const totalInvoiced = +(invoiceDebit0 + fallbackDebit0).toFixed(3);
  const totalPaid = data.payments
    .filter((p: any) => p.status !== "bounced")
    .reduce((s, p: any) => s + (Number(p.amount) || 0), 0);
  try {
    const custom = renderWithCustomTemplate("insurance_statement", {
      insuranceCompany: (data as any).companyName || (data as any).insuranceCompany || "—",
      date: new Date().toLocaleDateString("en-GB"),
      period: (data as any).period || "—",
      claimsCount: data.claims.length,
      totalInvoiced, totalPaid, balance: +(totalInvoiced - totalPaid).toFixed(3),
    }, "Insurance Statement");
    if (custom) return custom;
  } catch {}
  const s: PdfTemplateSettings = getTemplateSettings();

  // ── Build unified ledger — Single Source of Truth ──
  // Debit  = invoice.total (VAT-inclusive) for every active (non-cancelled) invoice.
  //          Claims without an invoice fall back to approved/estimated as a VAT-inclusive total.
  // Credit = every non-bounced claim payment.
  type Row = { date: string; ref: string; desc: string; debit: number; credit: number };
  const rows: Row[] = [];
  const vatRate = data.vatRate ?? 0.05;

  const invoices = (data.invoices ?? []).filter((i) => i.status !== "cancelled");
  const invoicedClaimNumbers = new Set(
    invoices.map((i) => (i.claim_number ?? "").trim()).filter(Boolean),
  );

  invoices.forEach((inv) => {
    if (Number(inv.total) > 0) {
      rows.push({
        date: inv.issued_at,
        ref: `FAT ${inv.invoice_number}${inv.claim_number ? ` / ${inv.claim_number}` : ""}`,
        desc: `فاتورة ضريبية — صافي ${fmt(Number(inv.subtotal) || 0)} + VAT ${fmt(Number(inv.vat) || 0)}`,
        debit: Number(inv.total) || 0,
        credit: 0,
      });
    }
  });

  data.claims.forEach((c) => {
    if (invoicedClaimNumbers.has((c.claim_number ?? "").trim())) return; // عرض المطالبة عن طريق فاتورتها فقط
    const fallback = splitVatInclusiveAmount(Number(c.approved_amount) || Number(c.estimated_amount) || 0, vatRate);
    if (fallback.totalIncludingVat <= 0) return;
    rows.push({
      date: c.created_at,
      ref: c.claim_number,
      desc: `Claim without invoice — Subtotal ${fmt(fallback.subtotalBeforeVat)} + VAT ${fmt(fallback.vatAmount)}`,
      debit: fallback.totalIncludingVat,
      credit: 0,
    });
  });

  data.payments
    .filter((p) => p.status !== "bounced")
    .forEach((p) => {
      rows.push({
        date: p.payment_date,
        ref: p.payment_number,
        desc: `دفعة - ${METHOD_LABELS[p.payment_method] ?? p.payment_method}${p.reference_number ? ` (${p.reference_number})` : ""}`,
        debit: 0,
        credit: Number(p.amount) || 0,
      });
    });

  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = 0;
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const finalBalance = totalDebit - totalCredit;

  const periodLabel = data.periodFrom || data.periodTo
    ? `${data.periodFrom ? fmtDate(data.periodFrom) : "البداية"} → ${data.periodTo ? fmtDate(data.periodTo) : "اليوم"}`
    : "كل الفترات";

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>كشف حساب - ${data.companyName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap');
    @page{size:A4 landscape;margin:0}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Noto Sans Arabic',Tahoma,sans-serif;direction:rtl;color:#1a1a2e;background:#f8f9fa;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{width:297mm;min-height:210mm;margin:8mm auto;background:white;padding:10mm 12mm;box-shadow:0 2px 20px rgba(0,0,0,0.1);position:relative}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${s.primaryColor};padding-bottom:15px;margin-bottom:25px}
    .company h1{font-size:20px;font-weight:700}
    .company .details{font-size:10px;color:#888;line-height:1.7;margin-top:6px}
    .badge{background:linear-gradient(135deg,${s.primaryColor},#b8902f);color:white;padding:12px 22px;border-radius:8px;text-align:center}
    .badge .t{font-size:13px;font-weight:600}
    .badge .d{font-size:10px;opacity:0.9;margin-top:4px}
    .logo{max-height:60px;margin-bottom:6px}

    .info-block{background:#f8f9fa;border-right:4px solid ${s.primaryColor};padding:14px 16px;border-radius:6px;margin-bottom:18px}
    .info-block h3{font-size:14px;color:${s.primaryColor};margin-bottom:8px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:11.5px}
    .info-row{display:flex;gap:8px;padding:2px 0}
    .info-row .l{color:#888;min-width:110px}
    .info-row .v{font-weight:600}

    table{width:100%;border-collapse:collapse;margin:14px 0;font-size:11px}
    thead th{background:#1a1a2e;color:white;padding:9px 10px;text-align:right;font-weight:600;font-size:10.5px}
    tbody td{padding:8px 10px;border-bottom:1px solid #eee}
    tbody tr:nth-child(even){background:#fafbfc}
    .num{text-align:left;font-family:monospace;direction:ltr}
    .debit{color:#c0392b}
    .credit{color:#27ae60}

    .totals{margin-top:18px;background:linear-gradient(135deg,#1a1a2e,#2c3e50);color:white;padding:16px 20px;border-radius:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
    .totals .item{text-align:center}
    .totals .item .l{font-size:11px;opacity:0.8;margin-bottom:4px}
    .totals .item .v{font-size:17px;font-weight:700;direction:ltr}
    .balance{background:${s.primaryColor};padding:14px 20px;border-radius:8px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;color:white}
    .balance .l{font-size:13px;font-weight:600}
    .balance .v{font-size:20px;font-weight:700;direction:ltr}

    .footer{margin-top:30px;padding-top:14px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:10px;color:#888}
    .stamp-area{margin-top:40px;display:flex;justify-content:space-between;align-items:end}
    .signature-box{text-align:center;font-size:11px}
    .signature-box .line{border-top:1.5px solid #444;margin-top:50px;padding-top:6px;min-width:180px}
    .stamp-img{max-width:130px;max-height:130px;opacity:0.85}

    @media print { html,body{background:white!important;margin:0!important;padding:0!important} .page{box-shadow:none!important;margin:0!important;width:100%!important} }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company">
        ${s.logoUrl ? `<img class="logo" src="${s.logoUrl}" alt="logo" />` : ""}
        <h1>${s.companyName}</h1>
        <div class="details">
          ${s.address ?? ""}<br/>
          ${s.phone ? `هاتف: ${s.phone}` : ""}${s.email ? ` • ${s.email}` : ""}<br/>
          ${s.vatNumber ? `الرقم الضريبي: ${s.vatNumber}` : ""}
        </div>
      </div>
      <div class="badge">
        <div class="t">كشف حساب شركة تأمين</div>
        <div class="d">Insurance Account Statement</div>
        <div class="d" style="margin-top:8px">${formatDateLatin(new Date())}</div>
      </div>
    </div>

    <div class="info-block">
      <h3>بيانات شركة التأمين</h3>
      <div class="info-grid">
        <div class="info-row"><span class="l">اسم الشركة:</span><span class="v">${data.companyName}${data.branchCity ? ` — ${data.branchCity}` : ""}</span></div>
        <div class="info-row"><span class="l">جهة الاتصال:</span><span class="v">${data.contactPerson ?? "-"}</span></div>
        <div class="info-row"><span class="l">السجل التجاري:</span><span class="v">${data.commercialRegistration ?? "-"}</span></div>
        <div class="info-row"><span class="l">الرقم الضريبي:</span><span class="v">${data.taxNumber ?? "-"}</span></div>
        <div class="info-row"><span class="l">الهاتف:</span><span class="v">${data.phone ?? "-"}</span></div>
        <div class="info-row"><span class="l">البريد:</span><span class="v">${data.email ?? "-"}</span></div>
        ${data.address ? `<div class="info-row"><span class="l">العنوان:</span><span class="v">${data.address}</span></div>` : ""}
        ${data.poBox ? `<div class="info-row"><span class="l">ص.ب / الرمز البريدي:</span><span class="v">${data.poBox}</span></div>` : ""}
        <div class="info-row"><span class="l">الفترة:</span><span class="v">${periodLabel}</span></div>
        <div class="info-row"><span class="l">عدد المطالبات:</span><span class="v">${data.claims.length}</span></div>
      </div>
    </div>

    ${(data.bankName || data.iban) ? `
    <div class="info-block" style="border-right-color:#1e3a8a;background:#f0f7ff;">
      <h3 style="color:#1e3a8a;">بيانات التحويل البنكي / Bank Transfer</h3>
      <div class="info-grid">
        ${data.bankName ? `<div class="info-row"><span class="l">البنك:</span><span class="v">${data.bankName}</span></div>` : ""}
        ${data.bankAccountName ? `<div class="info-row"><span class="l">اسم الحساب:</span><span class="v">${data.bankAccountName}</span></div>` : ""}
        ${data.iban ? `<div class="info-row" style="grid-column:1/-1;"><span class="l">IBAN:</span><span class="v" style="font-family:monospace;direction:ltr;letter-spacing:1px;">${data.iban}</span></div>` : ""}
      </div>
    </div>` : ""}

    <h3 style="font-size:14px;color:${s.primaryColor};margin:14px 0 8px">حركة الحساب</h3>

    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>المرجع</th>
          <th>البيان</th>
          <th class="num">مدين (ر.ع)</th>
          <th class="num">دائن (ر.ع)</th>
          <th class="num">الرصيد</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:24px;color:#888">لا توجد حركات في هذه الفترة</td></tr>` : ""}
        ${rows.map((r) => {
          runningBalance += r.debit - r.credit;
          return `
            <tr>
              <td>${fmtDate(r.date)}</td>
              <td class="num">${r.ref}</td>
              <td>${r.desc}</td>
              <td class="num debit">${r.debit ? fmt(r.debit) : "-"}</td>
              <td class="num credit">${r.credit ? fmt(r.credit) : "-"}</td>
              <td class="num"><strong>${fmt(runningBalance)}</strong></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>

    <div class="totals">
      <div class="item"><div class="l">إجمالي المدين</div><div class="v debit">${fmt(totalDebit)}</div></div>
      <div class="item"><div class="l">إجمالي الدائن</div><div class="v credit">${fmt(totalCredit)}</div></div>
      <div class="item"><div class="l">عدد الحركات</div><div class="v">${rows.length}</div></div>
    </div>

    <div class="balance">
      <span class="l">${finalBalance >= 0 ? "الرصيد المستحق على شركة التأمين" : "رصيد لصالح شركة التأمين"}</span>
      <span class="v">${fmt(Math.abs(finalBalance))} ر.ع</span>
    </div>

    <div class="stamp-area">
      <div class="signature-box">
        <div>المحاسب / المسؤول</div>
        <div class="line">${s.responsibleName ?? ""}</div>
      </div>
      ${s.stampUrl ? `<img class="stamp-img" src="${s.stampUrl}" alt="ختم" />` : `<div class="signature-box"><div>ختم الورشة</div><div class="line">&nbsp;</div></div>`}
    </div>

    <div class="footer">
      <span>${s.footerText ?? ""}</span>
      <span>${s.companyName} • ${new Date().toLocaleString("ar-OM")}</span>
    </div>
  </div>

</body>
</html>`;
}
