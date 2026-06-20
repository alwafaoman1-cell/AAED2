// مولد كشف حساب العميل (PDF HTML قابل للطباعة) — RTL Arabic
import type { CustomerLedger } from "@/lib/customerLedger";
import type { Customer } from "@/lib/customersStore";
import { renderWithCustomTemplate } from "@/lib/printTemplates/resolver";
import { formatDateLatin } from "@/lib/numberUtils";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { vehiclesStore } from "@/lib/vehiclesStore";

function norm(s: string) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

const TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  work_order: "أمر عمل",
  receipt: "سند قبض",
  deposit: "عربون",
  credit_note: "إشعار دائن",
};

export function getAccountStatementHtml(customer: Customer, ledger: CustomerLedger): string {
  try {
    const totals = ledger.entries.reduce((acc, e) => {
      acc.totalInvoiced += e.debit || 0;
      acc.totalPaid += e.credit || 0;
      return acc;
    }, { totalInvoiced: 0, totalPaid: 0 });
    const balance = ledger.entries.length ? ledger.entries[ledger.entries.length - 1].balance : 0;
    const custom = renderWithCustomTemplate("account_statement", {
      customerName: customer.name,
      customerPhone: customer.phone,
      date: new Date().toLocaleDateString("en-GB"),
      period: "حتى تاريخ الكشف",
      totalInvoiced: totals.totalInvoiced,
      totalPaid: totals.totalPaid,
      balance,
    }, `Statement ${customer.name}`);
    if (custom) return custom;
  } catch {}
  const today = formatDateLatin(new Date());

  // Customer-related vehicles & orders
  const k = norm(customer.name);
  const customerOrders = getWorkOrders().filter((o) => norm(o.customer) === k)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const customerVehicles = vehiclesStore.getAll().filter((v) => norm(v.owner) === k);

  const vehicleRows = customerVehicles.map((v) => {
    const vOrders = customerOrders.filter((o) => o.plate === v.plate);
    const totalV = vOrders.reduce((s, o) => s + (o.totalCost || 0), 0);
    return `<tr>
      <td style="text-align:center;font-family:monospace">${v.plate}</td>
      <td>${v.type || "-"}</td>
      <td style="text-align:center">${(v as any).year || "-"}</td>
      <td style="text-align:center;font-weight:700;color:#0369a1">${vOrders.length}</td>
      <td style="text-align:center">${vOrders[0]?.entryDate || v.lastVisit || "-"}</td>
      <td style="text-align:left;font-weight:600">${totalV.toFixed(3)}</td>
    </tr>`;
  }).join("");

  const visitsRows = customerOrders.map((o, idx) => `<tr>
    <td style="text-align:center">${idx + 1}</td>
    <td style="text-align:center;font-family:monospace;color:#d4a14a">${o.id}</td>
    <td style="text-align:center">${o.entryDate}</td>
    <td>${(o.vehicleType + " " + o.model).trim() || "-"}</td>
    <td style="text-align:center;font-family:monospace">${o.plate}</td>
    <td>${o.serviceType || "-"}</td>
    <td>${o.technician || "-"}</td>
    <td style="text-align:center">${o.status}</td>
    <td style="text-align:left;font-weight:600">${(o.totalCost || 0).toFixed(3)}</td>
  </tr>`).join("");

  const totalVisitsAmount = customerOrders.reduce((s, o) => s + (o.totalCost || 0), 0);

  const rows = ledger.entries.slice().reverse().map((e, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td style="text-align:center">${e.date}</td>
      <td style="text-align:center">${TYPE_LABELS[e.type] || e.type}</td>
      <td style="text-align:center">${e.reference}</td>
      <td>${e.description}</td>
      <td style="text-align:left;color:#dc2626">${e.debit ? e.debit.toFixed(3) : "-"}</td>
      <td style="text-align:left;color:#16a34a">${e.credit ? e.credit.toFixed(3) : "-"}</td>
      <td style="text-align:left;font-weight:600">${e.balance.toFixed(3)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>كشف حساب - ${customer.name}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: 'Tahoma', 'Arial', sans-serif; color: #111; margin: 0; padding: 14mm; background: #fff; font-size: 12px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #d4a14a; padding-bottom: 12px; margin-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 800; color: #d4a14a; }
    .doc-title { background: #111; color: #fff; padding: 8px 16px; border-radius: 6px; font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .meta-card { border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; }
    .meta-card h4 { margin: 0 0 6px; font-size: 11px; color: #666; }
    .meta-card .val { font-size: 13px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th, td { border: 1px solid #d4d4d4; padding: 6px 8px; font-size: 11px; }
    thead { background: #111; color: #fff; }
    tbody tr:nth-child(even) { background: #f8f8f8; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
    .stat { border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; text-align: center; }
    .stat .label { font-size: 10px; color: #666; }
    .stat .value { font-size: 14px; font-weight: 700; margin-top: 4px; }
    .stat.debit .value { color: #dc2626; }
    .stat.credit .value { color: #16a34a; }
    .stat.outstanding .value { color: #d97706; }
    .footer { margin-top: 24px; border-top: 1px dashed #d4d4d4; padding-top: 8px; font-size: 10px; color: #777; text-align: center; }
    @media print { .no-print { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">ورشة الوفاء للخدمات المتكاملة</div>
      <div style="font-size:11px;color:#666;margin-top:4px">سلطنة عُمان • Oman</div>
    </div>
    <div class="doc-title">كشف حساب • Account Statement</div>
  </div>

  <div class="meta">
    <div class="meta-card">
      <h4>اسم العميل</h4>
      <div class="val">${customer.name}</div>
    </div>
    <div class="meta-card">
      <h4>رقم العميل</h4>
      <div class="val">${customer.id}</div>
    </div>
    <div class="meta-card">
      <h4>الجوال</h4>
      <div class="val" dir="ltr">${customer.phone || "-"}</div>
    </div>
    <div class="meta-card">
      <h4>تاريخ الإصدار</h4>
      <div class="val">${today}</div>
    </div>
  </div>

  <div class="summary" style="margin-bottom:14px">
    <div class="stat"><div class="label">عدد الزيارات</div><div class="value" style="color:#d4a14a">${customerOrders.length}</div></div>
    <div class="stat"><div class="label">عدد السيارات</div><div class="value" style="color:#0369a1">${customerVehicles.length}</div></div>
    <div class="stat"><div class="label">عدد الفواتير</div><div class="value">${ledger.invoicesCount}</div></div>
    <div class="stat outstanding"><div class="label">إجمالي الإنفاق</div><div class="value">${totalVisitsAmount.toFixed(3)} ر.ع</div></div>
  </div>

  ${customerVehicles.length > 0 ? `
    <h3 style="margin:14px 0 6px;border-right:4px solid #d4a14a;padding-right:8px">سيارات العميل</h3>
    <table>
      <thead><tr>
        <th style="width:90px">اللوحة</th>
        <th>النوع/الموديل</th>
        <th style="width:60px">السنة</th>
        <th style="width:60px">زيارات</th>
        <th style="width:90px">آخر زيارة</th>
        <th style="width:90px">الإنفاق</th>
      </tr></thead>
      <tbody>${vehicleRows}</tbody>
    </table>
  ` : ""}

  ${customerOrders.length > 0 ? `
    <h3 style="margin:14px 0 6px;border-right:4px solid #d4a14a;padding-right:8px">جميع الزيارات وأوامر العمل</h3>
    <table>
      <thead><tr>
        <th style="width:30px">#</th>
        <th style="width:90px">رقم الأمر</th>
        <th style="width:80px">التاريخ</th>
        <th>السيارة</th>
        <th style="width:80px">اللوحة</th>
        <th style="width:80px">الخدمة</th>
        <th style="width:80px">الفني</th>
        <th style="width:90px">الحالة</th>
        <th style="width:80px">المبلغ</th>
      </tr></thead>
      <tbody>${visitsRows}</tbody>
      <tfoot><tr style="background:#f0f0f0;font-weight:700">
        <td colspan="8" style="text-align:left;padding:6px 8px">إجمالي الزيارات</td>
        <td style="text-align:left;padding:6px 8px">${totalVisitsAmount.toFixed(3)}</td>
      </tr></tfoot>
    </table>
  ` : ""}

  <h3 style="margin:14px 0 6px;border-right:4px solid #d4a14a;padding-right:8px">حركة الحساب</h3>
  ${ledger.entries.length === 0 ? `
    <div style="text-align:center;padding:40px;color:#888">لا توجد حركات مسجلة لهذا العميل</div>
  ` : `
    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th style="width:90px">التاريخ</th>
          <th style="width:80px">النوع</th>
          <th style="width:100px">المرجع</th>
          <th>البيان</th>
          <th style="width:80px">مدين</th>
          <th style="width:80px">دائن</th>
          <th style="width:80px">الرصيد</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `}

  <div class="summary">
    <div class="stat debit">
      <div class="label">إجمالي المدين</div>
      <div class="value">${ledger.totalDebit.toFixed(3)} ر.ع</div>
    </div>
    <div class="stat credit">
      <div class="label">إجمالي الدائن</div>
      <div class="value">${ledger.totalCredit.toFixed(3)} ر.ع</div>
    </div>
    <div class="stat outstanding">
      <div class="label">المبلغ المستحق</div>
      <div class="value">${ledger.outstanding.toFixed(3)} ر.ع</div>
    </div>
    <div class="stat">
      <div class="label">عدد الحركات</div>
      <div class="value">${ledger.entries.length}</div>
    </div>
  </div>

  <div class="footer">
    تم إنشاء هذا الكشف آلياً من نظام ورشة الوفاء — Alwafa Integrated Services ERP
  </div>
</body>
</html>`;
}
