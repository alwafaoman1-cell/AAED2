import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import StatCard from "@/components/StatCard";
import {
  TrendingUp, FileText, CheckCircle, Banknote, DollarSign, Wrench, Truck,
  Clock, Hourglass, AlertTriangle, FileSpreadsheet, Printer, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  exportReportToPdf, exportReportToXlsx, printReport,
  type ReportExportPayload, type ReportColumn,
} from "@/lib/reportExporters";

type Preset = "custom" | "this_month" | "last_month" | "this_year" | "last_year" | "month_year";

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0);
const dstr = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

function statusLabel(s: string) {
  return { pending: "معلقة", approved: "معتمدة", paid: "مدفوعة", rejected: "مرفوضة", cancelled: "ملغية" }[s] || s;
}
function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid") return "default";
  if (s === "approved") return "secondary";
  if (s === "rejected" || s === "cancelled") return "destructive";
  return "outline";
}

// كل الأعمدة المتاحة في الجدول التفصيلي
const ALL_COLUMNS: { key: string; label: string }[] = [
  { key: "claim_number", label: "رقم المطالبة" },
  { key: "insurance_company", label: "شركة التأمين" },
  { key: "customer", label: "العميل" },
  { key: "vehicle", label: "المركبة" },
  { key: "plate", label: "اللوحة" },
  { key: "arrival", label: "تاريخ الدخول" },
  { key: "delivered", label: "تاريخ التسليم" },
  { key: "estimated", label: "قيمة التقدير" },
  { key: "approved", label: "القيمة المعتمدة" },
  { key: "collected", label: "المحصّل" },
  { key: "status", label: "الحالة" },
];

export default function InvestorsReport() {
  const { data: claims = [], isLoading } = useInsuranceClaims();

  const { data: payments = [] } = useQuery({
    queryKey: ["claim_payments", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_payments" as any)
        .select("claim_id, amount, status");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const paidByClaim = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "cleared") m.set(p.claim_id, (m.get(p.claim_id) || 0) + Number(p.amount || 0));
    }
    return m;
  }, [payments]);

  // ── Filters ──────────────────────────────────────────────
  const today = new Date();
  const [preset, setPreset] = useState<Preset>("this_month");
  const [from, setFrom] = useState<string>(() => firstDayOfMonth(today));
  const [to, setTo] = useState<string>(() => isoDay(today));
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year, setYear] = useState<number>(today.getFullYear());

  // ── Report content toggles (ما الذي يدخل في التقرير المطبوع/المُصدَّر) ─
  const [includeFinancial, setIncludeFinancial] = useState(true);
  const [includeOps, setIncludeOps] = useState(true);
  const [includeMissing, setIncludeMissing] = useState(false);
  const [includeTable, setIncludeTable] = useState(true);
  const [selectedCols, setSelectedCols] = useState<string[]>(ALL_COLUMNS.map((c) => c.key));

  function toggleCol(key: string) {
    setSelectedCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function applyPreset(p: Preset) {
    setPreset(p);
    const now = new Date();
    if (p === "this_month") { setFrom(firstDayOfMonth(now)); setTo(isoDay(now)); }
    else if (p === "last_month") {
      const a = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const b = new Date(now.getFullYear(), now.getMonth(), 0);
      setFrom(isoDay(a)); setTo(isoDay(b));
    }
    else if (p === "this_year") { setFrom(`${now.getFullYear()}-01-01`); setTo(isoDay(now)); }
    else if (p === "last_year") { setFrom(`${now.getFullYear() - 1}-01-01`); setTo(`${now.getFullYear() - 1}-12-31`); }
    else if (p === "month_year") {
      const a = new Date(year, month - 1, 1);
      const b = new Date(year, month, 0);
      setFrom(isoDay(a)); setTo(isoDay(b));
    }
  }

  function applyMonthYear(m: number, y: number) {
    setMonth(m); setYear(y); setPreset("month_year");
    const a = new Date(y, m - 1, 1);
    const b = new Date(y, m, 0);
    setFrom(isoDay(a)); setTo(isoDay(b));
  }

  // ── Bucket claims ───────────────────────────────────────
  const fromTs = from ? new Date(from + "T00:00:00").getTime() : 0;
  const toTs = to ? new Date(to + "T23:59:59").getTime() : Number.MAX_SAFE_INTEGER;

  const missingDate = useMemo(
    () => claims.filter((c) => !c.workshop_arrival_date),
    [claims],
  );

  const inRange = useMemo(() => {
    return claims.filter((c) => {
      if (!c.workshop_arrival_date) return false;
      const t = new Date(c.workshop_arrival_date).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [claims, fromTs, toTs]);

  // ── Aggregates ──────────────────────────────────────────
  const stats = useMemo(() => {
    let received = inRange.length;
    let entered = 0, delivered = 0, working = 0, pendingApproval = 0, paid = 0;
    let estTotal = 0, approvedTotal = 0, collectedTotal = 0;

    for (const c of inRange) {
      if (c.workshop_arrival_date) entered++;
      if (c.delivered_at) delivered++;
      if (c.workshop_arrival_date && !c.delivered_at) working++;
      if (c.status === "pending") pendingApproval++;
      if (c.status === "paid") paid++;
      estTotal += Number(c.estimated_amount || 0);
      approvedTotal += Number(c.approved_amount || 0);
      const fromPays = paidByClaim.get(c.id) || 0;
      const fallback = c.status === "paid" && fromPays === 0
        ? Number(c.approved_amount || c.estimated_amount || 0) : 0;
      collectedTotal += fromPays + fallback;
    }
    const avgClaim = received > 0 ? estTotal / received : 0;
    const completionRate = received > 0 ? (delivered / received) * 100 : 0;
    return {
      received, entered, delivered, working, pendingApproval, paid,
      estTotal, approvedTotal, collectedTotal, avgClaim, completionRate,
    };
  }, [inRange, paidByClaim]);

  // ── بناء حمولة التقرير الموحَّدة ─────────────────────────
  function buildPayload(): ReportExportPayload {
    const colDefs: Record<string, ReportColumn & { value: (c: any) => any }> = {
      claim_number:      { key: "claim_number", label: "رقم المطالبة", align: "right",  value: (c) => c.claim_number },
      insurance_company: { key: "insurance_company", label: "شركة التأمين", align: "right", value: (c) => c.insurance_company || "" },
      customer:          { key: "customer", label: "العميل", align: "right", value: (c) => c.customer?.name || "" },
      vehicle:           { key: "vehicle", label: "المركبة", align: "right", value: (c) => [c.vehicle?.brand, c.vehicle?.model, c.vehicle?.year].filter(Boolean).join(" ") },
      plate:             { key: "plate", label: "اللوحة", align: "center", value: (c) => c.vehicle?.plate_number || "" },
      arrival:           { key: "arrival", label: "تاريخ الدخول", align: "center", value: (c) => dstr(c.workshop_arrival_date) },
      delivered:         { key: "delivered", label: "تاريخ التسليم", align: "center", value: (c) => dstr(c.delivered_at) },
      estimated:         { key: "estimated", label: "قيمة التقدير", align: "left", value: (c) => Number(c.estimated_amount || 0) },
      approved:          { key: "approved", label: "القيمة المعتمدة", align: "left", value: (c) => Number(c.approved_amount || 0) },
      collected:         { key: "collected", label: "المحصّل", align: "left", value: (c) => paidByClaim.get(c.id) || 0 },
      status:            { key: "status", label: "الحالة", align: "center", value: (c) => statusLabel(c.status) },
    };

    const orderedKeys = ALL_COLUMNS.map((c) => c.key).filter((k) => selectedCols.includes(k));
    const columns: ReportColumn[] = includeTable
      ? orderedKeys.map((k) => ({ key: colDefs[k].key, label: colDefs[k].label, align: colDefs[k].align }))
      : [];

    const rows = includeTable
      ? inRange.map((c) => {
          const r: Record<string, any> = {};
          for (const k of orderedKeys) r[k] = colDefs[k].value(c);
          return r;
        })
      : [];

    // الملخص
    const summary: { label: string; value: string }[] = [];
    if (includeFinancial) {
      summary.push(
        { label: "إجمالي الإيرادات (محصّل)", value: `${fmt(stats.collectedTotal)} OMR` },
        { label: "إجمالي التقديرات", value: `${fmt(stats.estTotal)} OMR` },
        { label: "إجمالي المعتمد", value: `${fmt(stats.approvedTotal)} OMR` },
        { label: "متوسط قيمة المطالبة", value: `${fmt(stats.avgClaim)} OMR` },
        { label: "نسبة الإنجاز", value: `${stats.completionRate.toFixed(1)}%` },
      );
    }
    if (includeOps) {
      summary.push(
        { label: "مطالبات مستلمة", value: String(stats.received) },
        { label: "سيارات دخلت الورشة", value: String(stats.entered) },
        { label: "سيارات مسلَّمة", value: String(stats.delivered) },
        { label: "قيد العمل", value: String(stats.working) },
        { label: "بانتظار الموافقة", value: String(stats.pendingApproval) },
        { label: "المدفوعة", value: String(stats.paid) },
      );
    }
    if (includeMissing) {
      summary.push({ label: "مطالبات ببيانات ناقصة (مستثناة)", value: String(missingDate.length) });
    }

    return {
      title: "تقرير المستثمرين",
      subtitle: "مبني على تاريخ دخول السيارة للورشة داخل المطالبة",
      rangeLabel: `${from} → ${to}`,
      columns,
      rows,
      summary,
    };
  }

  function handlePdf() {
    if (!includeFinancial && !includeOps && !includeTable && !includeMissing) {
      toast.error("اختر قسماً واحداً على الأقل لتضمينه في التقرير");
      return;
    }
    void exportReportToPdf(buildPayload(), `investors_report_${from}_${to}.pdf`);
    toast.success("جاري تجهيز ملف PDF…");
  }

  function handleExcel() {
    exportReportToXlsx(buildPayload(), `investors_report_${from}_${to}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  }

  function handlePrint() {
    printReport(buildPayload());
  }

  // Years dropdown
  const years = useMemo(() => {
    const ys = new Set<number>([today.getFullYear()]);
    for (const c of claims) {
      const d = c.workshop_arrival_date || c.created_at;
      if (d) ys.add(new Date(d).getFullYear());
    }
    return Array.from(ys).sort((a, b) => b - a);
  }, [claims]);

  const allColsSelected = selectedCols.length === ALL_COLUMNS.length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="text-primary" /> تقرير المستثمرين
          </h1>
          <p className="text-xs text-muted-foreground">
            مبني على <b>تاريخ دخول السيارة للورشة</b> داخل المطالبة — وليس تاريخ الإنشاء أو التقدير.
          </p>
        </div>
      </div>

      {/* Filters: الفترة */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {([
            ["this_month", "هذا الشهر"],
            ["last_month", "الشهر السابق"],
            ["this_year", "هذه السنة"],
            ["last_year", "السنة السابقة"],
            ["custom", "نطاق مخصص"],
            ["month_year", "شهر/سنة"],
          ] as [Preset, string][]).map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant={preset === k ? "default" : "outline"}
              onClick={() => (k === "month_year" ? applyMonthYear(month, year) : applyPreset(k))}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">من تاريخ</label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">إلى تاريخ</label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">شهر</label>
            <Select value={String(month)} onValueChange={(v) => applyMonthYear(Number(v), year)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>{monthName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">سنة</label>
            <Select value={String(year)} onValueChange={(v) => applyMonthYear(month, Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* فلتر محتويات التقرير + أزرار الطباعة/التصدير */}
      <Card className="p-4 space-y-4 border-primary/30">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold flex items-center gap-2">
            <Settings2 size={16} className="text-primary" />
            محتويات التقرير — اختر ما يظهر في PDF / Excel / الطباعة
          </h3>
        </div>

        {/* أقسام التقرير */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox checked={includeFinancial} onCheckedChange={(v) => setIncludeFinancial(!!v)} />
            الملخص المالي
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox checked={includeOps} onCheckedChange={(v) => setIncludeOps(!!v)} />
            مؤشرات التشغيل
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox checked={includeTable} onCheckedChange={(v) => setIncludeTable(!!v)} />
            الجدول التفصيلي
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox checked={includeMissing} onCheckedChange={(v) => setIncludeMissing(!!v)} />
            عدّ البيانات الناقصة
          </label>
        </div>

        {/* أعمدة الجدول التفصيلي */}
        {includeTable && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">أعمدة الجدول التفصيلي:</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSelectedCols(allColsSelected ? [] : ALL_COLUMNS.map((c) => c.key))}
              >
                {allColsSelected ? "إلغاء الكل" : "تحديد الكل"}
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 cursor-pointer text-xs">
                  <Checkbox
                    checked={selectedCols.includes(c.key)}
                    onCheckedChange={() => toggleCol(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* أزرار التصدير/الطباعة */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          <Button onClick={handlePdf} className="gap-2 bg-destructive hover:bg-destructive/90">
            <FileText size={16} /> تصدير PDF
          </Button>
          <Button onClick={handleExcel} className="gap-2 bg-success hover:bg-success/90">
            <FileSpreadsheet size={16} /> تصدير Excel
          </Button>
          <Button variant="outline" onClick={handlePrint} className="gap-2">
            <Printer size={16} /> طباعة
          </Button>
        </div>
      </Card>

      {/* Financial summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="إجمالي الإيرادات (محصّل)" value={`${fmt(stats.collectedTotal)} OMR`} icon={DollarSign} variant="gold" />
        <StatCard title="متوسط قيمة المطالبة" value={`${fmt(stats.avgClaim)} OMR`} icon={TrendingUp} variant="info" />
        <StatCard title="المطالبات المنجزة" value={stats.delivered} icon={CheckCircle} variant="success" />
        <StatCard title="نسبة الإنجاز" value={`${stats.completionRate.toFixed(1)}%`} icon={TrendingUp} variant="gold" />
      </div>

      {/* Ops KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="مطالبات مستلمة" value={stats.received} icon={FileText} variant="info" />
        <StatCard title="سيارات دخلت الورشة" value={stats.entered} icon={Wrench} variant="info" />
        <StatCard title="سيارات مسلَّمة" value={stats.delivered} icon={Truck} variant="success" />
        <StatCard title="قيد العمل" value={stats.working} icon={Hourglass} variant="warning" />
        <StatCard title="بانتظار الموافقة" value={stats.pendingApproval} icon={Clock} variant="warning" />
        <StatCard title="المدفوعة" value={stats.paid} icon={CheckCircle} variant="success" />
        <StatCard title="إجمالي التقديرات" value={`${fmt(stats.estTotal)} OMR`} icon={FileText} variant="info" />
        <StatCard title="إجمالي المعتمد" value={`${fmt(stats.approvedTotal)} OMR`} icon={Banknote} variant="success" />
      </div>

      {/* Missing dates */}
      {missingDate.length > 0 && (
        <Card className="p-4 border-warning/30 bg-warning/5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold flex items-center gap-2 text-warning">
              <AlertTriangle size={16} /> بيانات ناقصة — لم يُسجَّل تاريخ دخول الورشة ({missingDate.length})
            </h3>
            <Badge variant="outline" className="text-xs">لا تدخل في الإحصائيات</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            استكمل "تاريخ دخول السيارة" لكل مطالبة من صفحة المطالبة لتظهر في تقارير المستثمرين الشهرية.
          </p>
          <div className="max-h-40 overflow-auto rounded border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 sticky top-0">
                <tr>
                  <th className="p-2 text-right">رقم المطالبة</th>
                  <th className="p-2 text-right">شركة التأمين</th>
                  <th className="p-2 text-right">العميل</th>
                  <th className="p-2 text-right">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {missingDate.slice(0, 50).map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-2 font-mono">{c.claim_number}</td>
                    <td className="p-2">{c.insurance_company || "—"}</td>
                    <td className="p-2">{c.customer?.name || "—"}</td>
                    <td className="p-2">{dstr(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detailed table */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border bg-secondary/30 flex items-center justify-between">
          <h3 className="font-semibold">جدول تفصيلي — {inRange.length} مطالبة</h3>
          <span className="text-xs text-muted-foreground">{from} → {to}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-secondary/40">
              <tr>
                <th className="p-2 text-right whitespace-nowrap">رقم المطالبة</th>
                <th className="p-2 text-right whitespace-nowrap">شركة التأمين</th>
                <th className="p-2 text-right whitespace-nowrap">العميل</th>
                <th className="p-2 text-right whitespace-nowrap">المركبة</th>
                <th className="p-2 text-right whitespace-nowrap">اللوحة</th>
                <th className="p-2 text-right whitespace-nowrap">تاريخ الدخول</th>
                <th className="p-2 text-right whitespace-nowrap">تاريخ التسليم</th>
                <th className="p-2 text-right whitespace-nowrap">قيمة التقدير</th>
                <th className="p-2 text-right whitespace-nowrap">القيمة المعتمدة</th>
                <th className="p-2 text-right whitespace-nowrap">المحصّل</th>
                <th className="p-2 text-right whitespace-nowrap">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">جاري التحميل…</td></tr>
              ) : inRange.length === 0 ? (
                <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">لا توجد مطالبات ضمن هذه الفترة (حسب تاريخ الدخول).</td></tr>
              ) : (
                inRange.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-secondary/30">
                    <td className="p-2 font-mono">{c.claim_number}</td>
                    <td className="p-2">{c.insurance_company || "—"}</td>
                    <td className="p-2">{c.customer?.name || "—"}</td>
                    <td className="p-2">{[c.vehicle?.brand, c.vehicle?.model, c.vehicle?.year].filter(Boolean).join(" ") || "—"}</td>
                    <td className="p-2 font-mono">{c.vehicle?.plate_number || "—"}</td>
                    <td className="p-2 font-mono">{dstr(c.workshop_arrival_date)}</td>
                    <td className="p-2 font-mono">{dstr(c.delivered_at)}</td>
                    <td className="p-2 font-mono">{fmt(Number(c.estimated_amount || 0))}</td>
                    <td className="p-2 font-mono">{fmt(Number(c.approved_amount || 0))}</td>
                    <td className="p-2 font-mono">{fmt(paidByClaim.get(c.id) || 0)}</td>
                    <td className="p-2"><Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge></td>
                  </tr>
                ))
              )}
            </tbody>
            {inRange.length > 0 && (
              <tfoot className="bg-secondary/40 font-bold">
                <tr>
                  <td className="p-2" colSpan={7}>الإجمالي</td>
                  <td className="p-2 font-mono">{fmt(stats.estTotal)}</td>
                  <td className="p-2 font-mono">{fmt(stats.approvedTotal)}</td>
                  <td className="p-2 font-mono">{fmt(stats.collectedTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────
function isoDay(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function firstDayOfMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthName(m: number) {
  return ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"][m - 1];
}
