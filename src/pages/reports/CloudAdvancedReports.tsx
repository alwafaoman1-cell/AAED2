// تقارير محاسبية متقدمة من السحابة مباشرة (Supabase).
// 4 تبويبات: ضريبة القيمة المضافة، قائمة الدخل، أعمار الذمم (Aging)، الاتجاه الشهري.
// كل البيانات تُجلب live من جداول: sales_documents, insurance_invoices, expenses, claim_payments.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatCard from "@/components/StatCard";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { ArrowRight, Receipt, TrendingUp, TrendingDown, Clock, BarChart3, RefreshCw, FileSpreadsheet, Cloud, FileText, Printer, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { exportVatPdf, exportVatExcel } from "@/lib/vatOfficialExport";
import { formatMoney } from "@/lib/pdfGenerator";
import { calculateVatExclusive, roundMoney } from "@/lib/money";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { generatePdfFromHtml } from "@/lib/htmlToPdf";
import { buildHtmlWithPageMarginStyle } from "@/lib/pdfLayoutSettings";
import { queryKeys } from "@/lib/queryKeys";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthsAgoISO = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

interface Filters { from: string; to: string }

interface InvoiceReportRow {
  invoiceType: "Sales" | "Insurance";
  invoiceNumber: string;
  invoiceDate: string;
  party: string;
  subtotal: number;
  vat: number;
  total: number;
  paid: number;
  remaining: number;
  paymentStatus: string;
  status: string;
}

function useCloudData(f: Filters) {
  return useQuery({
    queryKey: queryKeys.reports.cloud(f),
    queryFn: async () => {
      const [sales, insInv, exp, payments, purchases] = await Promise.all([
        supabase.from("sales_documents").select("id,doc_type,doc_number,date,due_date,subtotal,tax_total,total,paid_amount,balance_due,status,customer_name").gte("date", f.from).lte("date", f.to),
        supabase.from("insurance_invoices" as any).select("id,invoice_number,invoice_date,issued_at,due_date,subtotal,vat,total,paid_amount,status,insurance_company_name").gte("invoice_date", f.from).lte("invoice_date", f.to),
        supabase.from("expenses").select("id,date,amount,category_name,description,beneficiary").gte("date", f.from).lte("date", f.to),
        supabase.from("claim_payments").select("id,payment_date,amount,status,insurance_company_id").gte("payment_date", f.from).lte("payment_date", f.to),
        supabase.from("purchase_invoices" as any).select("id,invoice_number,date,supplier_name,subtotal,vat,total").gte("date", f.from).lte("date", f.to),
      ]);
      return {
        sales: (sales.data || []) as any[],
        insInv: (insInv.data || []) as any[],
        expenses: (exp.data || []) as any[],
        claimPayments: (payments.data || []) as any[],
        purchases: (purchases.data || []) as any[],
      };
    },
  });
}

export default function CloudAdvancedReports() {
  const navigate = useNavigate();
  const [f, setF] = useState<Filters>({ from: monthsAgoISO(6), to: todayISO() });
  const { data, isLoading, refetch, isFetching } = useCloudData(f);

  const vat = useMemo(() => {
    if (!data) return { outputSales: 0, outputInsurance: 0, output: 0, inputActual: 0, inputEst: 0, net: 0, salesInvoicesCount: 0, insCount: 0, purchasesCount: 0 };
    const salesInvoices = data.sales.filter((s) => s.doc_type === "invoice");
    const outputSales = salesInvoices.reduce((s, r) => s + Number(r.tax_total || 0), 0);
    const outputInsurance = data.insInv.reduce((s, r) => s + Number(r.vat || 0), 0);
    // VAT input فعلي من فواتير الشراء + تقدير من المصروفات إذا لم توجد مشتريات
    const inputActual = data.purchases.reduce((s, r) => s + Number(r.vat || 0), 0);
    const inputEst = roundMoney(data.expenses.reduce((s, r) => s + calculateVatExclusive(Number(r.amount || 0)).vatAmount, 0));
    const inputUsed = inputActual > 0 ? inputActual : inputEst;
    const output = outputSales + outputInsurance;
    return {
      outputSales, outputInsurance, output, inputActual, inputEst,
      net: output - inputUsed,
      salesInvoicesCount: salesInvoices.length,
      insCount: data.insInv.length,
      purchasesCount: data.purchases.length,
    };
  }, [data]);

  const income = useMemo(() => {
    if (!data) return { revenue: 0, expenses: 0, profit: 0, margin: 0, salesRev: 0, insRev: 0, claimsReceived: 0 };
    const salesRev = data.sales.filter((s) => s.doc_type === "invoice").reduce((s, r) => s + Number(r.subtotal || 0), 0);
    const insRev = data.insInv.reduce((s, r) => s + Number(r.subtotal || 0), 0);
    const claimsReceived = data.claimPayments.filter((p) => p.status === "cleared").reduce((s, r) => s + Number(r.amount || 0), 0);
    const expenses = data.expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
    const revenue = salesRev + insRev;
    const profit = revenue - expenses;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, expenses, profit, margin, salesRev, insRev, claimsReceived };
  }, [data]);

  const allCompanyInvoices = useMemo<InvoiceReportRow[]>(() => {
    if (!data) return [];
    const salesRows: InvoiceReportRow[] = data.sales
      .filter((s) => s.doc_type === "invoice")
      .map((s) => ({
        invoiceType: "Sales",
        invoiceNumber: String(s.doc_number || "—"),
        invoiceDate: String(s.date || "—"),
        party: String(s.customer_name || "—"),
        subtotal: roundMoney(s.subtotal || 0),
        vat: roundMoney(s.tax_total || 0),
        total: roundMoney(s.total || 0),
        paid: roundMoney(s.paid_amount || 0),
        remaining: roundMoney(s.balance_due ?? Math.max(0, Number(s.total || 0) - Number(s.paid_amount || 0))),
        paymentStatus: Number(s.balance_due || 0) <= 0 ? "Paid" : Number(s.paid_amount || 0) > 0 ? "Partial" : "Unpaid",
        status: String(s.status || "issued"),
      }));
    const insuranceRows: InvoiceReportRow[] = data.insInv.map((i) => {
      const total = Number(i.total || 0);
      const paid = Number(i.paid_amount || 0);
      return {
        invoiceType: "Insurance",
        invoiceNumber: String(i.invoice_number || "—"),
        invoiceDate: String(i.invoice_date || i.issued_at || "").slice(0, 10) || "—",
        party: String(i.insurance_company_name || "—"),
        subtotal: roundMoney(i.subtotal || 0),
        vat: roundMoney(i.vat || 0),
        total: roundMoney(total),
        paid: roundMoney(paid),
        remaining: roundMoney(Math.max(0, total - paid)),
        paymentStatus: total - paid <= 0.001 ? "Paid" : paid > 0 ? "Partial" : "Unpaid",
        status: String(i.status || "issued"),
      };
    });
    return [...salesRows, ...insuranceRows].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  }, [data]);

  const taxSummaryCards = useMemo(() => ([
    { title: "All Company Invoices", value: allCompanyInvoices.length, hint: "Sales + Insurance" },
    { title: "Sales Invoices", value: allCompanyInvoices.filter((r) => r.invoiceType === "Sales").length, hint: "Cash/customer invoices" },
    { title: "Insurance Invoices", value: allCompanyInvoices.filter((r) => r.invoiceType === "Insurance").length, hint: "Insurance accounting only" },
    { title: "Purchases / Expenses", value: (data?.purchases?.length || 0) + (data?.expenses?.length || 0), hint: "Input VAT source" },
  ]), [allCompanyInvoices, data]);

  const readinessRows = useMemo(() => {
    const hasInvoices = allCompanyInvoices.length > 0;
    const numbered = allCompanyInvoices.every((r) => r.invoiceNumber && r.invoiceNumber !== "—");
    const hasVatValues = allCompanyInvoices.every((r) => Number.isFinite(r.vat) && Number.isFinite(r.total));
    return [
      { requirement: "Invoice sequence", status: numbered && hasInvoices ? "Ready" : "Partial", support: "Invoice numbers exist for issued sales/insurance invoices.", missing: hasInvoices ? "Confirm numbering policy with accountant." : "Create issued invoices to validate sequence.", recommendation: "Lock numbering per fiscal year before official rollout." },
      { requirement: "VAT number / CR number", status: "Partial", support: "PDF/settings can hold seller VAT and CR values.", missing: "Needs final verified company VAT/CR in settings.", recommendation: "Accountant must verify seller VAT, CR, and address before filing." },
      { requirement: "Customer / insurance data", status: "Partial", support: "Invoices show customer or insurance party name.", missing: "Buyer VAT/CR is optional and may be missing.", recommendation: "Add buyer VAT/CR where required by invoice type." },
      { requirement: "QR / verification payload", status: "Partial", support: "Short-link QR opens the customer portal and hides UUIDs.", missing: "No official Oman e-invoice verification payload/integration confirmed.", recommendation: "Keep QR as portal link until Tax Authority technical spec is confirmed." },
      { requirement: "Invoice PDF archive", status: "Partial", support: "PDF/print output is available from invoice screens.", missing: "Final immutable PDF archive policy needs accountant approval.", recommendation: "Archive finalized PDFs read-only after issuing." },
      { requirement: "Audit trail", status: "Partial", support: "Operational audit logs exist in the system.", missing: "Invoice edit/cancellation audit should be reviewed end-to-end.", recommendation: "Prefer cancel/credit-note/reissue flow over direct invoice edits." },
      { requirement: "Credit note / cancellation", status: "Not Ready", support: "Cancellation status can be tracked in records.", missing: "Full official Credit Note workflow is not complete.", recommendation: "Implement credit notes before official e-invoicing certification." },
      { requirement: "Export readiness", status: "Ready", support: "VAT PDF, XLSX, print, and invoice export are available.", missing: "Final accountant format may require additional columns.", recommendation: "Validate exported XLSX/PDF with accountant." },
      { requirement: "Data retention", status: "Partial", support: "Supabase keeps operational records and backups are available.", missing: "Formal retention policy not locked.", recommendation: "Define statutory retention period and backup retention." },
      { requirement: "Tamper prevention", status: "Partial", support: "Issued invoices can be separated from operational drafts.", missing: "Hard invoice locking and credit-note workflow need final policy.", recommendation: "Lock issued invoices except Owner/Admin audited actions." },
      { requirement: "Fawtara / Peppol readiness", status: "Not Ready", support: "Structured data is available for future integration.", missing: "No official API/Peppol connector is implemented or certified.", recommendation: "Do not claim official readiness until Tax Authority integration is verified." },
    ];
  }, [allCompanyInvoices]);

  const aging = useMemo(() => {
    const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    const today = new Date();
    if (!data) return { buckets, rows: [] as any[], total: 0 };
    const rows: any[] = [];
    const push = (kind: string, who: string, num: string, dueRaw: string | null, balance: number) => {
      if (balance <= 0.01) return;
      const due = dueRaw ? new Date(dueRaw) : null;
      const days = due ? Math.floor((today.getTime() - due.getTime()) / 86400000) : 0;
      let bucket: keyof typeof buckets = "current";
      if (days <= 0) bucket = "current";
      else if (days <= 30) bucket = "b30";
      else if (days <= 60) bucket = "b60";
      else if (days <= 90) bucket = "b90";
      else bucket = "b90plus";
      buckets[bucket] += balance;
      rows.push({ kind, who, num, due: dueRaw, days, balance, bucket });
    };
    data.sales.filter((s) => s.doc_type === "invoice" && Number(s.balance_due || 0) > 0).forEach((s) =>
      push("مبيعات", s.customer_name || "—", s.doc_number, s.due_date, Number(s.balance_due)));
    data.insInv.filter((i) => Number(i.total || 0) - Number(i.paid_amount || 0) > 0).forEach((i) =>
      push("تأمين", i.insurance_company_name || "—", i.invoice_number, i.due_date, Number(i.total) - Number(i.paid_amount)));
    rows.sort((a, b) => b.days - a.days);
    const total = Object.values(buckets).reduce((s, v) => s + v, 0);
    return { buckets, rows, total };
  }, [data]);

  const monthly = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { ym: string; revenue: number; expenses: number }>();
    const add = (date: string, rev: number, exp: number) => {
      const ym = (date || "").slice(0, 7);
      if (!ym) return;
      const r = map.get(ym) || { ym, revenue: 0, expenses: 0 };
      r.revenue += rev; r.expenses += exp;
      map.set(ym, r);
    };
    data.sales.filter((s) => s.doc_type === "invoice").forEach((s) => add(s.date, Number(s.subtotal || 0), 0));
    data.insInv.forEach((i) => add((i.invoice_date || i.issued_at || "").slice(0, 10), Number(i.subtotal || 0), 0));
    data.expenses.forEach((e) => add(e.date, 0, Number(e.amount || 0)));
    return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym)).map((r) => ({
      name: new Date(r.ym + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: r.revenue,
      expenses: r.expenses,
      profit: r.revenue - r.expenses,
    }));
  }, [data]);

  const exportCsv = (filename: string, rows: any[], headers: { key: string; label: string }[]) => {
    if (!rows.length) { toast.info("لا توجد بيانات للتصدير"); return; }
    const head = headers.map((h) => h.label).join(",");
    const body = rows.map((r) => headers.map((h) => `"${String(r[h.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const profitLossRows = useMemo(() => ([
    { label: "Sales revenue before VAT", amount: roundMoney(income.salesRev) },
    { label: "Insurance revenue before VAT", amount: roundMoney(income.insRev) },
    { label: "Total revenue from invoices only", amount: roundMoney(income.revenue) },
    { label: "Operating expenses", amount: roundMoney(income.expenses) },
    { label: "Net profit", amount: roundMoney(income.profit) },
    { label: "Profit margin %", amount: roundMoney(income.margin) },
    { label: "Collected insurance payments - note only", amount: roundMoney(income.claimsReceived) },
  ]), [income]);

  const exportProfitLossXlsx = () => {
    const rows = profitLossRows.map((r) => ({
      Metric: r.label,
      Amount: r.amount,
      Currency: r.label.includes("%") ? "%" : "OMR",
    }));
    const ws = XLSX.utils.json_to_sheet([
      { Metric: "Profit/Loss Report", Amount: "", Currency: "" },
      { Metric: "Date From", Amount: f.from, Currency: "" },
      { Metric: "Date To", Amount: f.to, Currency: "" },
      {},
      ...rows,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Profit Loss");
    XLSX.writeFile(wb, `Profit_Loss_${f.from}_to_${f.to}.xlsx`);
  };

  const invoiceRowsForExport = () => allCompanyInvoices.map((r) => ({
    "Invoice Number": r.invoiceNumber,
    "Invoice Date": r.invoiceDate,
    "Invoice Type": r.invoiceType,
    "Customer / Insurance Company": r.party,
    "Subtotal Before VAT": roundMoney(r.subtotal),
    "VAT 5%": roundMoney(r.vat),
    "Total Including VAT": roundMoney(r.total),
    "Paid Amount": roundMoney(r.paid),
    "Remaining Amount": roundMoney(r.remaining),
    "Payment Status": r.paymentStatus,
    "Status": r.status,
  }));

  const exportAllInvoicesXlsx = () => {
    if (!allCompanyInvoices.length) {
      toast.info("لا توجد فواتير للتصدير");
      return;
    }
    const ws = XLSX.utils.json_to_sheet([
      { "Invoice Number": "All Company Invoices", "Invoice Date": `${f.from} to ${f.to}` },
      {},
      ...invoiceRowsForExport(),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Company Invoices");
    XLSX.writeFile(wb, `All_Company_Invoices_${f.from}_to_${f.to}.xlsx`);
  };

  const invoiceReportHtml = () => {
    const esc = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const rows = allCompanyInvoices.map((r) => `
      <tr>
        <td>${esc(r.invoiceNumber)}</td>
        <td>${esc(r.invoiceDate)}</td>
        <td>${esc(r.invoiceType)}</td>
        <td>${esc(r.party)}</td>
        <td class="num">${formatMoney(r.subtotal)}</td>
        <td class="num">${formatMoney(r.vat)}</td>
        <td class="num">${formatMoney(r.total)}</td>
        <td class="num">${formatMoney(r.paid)}</td>
        <td class="num">${formatMoney(r.remaining)}</td>
      </tr>
    `).join("");
    return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>All Company Invoices</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 277mm; min-height: 190mm; margin: 0 auto; }
    .header { border-bottom: 2px solid #0f2a4a; padding-bottom: 6mm; margin-bottom: 6mm; }
    h1 { margin: 0; font-size: 20px; color: #0f2a4a; }
    .meta { margin-top: 2mm; color: #475569; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; }
    th { background: #0f2a4a; color: #fff; }
    .num { text-align: right; font-family: Consolas, monospace; white-space: nowrap; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 8mm; border-top: 1px solid #cbd5e1; padding-top: 3mm; font-size: 10px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>All Company Invoices</h1>
      <div class="meta">Period: ${esc(f.from)} to ${esc(f.to)} | Includes Sales and Insurance invoices | Generated: ${new Date().toISOString().slice(0, 10)}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Invoice Number</th><th>Date</th><th>Type</th><th>Party</th><th>Subtotal</th><th>VAT 5%</th><th>Total</th><th>Paid</th><th>Remaining</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9" style="text-align:center;color:#64748b">No invoices in selected period</td></tr>`}</tbody>
    </table>
    <div class="footer">Prepared for accounting review. Not an official certification document.</div>
  </div>
</body>
</html>`;
  };

  const exportAllInvoicesPdf = async () => {
    await generatePdfFromHtml({
      htmlContent: buildHtmlWithPageMarginStyle(invoiceReportHtml()),
      fileName: `All_Company_Invoices_${f.from}_to_${f.to}`,
      download: true,
    });
  };

  const printAllInvoices = () => {
    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) {
      toast.error("Unable to open print window");
      return;
    }
    win.document.open();
    win.document.write(invoiceReportHtml());
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const profitLossHtml = () => {
    const esc = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const money = (value: number) => formatMoney(value);
    const rows = profitLossRows.map((r) => `
      <tr>
        <td>${esc(r.label)}</td>
        <td class="num">${r.label.includes("%") ? `${roundMoney(r.amount).toFixed(3)}%` : money(r.amount)}</td>
      </tr>
    `).join("");
    return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>Profit/Loss Report</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 186mm; min-height: 273mm; margin: 0 auto; }
    .header { border-bottom: 2px solid #0f2a4a; padding-bottom: 8mm; margin-bottom: 8mm; }
    h1 { margin: 0; font-size: 22px; color: #0f2a4a; }
    .meta { margin-top: 3mm; color: #475569; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #0f2a4a; color: #fff; }
    .num { text-align: right; font-family: Consolas, monospace; }
    tr:nth-child(even) td { background: #f8fafc; }
    .note { margin-top: 8mm; padding: 4mm; border: 1px solid #fde68a; background: #fffbeb; font-size: 11px; color: #92400e; }
    .footer { margin-top: 12mm; border-top: 1px solid #cbd5e1; padding-top: 4mm; font-size: 10px; color: #64748b; text-align: center; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>Profit/Loss Report</h1>
      <div class="meta">Period: ${esc(f.from)} to ${esc(f.to)} | Generated: ${new Date().toISOString().slice(0, 10)}</div>
    </div>
    <table>
      <thead><tr><th>Metric</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="note">Revenue is calculated from issued invoices only. Work order estimated totals are not counted as revenue. VAT is excluded from revenue.</div>
    <div class="footer">TEMO Auto ERP - Profit/Loss export</div>
  </div>
</body>
</html>`;
  };

  const exportProfitLossPdf = async () => {
    await generatePdfFromHtml({
      htmlContent: buildHtmlWithPageMarginStyle(profitLossHtml()),
      fileName: `Profit_Loss_${f.from}_to_${f.to}`,
      download: true,
    });
  };

  const printProfitLoss = () => {
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      toast.error("Unable to open print window");
      return;
    }
    win.document.open();
    win.document.write(profitLossHtml());
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="text-primary" size={26} /> التقارير المحاسبية المتقدمة (سحابة)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            VAT + قائمة الدخل + أعمار الذمم + الاتجاه الشهري — مباشرة من السحابة، محدّثة لحظياً
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> تحديث
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> رجوع
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-40" />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(1), to: todayISO() })}>آخر شهر</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(3), to: todayISO() })}>آخر 3 أشهر</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(6), to: todayISO() })}>آخر 6 أشهر</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(12), to: todayISO() })}>آخر سنة</Button>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-12 text-center text-muted-foreground">جاري تحميل البيانات من السحابة...</Card>
      ) : (
      <Tabs defaultValue="vat" dir="rtl" className="space-y-5">
        <TabsList>
          <TabsTrigger value="vat"><Receipt size={14} className="ml-1" /> ضريبة القيمة المضافة</TabsTrigger>
          <TabsTrigger value="einvoicing"><ShieldCheck size={14} className="ml-1" /> جاهزية الفوترة الإلكترونية</TabsTrigger>
          <TabsTrigger value="income"><TrendingUp size={14} className="ml-1" /> قائمة الدخل</TabsTrigger>
          <TabsTrigger value="aging"><Clock size={14} className="ml-1" /> أعمار الذمم</TabsTrigger>
          <TabsTrigger value="trend"><BarChart3 size={14} className="ml-1" /> الاتجاه الشهري</TabsTrigger>
        </TabsList>

        {/* ===== VAT ===== */}
        <TabsContent value="vat" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="VAT المخرجة - مبيعات" value={formatMoney(vat.outputSales)} icon={Receipt} variant="info" />
            <StatCard title="VAT المخرجة - تأمين" value={formatMoney(vat.outputInsurance)} icon={Receipt} variant="info" />
            <StatCard
              title={vat.inputActual > 0 ? "VAT المدخلة (فعلي)" : "VAT المدخلة (تقدير)"}
              value={formatMoney(vat.inputActual > 0 ? vat.inputActual : vat.inputEst)}
              icon={TrendingDown}
              variant={vat.inputActual > 0 ? "success" : "warning"}
            />
            <StatCard title="VAT صافي للسداد" value={formatMoney(vat.net)} icon={TrendingUp} variant={vat.net >= 0 ? "success" : "gold"} />
          </div>
          <Card className="p-4 bg-primary/5 border-primary/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">إقرار ضريبي رسمي للفترة</h3>
                <p className="text-xs text-muted-foreground mt-1">جاهز للتقديم لجهاز الضرائب العُماني — يجمع المخرجات والمدخلات والصافي</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="default" className="gap-1" onClick={() => exportVatPdf(f)}>
                  <FileText size={14} /> PDF رسمي
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => exportVatExcel(f)}>
                  <FileSpreadsheet size={14} /> Excel/CSV
                </Button>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">تفصيل الفواتير الخاضعة للضريبة</h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => exportCsv("vat-report.csv", [
                ...(data?.sales.filter((s) => s.doc_type === "invoice" && Number(s.tax_total) > 0).map((s) => ({ source: "مبيعات", num: s.doc_number, date: s.date, who: s.customer_name, subtotal: s.subtotal, vat: s.tax_total, total: s.total })) || []),
                ...(data?.insInv.map((i) => ({ source: "تأمين", num: i.invoice_number, date: (i.invoice_date || i.issued_at || "").slice(0, 10), who: i.insurance_company_name, subtotal: i.subtotal, vat: i.vat, total: i.total })) || []),
              ], [
                { key: "source", label: "المصدر" }, { key: "num", label: "الرقم" }, { key: "date", label: "التاريخ" },
                { key: "who", label: "الجهة" }, { key: "subtotal", label: "الصافي" }, { key: "vat", label: "VAT" }, { key: "total", label: "الإجمالي" },
              ])}>
                <FileSpreadsheet size={14} /> CSV
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>عدد فواتير المبيعات: <b>{vat.salesInvoicesCount}</b> · فواتير التأمين: <b>{vat.insCount}</b> · فواتير الشراء: <b>{vat.purchasesCount}</b></p>
              <p>{vat.inputActual > 0 ? `VAT المدخلة محسوبة فعلياً من ${vat.purchasesCount} فاتورة شراء.` : "لا توجد فواتير شراء — تم تقدير VAT المدخلة كـ 5% من المصروفات (يمكن إدخال فواتير شراء للحصول على رقم فعلي)."}</p>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold">Tax Authority Reports / All Company Invoices</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  يجمع فواتير المبيعات وفواتير التأمين في جدول واحد للمراجعة المحاسبية. لا يعني اعتمادًا رسميًا من جهاز الضرائب.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" className="gap-1" onClick={exportAllInvoicesPdf}>
                  <FileText size={14} /> PDF
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportAllInvoicesXlsx}>
                  <FileSpreadsheet size={14} /> XLSX
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={printAllInvoices}>
                  <Printer size={14} /> Print
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {taxSummaryCards.map((item) => (
                <div key={item.title} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="text-[11px] text-muted-foreground">{item.title}</div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1" dir="ltr">{item.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{item.hint}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-right py-2">Invoice Number</th>
                    <th className="text-right py-2">Date</th>
                    <th className="text-right py-2">Type</th>
                    <th className="text-right py-2">Customer / Insurance</th>
                    <th className="text-left py-2">Subtotal</th>
                    <th className="text-left py-2">VAT 5%</th>
                    <th className="text-left py-2">Total</th>
                    <th className="text-left py-2">Paid</th>
                    <th className="text-left py-2">Remaining</th>
                    <th className="text-right py-2">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {allCompanyInvoices.length === 0 ? (
                    <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">لا توجد فواتير في الفترة المختارة</td></tr>
                  ) : allCompanyInvoices.slice(0, 100).map((r) => (
                    <tr key={`${r.invoiceType}-${r.invoiceNumber}`} className="hover:bg-secondary/30">
                      <td className="py-2 font-mono">{r.invoiceNumber}</td>
                      <td className="py-2 font-mono" dir="ltr">{r.invoiceDate}</td>
                      <td className="py-2">{r.invoiceType}</td>
                      <td className="py-2">{r.party}</td>
                      <td className="py-2 text-left font-mono" dir="ltr">{formatMoney(r.subtotal)}</td>
                      <td className="py-2 text-left font-mono" dir="ltr">{formatMoney(r.vat)}</td>
                      <td className="py-2 text-left font-mono font-semibold" dir="ltr">{formatMoney(r.total)}</td>
                      <td className="py-2 text-left font-mono" dir="ltr">{formatMoney(r.paid)}</td>
                      <td className="py-2 text-left font-mono" dir="ltr">{formatMoney(r.remaining)}</td>
                      <td className="py-2">{r.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="einvoicing" className="space-y-4">
          <Card className="p-4 border-primary/20 bg-primary/5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold">تجهيز للفوترة الإلكترونية / جهاز الضرائب — ليس اعتمادًا رسميًا</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  هذا القسم يوضح حالة جاهزية البيانات والتقارير والمخرجات للمراجعة. الاعتماد الرسمي أو الربط مع جهاز الضرائب يحتاج مواصفات فنية ومراجعة محاسب/جهة ضريبية.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Readiness Checklist</h3>
              <div className="text-xs text-muted-foreground">
                الفواتير في الفترة: <span className="font-mono" dir="ltr">{allCompanyInvoices.length}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-right py-2">Requirement</th>
                    <th className="text-right py-2">Status</th>
                    <th className="text-right py-2">Current support</th>
                    <th className="text-right py-2">Missing</th>
                    <th className="text-right py-2">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {readinessRows.map((row) => {
                    const Icon = row.status === "Ready" ? CheckCircle2 : row.status === "Not Ready" ? XCircle : AlertTriangle;
                    const cls = row.status === "Ready" ? "text-success bg-success/10" : row.status === "Not Ready" ? "text-destructive bg-destructive/10" : "text-warning bg-warning/10";
                    return (
                      <tr key={row.requirement} className="align-top hover:bg-secondary/30">
                        <td className="py-2 font-medium text-foreground">{row.requirement}</td>
                        <td className="py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${cls}`}>
                            <Icon size={11} /> {row.status}
                          </span>
                        </td>
                        <td className="py-2 text-muted-foreground">{row.support}</td>
                        <td className="py-2 text-muted-foreground">{row.missing}</td>
                        <td className="py-2 text-muted-foreground">{row.recommendation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-2">Accounting Reports</h3>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc mr-5">
                <li>Profit/Loss — الإيراد من الفواتير فقط، ولا يستخدم work_order.totalCost كإيراد.</li>
                <li>VAT Summary — Output VAT من فواتير البيع والتأمين، Input VAT من المصروفات/المشتريات.</li>
                <li>Customer/Insurance receivables — ضمن تبويب أعمار الذمم.</li>
                <li>Payments and expenses — مرتبطة بالمحاسبة الحالية وتحتاج مراجعة محاسب قبل الإقرار الرسمي.</li>
              </ul>
            </Card>
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-2">Operational Reports</h3>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc mr-5">
                <li>Work Orders and delivered vehicles — من صفحة أوامر العمل.</li>
                <li>Claims and Delivered Waiting LPO — من صفحة المطالبات ومحاسبة التأمين.</li>
                <li>Vehicles Archive — من صفحة أرشيف المركبات بعد إصلاح مزامنة الأرشيف.</li>
                <li>Tracking Visits — من صفحة المركبة وجدول public_tracking_logs.</li>
              </ul>
            </Card>
          </div>
        </TabsContent>

        {/* ===== Income ===== */}
        <TabsContent value="income" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="إجمالي الإيرادات" value={formatMoney(income.revenue)} icon={TrendingUp} variant="success" />
            <StatCard title="إجمالي المصروفات" value={formatMoney(income.expenses)} icon={TrendingDown} variant="warning" />
            <StatCard title="صافي الربح" value={formatMoney(income.profit)} icon={TrendingUp} variant={income.profit >= 0 ? "gold" : "warning"} />
            <StatCard title="هامش الربح" value={`${income.margin.toFixed(1)}%`} icon={BarChart3} variant="info" />
          </div>
          <Card className="p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold">قائمة الدخل المختصرة</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="default" className="gap-1" onClick={exportProfitLossPdf}>
                  <FileText size={14} /> PDF
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportProfitLossXlsx}>
                  <FileSpreadsheet size={14} /> XLSX
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={printProfitLoss}>
                  <FileText size={14} /> Print
                </Button>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                <tr><td className="py-2">إيرادات المبيعات (بدون VAT)</td><td className="py-2 text-left font-mono" dir="ltr">{formatMoney(income.salesRev)}</td></tr>
                <tr><td className="py-2">إيرادات التأمين (بدون VAT)</td><td className="py-2 text-left font-mono" dir="ltr">{formatMoney(income.insRev)}</td></tr>
                <tr><td className="py-2 font-semibold">إجمالي الإيرادات</td><td className="py-2 text-left font-mono font-bold text-success" dir="ltr">{formatMoney(income.revenue)}</td></tr>
                <tr><td className="py-2 text-destructive">(-) المصروفات التشغيلية</td><td className="py-2 text-left font-mono text-destructive" dir="ltr">({formatMoney(income.expenses)})</td></tr>
                <tr><td className="py-2 font-bold">صافي الربح</td><td className="py-2 text-left font-mono font-bold" dir="ltr">{formatMoney(income.profit)}</td></tr>
                <tr><td className="py-2 text-xs text-muted-foreground">للعلم: دفعات التأمين المحصّلة فعلياً</td><td className="py-2 text-left font-mono text-xs text-muted-foreground" dir="ltr">{formatMoney(income.claimsReceived)}</td></tr>
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ===== Aging ===== */}
        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard title="جاري (غير مستحق)" value={formatMoney(aging.buckets.current)} icon={Clock} variant="info" />
            <StatCard title="1-30 يوم" value={formatMoney(aging.buckets.b30)} icon={Clock} variant="gold" />
            <StatCard title="31-60 يوم" value={formatMoney(aging.buckets.b60)} icon={Clock} variant="warning" />
            <StatCard title="61-90 يوم" value={formatMoney(aging.buckets.b90)} icon={Clock} variant="warning" />
            <StatCard title="+90 يوم" value={formatMoney(aging.buckets.b90plus)} icon={Clock} variant="gold" />
          </div>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">الذمم المعلقة — إجمالي: <span className="font-mono" dir="ltr">{formatMoney(aging.total)}</span></h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => exportCsv("aging-report.csv", aging.rows, [
                { key: "kind", label: "النوع" }, { key: "who", label: "الجهة" }, { key: "num", label: "الرقم" },
                { key: "due", label: "تاريخ الاستحقاق" }, { key: "days", label: "أيام التأخير" }, { key: "balance", label: "الرصيد" }, { key: "bucket", label: "الفئة" },
              ])}>
                <FileSpreadsheet size={14} /> CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-right py-2">النوع</th>
                    <th className="text-right py-2">الجهة</th>
                    <th className="text-right py-2">الرقم</th>
                    <th className="text-right py-2">الاستحقاق</th>
                    <th className="text-right py-2">أيام التأخير</th>
                    <th className="text-left py-2">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {aging.rows.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">لا توجد ذمم معلقة في هذه الفترة</td></tr>
                  ) : aging.rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="hover:bg-secondary/30">
                      <td className="py-2">{r.kind}</td>
                      <td className="py-2">{r.who}</td>
                      <td className="py-2 font-mono">{r.num}</td>
                      <td className="py-2 font-mono" dir="ltr">{r.due || "—"}</td>
                      <td className={`py-2 ${r.days > 60 ? "text-destructive font-bold" : r.days > 0 ? "text-warning" : ""}`}>{r.days}</td>
                      <td className="py-2 text-left font-mono font-semibold" dir="ltr">{formatMoney(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ===== Trend ===== */}
        <TabsContent value="trend" className="space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">الإيرادات/المصروفات/الربح حسب الشهر</h3>
            {monthly.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">لا توجد بيانات في الفترة المختارة</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, direction: "rtl" }} />
                  <Legend wrapperStyle={{ direction: "rtl" }} />
                  <Bar dataKey="revenue" name="إيرادات" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="مصروفات" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="ربح" fill="hsl(42, 90%, 55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
          {monthly.length > 1 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">اتجاه صافي الربح</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, direction: "rtl" }} />
                  <Line type="monotone" dataKey="profit" name="ربح" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
