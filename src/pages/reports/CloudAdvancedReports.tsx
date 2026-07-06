// طھظ‚ط§ط±ظٹط± ظ…ط­ط§ط³ط¨ظٹط© ظ…طھظ‚ط¯ظ…ط© ظ…ظ† ط§ظ„ط³ط­ط§ط¨ط© ظ…ط¨ط§ط´ط±ط© (Supabase).
// 4 طھط¨ظˆظٹط¨ط§طھ: ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©طŒ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„طŒ ط£ط¹ظ…ط§ط± ط§ظ„ط°ظ…ظ… (Aging)طŒ ط§ظ„ط§طھط¬ط§ظ‡ ط§ظ„ط´ظ‡ط±ظٹ.
// ظƒظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ طھظڈط¬ظ„ط¨ live ظ…ظ† ط¬ط¯ط§ظˆظ„: sales_documents, insurance_invoices, expenses, claim_payments.
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
import { ArrowRight, Receipt, TrendingUp, TrendingDown, Clock, BarChart3, RefreshCw, FileSpreadsheet, Cloud, FileText } from "lucide-react";
import { exportVatPdf, exportVatExcel } from "@/lib/vatOfficialExport";
import { formatMoney } from "@/lib/pdfGenerator";
import { calculateVatExclusive, roundMoney } from "@/lib/money";
import { toast } from "sonner";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthsAgoISO = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};

interface Filters { from: string; to: string }

function useCloudData(f: Filters) {
  return useQuery({
    queryKey: ["cloud_reports", f.from, f.to],
    queryFn: async () => {
      const [sales, insInv, exp, payments, purchases] = await Promise.all([
        supabase.from("sales_documents").select("id,doc_type,doc_number,date,due_date,subtotal,tax_total,total,paid_amount,balance_due,status,customer_name").gte("date", f.from).lte("date", f.to),
        supabase.from("insurance_invoices" as any).select("id,invoice_number,issued_at,due_date,subtotal,vat,total,paid_amount,status,insurance_company_name").gte("issued_at", f.from).lte("issued_at", f.to + "T23:59:59"),
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
    // VAT input ظپط¹ظ„ظٹ ظ…ظ† ظپظˆط§طھظٹط± ط§ظ„ط´ط±ط§ط، + طھظ‚ط¯ظٹط± ظ…ظ† ط§ظ„ظ…طµط±ظˆظپط§طھ ط¥ط°ط§ ظ„ظ… طھظˆط¬ط¯ ظ…ط´طھط±ظٹط§طھ
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
      push("ظ…ط¨ظٹط¹ط§طھ", s.customer_name || "â€”", s.doc_number, s.due_date, Number(s.balance_due)));
    data.insInv.filter((i) => Number(i.total || 0) - Number(i.paid_amount || 0) > 0).forEach((i) =>
      push("طھط£ظ…ظٹظ†", i.insurance_company_name || "â€”", i.invoice_number, i.due_date, Number(i.total) - Number(i.paid_amount)));
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
    data.insInv.forEach((i) => add((i.issued_at || "").slice(0, 10), Number(i.subtotal || 0), 0));
    data.expenses.forEach((e) => add(e.date, 0, Number(e.amount || 0)));
    return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym)).map((r) => ({
      name: new Date(r.ym + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: r.revenue,
      expenses: r.expenses,
      profit: r.revenue - r.expenses,
    }));
  }, [data]);

  const exportCsv = (filename: string, rows: any[], headers: { key: string; label: string }[]) => {
    if (!rows.length) { toast.info("ظ„ط§ طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ ظ„ظ„طھطµط¯ظٹط±"); return; }
    const head = headers.map((h) => h.label).join(",");
    const body = rows.map((r) => headers.map((h) => `"${String(r[h.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="text-primary" size={26} /> ط§ظ„طھظ‚ط§ط±ظٹط± ط§ظ„ظ…ط­ط§ط³ط¨ظٹط© ط§ظ„ظ…طھظ‚ط¯ظ…ط© (ط³ط­ط§ط¨ط©)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            VAT + ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„ + ط£ط¹ظ…ط§ط± ط§ظ„ط°ظ…ظ… + ط§ظ„ط§طھط¬ط§ظ‡ ط§ظ„ط´ظ‡ط±ظٹ â€” ظ…ط¨ط§ط´ط±ط© ظ…ظ† ط§ظ„ط³ط­ط§ط¨ط©طŒ ظ…ط­ط¯ظ‘ط«ط© ظ„ط­ط¸ظٹط§ظ‹
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1">
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> طھط­ط¯ظٹط«
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> ط±ط¬ظˆط¹
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">ظ…ظ† طھط§ط±ظٹط®</Label>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">ط¥ظ„ظ‰ طھط§ط±ظٹط®</Label>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-40" />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(1), to: todayISO() })}>ط¢ط®ط± ط´ظ‡ط±</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(3), to: todayISO() })}>ط¢ط®ط± 3 ط£ط´ظ‡ط±</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(6), to: todayISO() })}>ط¢ط®ط± 6 ط£ط´ظ‡ط±</Button>
          <Button size="sm" variant="ghost" onClick={() => setF({ from: monthsAgoISO(12), to: todayISO() })}>ط¢ط®ط± ط³ظ†ط©</Button>
        </div>
      </Card>

      {isLoading ? (
        <Card className="p-12 text-center text-muted-foreground">ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ظ† ط§ظ„ط³ط­ط§ط¨ط©...</Card>
      ) : (
      <Tabs defaultValue="vat" dir="rtl" className="space-y-5">
        <TabsList>
          <TabsTrigger value="vat"><Receipt size={14} className="ml-1" /> ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</TabsTrigger>
          <TabsTrigger value="income"><TrendingUp size={14} className="ml-1" /> ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„</TabsTrigger>
          <TabsTrigger value="aging"><Clock size={14} className="ml-1" /> ط£ط¹ظ…ط§ط± ط§ظ„ط°ظ…ظ…</TabsTrigger>
          <TabsTrigger value="trend"><BarChart3 size={14} className="ml-1" /> ط§ظ„ط§طھط¬ط§ظ‡ ط§ظ„ط´ظ‡ط±ظٹ</TabsTrigger>
        </TabsList>

        {/* ===== VAT ===== */}
        <TabsContent value="vat" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="VAT ط§ظ„ظ…ط®ط±ط¬ط© - ظ…ط¨ظٹط¹ط§طھ" value={formatMoney(vat.outputSales)} icon={Receipt} variant="info" />
            <StatCard title="VAT ط§ظ„ظ…ط®ط±ط¬ط© - طھط£ظ…ظٹظ†" value={formatMoney(vat.outputInsurance)} icon={Receipt} variant="info" />
            <StatCard
              title={vat.inputActual > 0 ? "VAT ط§ظ„ظ…ط¯ط®ظ„ط© (ظپط¹ظ„ظٹ)" : "VAT ط§ظ„ظ…ط¯ط®ظ„ط© (طھظ‚ط¯ظٹط±)"}
              value={formatMoney(vat.inputActual > 0 ? vat.inputActual : vat.inputEst)}
              icon={TrendingDown}
              variant={vat.inputActual > 0 ? "success" : "warning"}
            />
            <StatCard title="VAT طµط§ظپظٹ ظ„ظ„ط³ط¯ط§ط¯" value={formatMoney(vat.net)} icon={TrendingUp} variant={vat.net >= 0 ? "success" : "gold"} />
          </div>
          <Card className="p-4 bg-primary/5 border-primary/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">ط¥ظ‚ط±ط§ط± ط¶ط±ظٹط¨ظٹ ط±ط³ظ…ظٹ ظ„ظ„ظپطھط±ط©</h3>
                <p className="text-xs text-muted-foreground mt-1">ط¬ط§ظ‡ط² ظ„ظ„طھظ‚ط¯ظٹظ… ظ„ط¬ظ‡ط§ط² ط§ظ„ط¶ط±ط§ط¦ط¨ ط§ظ„ط¹ظڈظ…ط§ظ†ظٹ â€” ظٹط¬ظ…ط¹ ط§ظ„ظ…ط®ط±ط¬ط§طھ ظˆط§ظ„ظ…ط¯ط®ظ„ط§طھ ظˆط§ظ„طµط§ظپظٹ</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="default" className="gap-1" onClick={() => exportVatPdf(f)}>
                  <FileText size={14} /> PDF ط±ط³ظ…ظٹ
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => exportVatExcel(f)}>
                  <FileSpreadsheet size={14} /> Excel/CSV
                </Button>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">طھظپطµظٹظ„ ط§ظ„ظپظˆط§طھظٹط± ط§ظ„ط®ط§ط¶ط¹ط© ظ„ظ„ط¶ط±ظٹط¨ط©</h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => exportCsv("vat-report.csv", [
                ...(data?.sales.filter((s) => s.doc_type === "invoice" && Number(s.tax_total) > 0).map((s) => ({ source: "ظ…ط¨ظٹط¹ط§طھ", num: s.doc_number, date: s.date, who: s.customer_name, subtotal: s.subtotal, vat: s.tax_total, total: s.total })) || []),
                ...(data?.insInv.map((i) => ({ source: "طھط£ظ…ظٹظ†", num: i.invoice_number, date: (i.issued_at || "").slice(0, 10), who: i.insurance_company_name, subtotal: i.subtotal, vat: i.vat, total: i.total })) || []),
              ], [
                { key: "source", label: "ط§ظ„ظ…طµط¯ط±" }, { key: "num", label: "ط§ظ„ط±ظ‚ظ…" }, { key: "date", label: "ط§ظ„طھط§ط±ظٹط®" },
                { key: "who", label: "ط§ظ„ط¬ظ‡ط©" }, { key: "subtotal", label: "ط§ظ„طµط§ظپظٹ" }, { key: "vat", label: "VAT" }, { key: "total", label: "ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ" },
              ])}>
                <FileSpreadsheet size={14} /> CSV
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>ط¹ط¯ط¯ ظپظˆط§طھظٹط± ط§ظ„ظ…ط¨ظٹط¹ط§طھ: <b>{vat.salesInvoicesCount}</b> آ· ظپظˆط§طھظٹط± ط§ظ„طھط£ظ…ظٹظ†: <b>{vat.insCount}</b> آ· ظپظˆط§طھظٹط± ط§ظ„ط´ط±ط§ط،: <b>{vat.purchasesCount}</b></p>
              <p>{vat.inputActual > 0 ? `VAT ط§ظ„ظ…ط¯ط®ظ„ط© ظ…ط­ط³ظˆط¨ط© ظپط¹ظ„ظٹط§ظ‹ ظ…ظ† ${vat.purchasesCount} ظپط§طھظˆط±ط© ط´ط±ط§ط،.` : "ظ„ط§ طھظˆط¬ط¯ ظپظˆط§طھظٹط± ط´ط±ط§ط، â€” طھظ… طھظ‚ط¯ظٹط± VAT ط§ظ„ظ…ط¯ط®ظ„ط© ظƒظ€ 5% ظ…ظ† ط§ظ„ظ…طµط±ظˆظپط§طھ (ظٹظ…ظƒظ† ط¥ط¯ط®ط§ظ„ ظپظˆط§طھظٹط± ط´ط±ط§ط، ظ„ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط±ظ‚ظ… ظپط¹ظ„ظٹ)."}</p>
            </div>
          </Card>
        </TabsContent>

        {/* ===== Income ===== */}
        <TabsContent value="income" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ" value={formatMoney(income.revenue)} icon={TrendingUp} variant="success" />
            <StatCard title="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…طµط±ظˆظپط§طھ" value={formatMoney(income.expenses)} icon={TrendingDown} variant="warning" />
            <StatCard title="طµط§ظپظٹ ط§ظ„ط±ط¨ط­" value={formatMoney(income.profit)} icon={TrendingUp} variant={income.profit >= 0 ? "gold" : "warning"} />
            <StatCard title="ظ‡ط§ظ…ط´ ط§ظ„ط±ط¨ط­" value={`${income.margin.toFixed(1)}%`} icon={BarChart3} variant="info" />
          </div>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">ظ‚ط§ط¦ظ…ط© ط§ظ„ط¯ط®ظ„ ط§ظ„ظ…ط®طھطµط±ط©</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                <tr><td className="py-2">ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„ظ…ط¨ظٹط¹ط§طھ (ط¨ط¯ظˆظ† VAT)</td><td className="py-2 text-left font-mono" dir="ltr">{formatMoney(income.salesRev)}</td></tr>
                <tr><td className="py-2">ط¥ظٹط±ط§ط¯ط§طھ ط§ظ„طھط£ظ…ظٹظ† (ط¨ط¯ظˆظ† VAT)</td><td className="py-2 text-left font-mono" dir="ltr">{formatMoney(income.insRev)}</td></tr>
                <tr><td className="py-2 font-semibold">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ</td><td className="py-2 text-left font-mono font-bold text-success" dir="ltr">{formatMoney(income.revenue)}</td></tr>
                <tr><td className="py-2 text-destructive">(-) ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„طھط´ط؛ظٹظ„ظٹط©</td><td className="py-2 text-left font-mono text-destructive" dir="ltr">({formatMoney(income.expenses)})</td></tr>
                <tr><td className="py-2 font-bold">طµط§ظپظٹ ط§ظ„ط±ط¨ط­</td><td className="py-2 text-left font-mono font-bold" dir="ltr">{formatMoney(income.profit)}</td></tr>
                <tr><td className="py-2 text-xs text-muted-foreground">ظ„ظ„ط¹ظ„ظ…: ط¯ظپط¹ط§طھ ط§ظ„طھط£ظ…ظٹظ† ط§ظ„ظ…ط­طµظ‘ظ„ط© ظپط¹ظ„ظٹط§ظ‹</td><td className="py-2 text-left font-mono text-xs text-muted-foreground" dir="ltr">{formatMoney(income.claimsReceived)}</td></tr>
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ===== Aging ===== */}
        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard title="ط¬ط§ط±ظٹ (ط؛ظٹط± ظ…ط³طھط­ظ‚)" value={formatMoney(aging.buckets.current)} icon={Clock} variant="info" />
            <StatCard title="1-30 ظٹظˆظ…" value={formatMoney(aging.buckets.b30)} icon={Clock} variant="gold" />
            <StatCard title="31-60 ظٹظˆظ…" value={formatMoney(aging.buckets.b60)} icon={Clock} variant="warning" />
            <StatCard title="61-90 ظٹظˆظ…" value={formatMoney(aging.buckets.b90)} icon={Clock} variant="warning" />
            <StatCard title="+90 ظٹظˆظ…" value={formatMoney(aging.buckets.b90plus)} icon={Clock} variant="gold" />
          </div>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">ط§ظ„ط°ظ…ظ… ط§ظ„ظ…ط¹ظ„ظ‚ط© â€” ط¥ط¬ظ…ط§ظ„ظٹ: <span className="font-mono" dir="ltr">{formatMoney(aging.total)}</span></h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => exportCsv("aging-report.csv", aging.rows, [
                { key: "kind", label: "ط§ظ„ظ†ظˆط¹" }, { key: "who", label: "ط§ظ„ط¬ظ‡ط©" }, { key: "num", label: "ط§ظ„ط±ظ‚ظ…" },
                { key: "due", label: "طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚" }, { key: "days", label: "ط£ظٹط§ظ… ط§ظ„طھط£ط®ظٹط±" }, { key: "balance", label: "ط§ظ„ط±طµظٹط¯" }, { key: "bucket", label: "ط§ظ„ظپط¦ط©" },
              ])}>
                <FileSpreadsheet size={14} /> CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-right py-2">ط§ظ„ظ†ظˆط¹</th>
                    <th className="text-right py-2">ط§ظ„ط¬ظ‡ط©</th>
                    <th className="text-right py-2">ط§ظ„ط±ظ‚ظ…</th>
                    <th className="text-right py-2">ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</th>
                    <th className="text-right py-2">ط£ظٹط§ظ… ط§ظ„طھط£ط®ظٹط±</th>
                    <th className="text-left py-2">ط§ظ„ط±طµظٹط¯</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {aging.rows.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">ظ„ط§ طھظˆط¬ط¯ ط°ظ…ظ… ظ…ط¹ظ„ظ‚ط© ظپظٹ ظ‡ط°ظ‡ ط§ظ„ظپطھط±ط©</td></tr>
                  ) : aging.rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="hover:bg-secondary/30">
                      <td className="py-2">{r.kind}</td>
                      <td className="py-2">{r.who}</td>
                      <td className="py-2 font-mono">{r.num}</td>
                      <td className="py-2 font-mono" dir="ltr">{r.due || "â€”"}</td>
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
            <h3 className="text-sm font-semibold mb-3">ط§ظ„ط¥ظٹط±ط§ط¯ط§طھ/ط§ظ„ظ…طµط±ظˆظپط§طھ/ط§ظ„ط±ط¨ط­ ط­ط³ط¨ ط§ظ„ط´ظ‡ط±</h3>
            {monthly.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">ظ„ط§ طھظˆط¬ط¯ ط¨ظٹط§ظ†ط§طھ ظپظٹ ط§ظ„ظپطھط±ط© ط§ظ„ظ…ط®طھط§ط±ط©</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, direction: "rtl" }} />
                  <Legend wrapperStyle={{ direction: "rtl" }} />
                  <Bar dataKey="revenue" name="ط¥ظٹط±ط§ط¯ط§طھ" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="ظ…طµط±ظˆظپط§طھ" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="ط±ط¨ط­" fill="hsl(42, 90%, 55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
          {monthly.length > 1 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">ط§طھط¬ط§ظ‡ طµط§ظپظٹ ط§ظ„ط±ط¨ط­</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, direction: "rtl" }} />
                  <Line type="monotone" dataKey="profit" name="ط±ط¨ط­" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
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
