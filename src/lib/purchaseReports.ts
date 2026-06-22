// مولّد HTML طباعة لفاتورة شراء واحدة + تقرير رصيد الموردين
import {
  getPurchaseTotals,
  purchaseInvoicesStore,
  type PurchaseInvoice,
} from "@/lib/purchaseInvoicesStore";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";

const STYLES = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { font-family: 'Tahoma','Arial',sans-serif; color:#111; margin:0; padding:14mm; background:#fff; font-size:12px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #d4a14a; padding-bottom:12px; margin-bottom:16px; }
.brand { font-size:22px; font-weight:800; color:#d4a14a; }
.doc-title { background:#111; color:#fff; padding:8px 16px; border-radius:6px; font-weight:700; }
.meta { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.meta-card { border:1px solid #e5e5e5; border-radius:6px; padding:10px; }
.meta-card h4 { margin:0 0 6px; font-size:11px; color:#666; }
.meta-card .val { font-size:13px; font-weight:600; }
table { width:100%; border-collapse:collapse; margin-bottom:14px; }
th, td { border:1px solid #d4d4d4; padding:6px 8px; font-size:11px; }
thead { background:#111; color:#fff; }
tbody tr:nth-child(even) { background:#f8f8f8; }
.summary { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:12px; }
.row { display:flex; justify-content:space-between; padding:6px 10px; border:1px solid #e5e5e5; border-radius:6px; font-size:11px; }
.row.total { background:#111; color:#fff; font-size:14px; font-weight:700; }
.footer { margin-top:24px; border-top:1px dashed #d4d4d4; padding-top:8px; font-size:10px; color:#777; text-align:center; }
.no-print button { background:#d4a14a; color:#fff; border:0; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; margin:8px 4px; }
@media print { .no-print { display:none; } body { padding:0; } }
`;

function statusLabel(s: PurchaseInvoice["status"]): string {
  return s === "paid" ? "مدفوعة" : s === "partial" ? "مدفوعة جزئياً" : "غير مدفوعة";
}

export function getPurchaseInvoiceHtml(inv: PurchaseInvoice, supplier?: Supplier): string {
  const t = getPurchaseTotals(inv);
  const remaining = t.total - (inv.paidAmount || 0);
  const today = new Date().toLocaleDateString("ar");

  const rows = inv.items
    .map((it, i) => {
      const sub = it.qty * it.unitPrice - (it.discount || 0);
      const total = sub + (sub * (it.taxRate || 0)) / 100;
      return `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${it.name}${it.partNumber ? `<div style="font-size:10px;color:#777;font-family:monospace">${it.partNumber}</div>` : ""}</td>
        <td style="text-align:center">${it.qty}</td>
        <td style="text-align:left;font-family:monospace">${it.unitPrice.toFixed(3)}</td>
        <td style="text-align:left;font-family:monospace">${(it.discount || 0).toFixed(3)}</td>
        <td style="text-align:center">${it.taxRate || 0}%</td>
        <td style="text-align:left;font-family:monospace;font-weight:600">${total.toFixed(3)}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة شراء ${inv.id}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">شركة الوفاء</div>
      <div style="font-size:11px;color:#666;margin-top:4px">للأعمال المتكاملة • سلطنة عُمان</div>
    </div>
    <div style="text-align:left">
      <div class="doc-title">فاتورة شراء</div>
      <div style="font-size:13px;font-weight:700;margin-top:8px;color:#d4a14a">${inv.id}</div>
      <div style="font-size:10px;color:#777;margin-top:4px">طُبعت: ${today}</div>
    </div>
  </div>

  <div class="meta">
    <div class="meta-card">
      <h4>المورد</h4>
      <div class="val">${inv.supplierName}</div>
      ${supplier?.phone ? `<div style="font-size:11px;color:#666;margin-top:4px">${supplier.phone}</div>` : ""}
      ${supplier?.taxNumber ? `<div style="font-size:11px;color:#666">رقم ضريبي: ${supplier.taxNumber}</div>` : ""}
      ${supplier?.address ? `<div style="font-size:11px;color:#666">${supplier.address}</div>` : ""}
    </div>
    <div class="meta-card">
      <h4>تفاصيل الفاتورة</h4>
      <div style="font-size:11px"><strong>التاريخ:</strong> ${inv.date}</div>
      ${inv.invoiceNumber ? `<div style="font-size:11px"><strong>رقم خارجي:</strong> ${inv.invoiceNumber}</div>` : ""}
      ${inv.paymentDays ? `<div style="font-size:11px"><strong>شروط الدفع:</strong> ${inv.paymentDays} يوم</div>` : ""}
      <div style="font-size:11px;margin-top:4px"><strong>الحالة:</strong> <span style="color:${inv.paid ? "#16a34a" : remaining > 0 ? "#dc2626" : "#d97706"}">${statusLabel(inv.status)}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>البند</th>
        <th style="width:60px">الكمية</th>
        <th style="width:80px">سعر الوحدة</th>
        <th style="width:80px">الخصم</th>
        <th style="width:60px">الضريبة</th>
        <th style="width:90px">المجموع</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div>
      ${inv.notes ? `<div class="meta-card"><h4>ملاحظات</h4><div style="font-size:11px;line-height:1.6">${inv.notes}</div></div>` : ""}
    </div>
    <div>
      <div class="row"><span>المجموع الفرعي</span><span style="font-family:monospace">${t.subtotal.toFixed(3)} ر.ع</span></div>
      <div class="row"><span>الخصم</span><span style="font-family:monospace;color:#dc2626">- ${t.discountAmt.toFixed(3)} ر.ع</span></div>
      <div class="row"><span>الضريبة</span><span style="font-family:monospace">${t.tax.toFixed(3)} ر.ع</span></div>
      <div class="row"><span>الشحن</span><span style="font-family:monospace">${(inv.shipping || 0).toFixed(3)} ر.ع</span></div>
      <div class="row total"><span>الإجمالي</span><span style="font-family:monospace">${t.total.toFixed(3)} ر.ع</span></div>
      <div class="row" style="margin-top:6px"><span>المدفوع</span><span style="font-family:monospace;color:#16a34a">${(inv.paidAmount || 0).toFixed(3)} ر.ع</span></div>
      <div class="row"><span>المتبقي</span><span style="font-family:monospace;color:#dc2626;font-weight:700">${remaining.toFixed(3)} ر.ع</span></div>
    </div>
  </div>

  <div class="footer">
    شكراً لتعاملكم معنا • نظام الوفاء برو
  </div>

  <div class="no-print" style="text-align:center;margin-top:18px">
    <button onclick="window.close()" style="background:#777">إغلاق</button>
  </div>
</body>
</html>`;
}

// ---------------------- تقرير رصيد الموردين ----------------------
export interface SupplierBalanceRow {
  supplierId: string;
  supplierName: string;
  invoicesCount: number;
  totalPurchases: number;
  totalPaid: number;
  totalReturns: number;
  remaining: number;
}

export interface SupplierBalanceReport {
  from?: string;
  to?: string;
  rows: SupplierBalanceRow[];
  totals: {
    purchases: number;
    paid: number;
    returns: number;
    remaining: number;
  };
}

export function buildSupplierBalanceReport(
  payments: { supplierId: string; amount: number; date: string }[],
  returns: { supplierId: string; total: number; date: string }[],
  from?: string,
  to?: string,
): SupplierBalanceReport {
  const invoices = purchaseInvoicesStore.getAll();
  const suppliers = suppliersStore.getAll();
  const inRange = (d: string) =>
    (!from || d >= from) && (!to || d <= to);

  const map: Record<string, SupplierBalanceRow> = {};
  suppliers.forEach((s) => {
    map[s.id] = {
      supplierId: s.id,
      supplierName: s.name,
      invoicesCount: 0,
      totalPurchases: 0,
      totalPaid: 0,
      totalReturns: 0,
      remaining: 0,
    };
  });

  invoices.filter((i) => inRange(i.date)).forEach((i) => {
    const t = getPurchaseTotals(i).total;
    const row = map[i.supplierId];
    if (row) {
      row.invoicesCount += 1;
      row.totalPurchases += t;
    }
  });
  payments.filter((p) => inRange(p.date)).forEach((p) => {
    const row = map[p.supplierId];
    if (row) row.totalPaid += p.amount;
  });
  returns.filter((r) => inRange(r.date)).forEach((r) => {
    const row = map[r.supplierId];
    if (row) row.totalReturns += r.total;
  });

  const rows = Object.values(map)
    .map((r) => ({ ...r, remaining: r.totalPurchases - r.totalPaid - r.totalReturns }))
    .filter((r) => r.invoicesCount > 0 || r.totalPaid > 0 || r.totalReturns > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const totals = rows.reduce(
    (s, r) => ({
      purchases: s.purchases + r.totalPurchases,
      paid: s.paid + r.totalPaid,
      returns: s.returns + r.totalReturns,
      remaining: s.remaining + r.remaining,
    }),
    { purchases: 0, paid: 0, returns: 0, remaining: 0 },
  );

  return { from, to, rows, totals };
}

export function getSupplierBalanceReportHtml(report: SupplierBalanceReport): string {
  const today = new Date().toLocaleDateString("ar");
  const rows = report.rows
    .map(
      (r, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${r.supplierName}</td>
      <td style="text-align:center">${r.invoicesCount}</td>
      <td style="text-align:left;font-family:monospace">${r.totalPurchases.toFixed(3)}</td>
      <td style="text-align:left;font-family:monospace;color:#16a34a">${r.totalPaid.toFixed(3)}</td>
      <td style="text-align:left;font-family:monospace;color:#d97706">${r.totalReturns.toFixed(3)}</td>
      <td style="text-align:left;font-family:monospace;color:${r.remaining > 0 ? "#dc2626" : "#16a34a"};font-weight:700">${r.remaining.toFixed(3)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>تقرير رصيد الموردين</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">شركة الوفاء</div>
      <div style="font-size:11px;color:#666;margin-top:4px">للأعمال المتكاملة • سلطنة عُمان</div>
    </div>
    <div style="text-align:left">
      <div class="doc-title">تقرير رصيد الموردين</div>
      <div style="font-size:11px;color:#666;margin-top:8px">طُبع: ${today}</div>
      ${report.from || report.to ? `<div style="font-size:11px;color:#666;margin-top:4px">من: ${report.from || "البداية"} إلى: ${report.to || "اليوم"}</div>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>المورد</th>
        <th style="width:60px">الفواتير</th>
        <th style="width:100px">إجمالي المشتريات</th>
        <th style="width:90px">المدفوع</th>
        <th style="width:90px">المرتجعات</th>
        <th style="width:100px">الرصيد المستحق</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="7" style="text-align:center;padding:20px;color:#999">لا توجد بيانات في هذه الفترة</td></tr>`}</tbody>
    <tfoot>
      <tr style="background:#111;color:#fff;font-weight:700">
        <td colspan="3" style="text-align:center">الإجماليات</td>
        <td style="text-align:left;font-family:monospace">${report.totals.purchases.toFixed(3)}</td>
        <td style="text-align:left;font-family:monospace">${report.totals.paid.toFixed(3)}</td>
        <td style="text-align:left;font-family:monospace">${report.totals.returns.toFixed(3)}</td>
        <td style="text-align:left;font-family:monospace">${report.totals.remaining.toFixed(3)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">نظام الوفاء برو • تقرير محاسبي تلقائي</div>

  <div class="no-print" style="text-align:center;margin-top:18px">
    <button onclick="window.close()" style="background:#777">إغلاق</button>
  </div>
</body>
</html>`;
}

/** تصدير تقرير رصيد الموردين كملف CSV (يفتح في Excel) */
export function downloadSupplierBalanceCsv(report: SupplierBalanceReport): void {
  const header = ["#", "المورد", "عدد الفواتير", "إجمالي المشتريات", "المدفوع", "المرتجعات", "الرصيد المستحق"];
  const lines = report.rows.map((r, i) =>
    [
      i + 1,
      `"${r.supplierName.replace(/"/g, '""')}"`,
      r.invoicesCount,
      r.totalPurchases.toFixed(3),
      r.totalPaid.toFixed(3),
      r.totalReturns.toFixed(3),
      r.remaining.toFixed(3),
    ].join(","),
  );
  const totals = [
    "",
    "الإجماليات",
    "",
    report.totals.purchases.toFixed(3),
    report.totals.paid.toFixed(3),
    report.totals.returns.toFixed(3),
    report.totals.remaining.toFixed(3),
  ].join(",");
  const csv = "\uFEFF" + [header.join(","), ...lines, totals].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `supplier-balance-${report.from || "all"}_${report.to || "now"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
