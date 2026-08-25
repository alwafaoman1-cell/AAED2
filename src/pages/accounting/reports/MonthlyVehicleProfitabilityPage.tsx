import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, CalendarRange, Car, FileDown, FileSpreadsheet, Filter, Printer, ReceiptText, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatOMR } from "@/lib/money";
import { hasAccountingPermission } from "@/lib/accounting/accountingAdministrationService";
import { exportReportRowsToPdf, printReportRows, type ReportExportRequest } from "@/lib/reports-center/reportExportService";
import {
  fetchAllMonthlyVehicleProfitabilityRows,
  fetchMonthlyVehicleProfitability,
  monthlyVehicleProfitabilityKeys,
  type MonthlyBusinessType,
  type MonthlyVehicleProfitabilityFilters,
  type MonthlyVehicleProfitabilityRow,
} from "@/lib/accounting/monthlyVehicleProfitability";
import {
  exportMonthlyWorkshopWorkbook,
  fetchMonthlyWorkshopOverheads,
  monthlyWorkshopReportKeys,
} from "@/lib/accounting/monthlyWorkshopReport";

type Column = { key: string; ar: string; en: string; type?: "money" | "date" | "number" | "percentage"; default?: boolean };

const COLUMNS: Column[] = [
  { key: "work_order_number", ar: "رقم أمر العمل", en: "Work Order", default: true },
  { key: "claim_number", ar: "رقم المطالبة", en: "Claim No.", default: true },
  { key: "customer_code", ar: "كود العميل", en: "Customer Code" },
  { key: "customer_name", ar: "اسم العميل", en: "Customer", default: true },
  { key: "customer_phone", ar: "الهاتف", en: "Phone" },
  { key: "insurance_company", ar: "شركة التأمين", en: "Insurance Company", default: true },
  { key: "plate_number", ar: "رقم اللوحة", en: "Plate Number", default: true },
  { key: "plate_letters", ar: "حروف اللوحة", en: "Plate Letters", default: true },
  { key: "plate_country", ar: "دولة اللوحة", en: "Plate Country" },
  { key: "brand", ar: "الماركة", en: "Make", default: true },
  { key: "model", ar: "الموديل", en: "Model", default: true },
  { key: "year", ar: "السنة", en: "Year", type: "number" },
  { key: "color", ar: "اللون", en: "Color" },
  { key: "vin", ar: "رقم الهيكل", en: "VIN" },
  { key: "mileage", ar: "العداد", en: "Mileage", type: "number" },
  { key: "vehicle_type", ar: "نوع المركبة", en: "Vehicle Type" },
  { key: "received_at", ar: "وصول الورشة", en: "Workshop Arrival", type: "date" },
  { key: "delivered_at", ar: "تاريخ التسليم", en: "Delivery Date", type: "date" },
  { key: "workshop_days", ar: "أيام الورشة", en: "Workshop Days", type: "number" },
  { key: "work_order_status", ar: "حالة أمر العمل", en: "Work Order Status" },
  { key: "invoice_numbers", ar: "أرقام الفواتير", en: "Invoice Numbers", default: true },
  { key: "invoice_dates", ar: "تواريخ الفواتير", en: "Invoice Dates", default: true },
  { key: "invoiced_ex_vat", ar: "المفوتر قبل الضريبة", en: "Invoiced Ex. VAT", type: "money", default: true },
  { key: "vat", ar: "ضريبة VAT", en: "VAT", type: "money", default: true },
  { key: "invoiced_total", ar: "الإجمالي شامل الضريبة", en: "Total Incl. VAT", type: "money" },
  { key: "collected", ar: "المبلغ المحصل", en: "Collected", type: "money", default: true },
  { key: "outstanding", ar: "المبلغ المستحق", en: "Outstanding", type: "money", default: true },
  { key: "parts_cost", ar: "تكلفة قطع الغيار", en: "Parts Cost", type: "money", default: true },
  { key: "labor_cost", ar: "تكلفة العمالة", en: "Labor Cost", type: "money" },
  { key: "operating_cost", ar: "تشغيل مباشر", en: "Direct Operating", type: "money" },
  { key: "direct_cost", ar: "إجمالي التكلفة المباشرة", en: "Total Direct Cost", type: "money", default: true },
  { key: "gross_profit", ar: "ربح/خسارة السيارة", en: "Vehicle Profit/Loss", type: "money", default: true },
  { key: "profit_margin", ar: "هامش الربح %", en: "Profit Margin %", type: "percentage", default: true },
  { key: "accounting_status", ar: "اكتمال البيانات", en: "Accounting Completeness" },
];

function monthBounds() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: iso(first), to: iso(last) };
}

function display(value: unknown, column: Column) {
  if (column.type === "money") return formatOMR(Number(value || 0));
  if (column.type === "percentage") return `${Number(value || 0).toFixed(2)}%`;
  if (column.type === "number") return Number(value || 0).toLocaleString("en-US");
  if (column.type === "date" && value) return String(value).slice(0, 10);
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export default function MonthlyVehicleProfitabilityPage() {
  const { profile } = useAuth();
  const bounds = useMemo(monthBounds, []);
  const [businessType, setBusinessType] = useState<MonthlyBusinessType>("cash");
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState(() => COLUMNS.filter((column) => column.default).map((column) => column.key));
  const [exporting, setExporting] = useState<string | null>(null);
  const filters: MonthlyVehicleProfitabilityFilters = { from, to, businessType, search: appliedSearch, page, pageSize: 50 };
  const report = useQuery({
    queryKey: monthlyVehicleProfitabilityKeys.report(profile?.tenant_id, filters),
    queryFn: ({ signal }) => fetchMonthlyVehicleProfitability(filters, signal),
    enabled: Boolean(profile?.tenant_id), staleTime: 120_000, gcTime: 900_000, refetchOnWindowFocus: false,
  });
  const oppositeType: MonthlyBusinessType = businessType === "cash" ? "insurance" : "cash";
  const oppositeFilters: MonthlyVehicleProfitabilityFilters = { ...filters, businessType: oppositeType, page: 1, pageSize: 1 };
  const oppositeReport = useQuery({
    queryKey: monthlyVehicleProfitabilityKeys.report(profile?.tenant_id, oppositeFilters),
    queryFn: ({ signal }) => fetchMonthlyVehicleProfitability(oppositeFilters, signal),
    enabled: Boolean(profile?.tenant_id), staleTime: 120_000, gcTime: 900_000, refetchOnWindowFocus: false,
  });
  const overheadReport = useQuery({
    queryKey: monthlyWorkshopReportKeys.overheads(profile?.tenant_id, from, to),
    queryFn: ({ signal }) => fetchMonthlyWorkshopOverheads(from, to, signal),
    enabled: Boolean(profile?.tenant_id), staleTime: 120_000, gcTime: 900_000, refetchOnWindowFocus: false,
  });
  const selectedColumns = COLUMNS.filter((column) => visible.includes(column.key));
  const aggregates = report.data?.aggregates;
  const overheads = report.data?.overheads;

  const exportRequest = (rows: MonthlyVehicleProfitabilityRow[]): ReportExportRequest<MonthlyVehicleProfitabilityRow> => ({
    fileName: `${businessType === "cash" ? "Cash" : "Insurance"}_Vehicle_Profitability_${from}_${to}.xlsx`,
    sheetName: businessType === "cash" ? "Cash Vehicles" : "Insurance Vehicles",
    title: businessType === "cash" ? "تقرير ربحية سيارات الكاش" : "تقرير ربحية سيارات التأمين",
    filters: [{ label: "من", value: from }, { label: "إلى", value: to }, { label: "نوع الأعمال", value: businessType === "cash" ? "كاش" : "تأمين" }, { label: "البحث", value: appliedSearch || "الكل" }],
    columns: selectedColumns.map((column) => ({ key: column.key, label: column.ar, type: column.type })),
    rows, language: "ar", generatedBy: profile?.full_name || profile?.user_id || "System", generatedAt: new Date().toISOString(),
  });

  async function runExport(kind: "xlsx" | "pdf" | "print") {
    setExporting(kind);
    try {
      if (!selectedColumns.length) throw new Error("اختر عمودًا واحدًا على الأقل قبل إنشاء المستخرج");
      const permission = kind === "xlsx" ? "accounting_reports.export_excel" : kind === "pdf" ? "accounting_reports.export_pdf" : "accounting_reports.print";
      if (!await hasAccountingPermission(permission)) throw new Error("لا تملك صلاحية إنشاء هذا المستخرج");
      if (kind === "xlsx") {
        const cashFilters = { ...filters, businessType: "cash" as const };
        const insuranceFilters = { ...filters, businessType: "insurance" as const };
        const [cashRows, insuranceRows, cashResult, insuranceResult, overheads] = await Promise.all([
          fetchAllMonthlyVehicleProfitabilityRows(cashFilters),
          fetchAllMonthlyVehicleProfitabilityRows(insuranceFilters),
          fetchMonthlyVehicleProfitability({ ...cashFilters, page: 1, pageSize: 1 }),
          fetchMonthlyVehicleProfitability({ ...insuranceFilters, page: 1, pageSize: 1 }),
          fetchMonthlyWorkshopOverheads(from, to),
        ]);
        if (!cashRows.length && !insuranceRows.length && !overheads.expenseRows.length) throw new Error("لا توجد سجلات مطابقة للتصدير");
        exportMonthlyWorkshopWorkbook({ from, to, cashRows, insuranceRows, overheads, cashSummary: cashResult.aggregates, insuranceSummary: insuranceResult.aggregates });
        toast.success("تم إنشاء ملف Excel الشهري بأربع أوراق");
        return;
      }
      const rows = await fetchAllMonthlyVehicleProfitabilityRows(filters);
      if (!rows.length) throw new Error("لا توجد سجلات مطابقة للتصدير");
      const request = exportRequest(rows);
      if (kind === "pdf") await exportReportRowsToPdf(request);
      else await printReportRows(request);
      toast.success("تم إنشاء المستخرج بنجاح");
    } catch (error) { toast.error((error as Error).message); }
    finally { setExporting(null); }
  }

  const kpis = [
    ["الإيراد المفوتر قبل VAT", aggregates?.invoiced_ex_vat, "text-blue-600"], ["المبلغ المحصل", aggregates?.collected, "text-emerald-600"],
    ["المبلغ المستحق", aggregates?.outstanding, "text-amber-600"], ["التكلفة المباشرة", aggregates?.direct_cost, "text-rose-600"],
    ["ربح السيارات المباشر", aggregates?.gross_profit, Number(aggregates?.gross_profit || 0) >= 0 ? "text-emerald-600" : "text-rose-600"],
    ["المصروفات العامة (غير موزعة)", overheadReport.data?.summary.subtotal ?? overheads?.total, "text-slate-700"],
  ] as const;

  const cashAggregates = businessType === "cash" ? aggregates : oppositeReport.data?.aggregates;
  const insuranceAggregates = businessType === "insurance" ? aggregates : oppositeReport.data?.aggregates;
  const combinedGross = Number(cashAggregates?.gross_profit || 0) + Number(insuranceAggregates?.gross_profit || 0);
  const generalExpenses = Number(overheadReport.data?.summary.subtotal || 0);
  const monthlyNet = combinedGross - generalExpenses;

  return <main className="mx-auto max-w-[1700px] space-y-5 p-4 md:p-6" dir="rtl">
    <header className="rounded-2xl border bg-gradient-to-l from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div><p className="text-xs text-blue-200">المحاسبة / التقرير الشهري</p><h1 className="mt-1 text-2xl font-bold">التقرير الشهري الشامل للورشة</h1><p className="mt-1 text-sm text-slate-300">تقرير دائم من البيانات السحابية: الكاش والتأمين وربحية المركبات والرواتب والمصروفات التشغيلية، دون استيراد ملفات.</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild variant="secondary"><Link to="/accounting/reports">كل التقارير</Link></Button><Button variant="secondary" onClick={() => { void report.refetch(); void oppositeReport.refetch(); void overheadReport.refetch(); }}><RefreshCw size={15}/>تحديث</Button></div>
      </div>
    </header>

    <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto]">
      <div className="flex rounded-xl border bg-card p-1"><Button variant={businessType === "cash" ? "default" : "ghost"} onClick={() => { setBusinessType("cash"); setPage(1); }}><Wallet size={16}/>زبائن الكاش</Button><Button variant={businessType === "insurance" ? "default" : "ghost"} onClick={() => { setBusinessType("insurance"); setPage(1); }}><ShieldCheck size={16}/>شركات التأمين</Button></div>
      <Card><CardContent className="grid gap-2 p-3 md:grid-cols-[1fr_1fr_2fr_auto]"><label className="text-xs">من<Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}/></label><label className="text-xs">إلى<Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}/></label><label className="text-xs">بحث<div className="relative"><Search className="absolute right-3 top-3" size={15}/><Input className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search); setPage(1); } }} placeholder="العميل، اللوحة، VIN، أمر العمل، المطالبة أو الفاتورة"/></div></label><Button className="self-end" onClick={() => { setAppliedSearch(search); setPage(1); }}><Filter size={15}/>تطبيق</Button></CardContent></Card>
      <div className="flex flex-wrap items-center gap-2"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><SlidersHorizontal size={15}/>الأعمدة ({visible.length})</Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-[65vh] w-64 overflow-y-auto" align="end"><DropdownMenuLabel>أعمدة العرض والتصدير</DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuCheckboxItem checked={visible.length === COLUMNS.length} onCheckedChange={(checked) => setVisible(checked ? COLUMNS.map((c) => c.key) : COLUMNS.filter((c) => c.default).map((c) => c.key))}>تحديد الكل / الافتراضي</DropdownMenuCheckboxItem>{COLUMNS.map((column) => <DropdownMenuCheckboxItem key={column.key} checked={visible.includes(column.key)} onCheckedChange={(checked) => setVisible((current) => checked ? [...new Set([...current, column.key])] : current.filter((key) => key !== column.key))}>{column.ar}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><Button variant="outline" disabled={Boolean(exporting)} onClick={() => runExport("xlsx")}><FileSpreadsheet size={15}/>Excel</Button><Button variant="outline" disabled={Boolean(exporting)} onClick={() => runExport("pdf")}><FileDown size={15}/>PDF</Button><Button variant="outline" disabled={Boolean(exporting)} onClick={() => runExport("print")}><Printer size={15}/>طباعة</Button></div>
    </div>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{kpis.map(([title, amount, color]) => <Card key={title}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{title}</p><p className={`mt-2 font-mono text-lg font-bold ${color}`} dir="ltr">{formatOMR(Number(amount || 0))}</p></CardContent></Card>)}</section>

    <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BarChart3 size={18}/>ملخص الربح والخسارة للشهر — الكاش والتأمين منفصلان</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {[
        ["ربح سيارات الكاش", cashAggregates?.gross_profit],
        ["ربح سيارات التأمين", insuranceAggregates?.gross_profit],
        ["إجمالي الربح المباشر", combinedGross],
        ["المصروفات العامة", generalExpenses],
        ["صافي ربح/خسارة الشهر", monthlyNet],
      ].map(([label, amount]) => <div key={String(label)} className="rounded-xl border bg-background p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 font-mono text-lg font-bold ${String(label).includes("صافي") && Number(amount) < 0 ? "text-rose-600" : ""}`} dir="ltr">{formatOMR(Number(amount || 0))}</p></div>)}
    </CardContent></Card>

    <Card className="border-dashed"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ReceiptText size={18}/>مصروفات الشهر العامة — لا توزّع على السيارات</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["الرواتب", overheadReport.data?.summary.salaries],["المصروفات الثابتة", overheadReport.data?.summary.fixed],["المصروفات التشغيلية", overheadReport.data?.summary.operating],["قطع غير مرتبطة", overheadReport.data?.summary.unlinked_parts],["أخرى", overheadReport.data?.summary.other],["إجمالي قبل VAT", overheadReport.data?.summary.subtotal]].map(([label, amount]) => <div key={String(label)} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono font-bold" dir="ltr">{formatOMR(Number(amount || 0))}</p></div>)}</CardContent></Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ReceiptText size={18}/>المصروفات حسب القسم والتصنيف</CardTitle></CardHeader><CardContent className="p-0">{overheadReport.isLoading ? <div className="p-10 text-center">جاري التحميل…</div> : !overheadReport.data?.groups.length ? <div className="p-10 text-center text-muted-foreground">لا توجد مصروفات تشغيلية خلال الفترة.</div> : <div className="max-h-[420px] overflow-auto"><Table><TableHeader className="sticky top-0 bg-muted"><TableRow><TableHead>القسم</TableHead><TableHead>التصنيف</TableHead><TableHead>الفرعي</TableHead><TableHead>عدد</TableHead><TableHead>قبل VAT</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader><TableBody>{overheadReport.data.groups.map((row, index) => <TableRow key={`${String(row.department_code)}-${String(row.category_code)}-${String(row.subcategory_code)}-${index}`}><TableCell>{String(row.department_ar || "—")}</TableCell><TableCell>{String(row.category_ar || "—")}</TableCell><TableCell>{String(row.subcategory_ar || "—")}</TableCell><TableCell>{Number(row.expense_count || 0)}</TableCell><TableCell dir="ltr">{formatOMR(Number(row.subtotal || 0))}</TableCell><TableCell dir="ltr">{formatOMR(Number(row.total || 0))}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users size={18}/>تفاصيل الرواتب والأجور المسجلة كمصروفات</CardTitle></CardHeader><CardContent className="p-0">{overheadReport.isLoading ? <div className="p-10 text-center">جاري التحميل…</div> : !overheadReport.data?.payrollRows.length ? <div className="p-10 text-center text-muted-foreground">لا توجد سندات رواتب مصنفة خلال الفترة.</div> : <div className="max-h-[420px] overflow-auto"><Table><TableHeader className="sticky top-0 bg-muted"><TableRow><TableHead>التاريخ</TableHead><TableHead>السند</TableHead><TableHead>الموظف/المستفيد</TableHead><TableHead>البيان</TableHead><TableHead>المبلغ</TableHead></TableRow></TableHeader><TableBody>{overheadReport.data.payrollRows.map((row, index) => <TableRow key={String(row.id || index)}><TableCell>{String(row.date || "—")}</TableCell><TableCell>{String(row.voucher_number || "—")}</TableCell><TableCell>{String(row.beneficiary || row.supplier_name || "—")}</TableCell><TableCell className="max-w-[280px]">{String(row.description || "—")}</TableCell><TableCell dir="ltr">{formatOMR(Number(row.subtotal || 0))}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    </div>

    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><Car size={19}/>تفاصيل ربح وخسارة كل سيارة</CardTitle><p className="mt-1 text-xs text-muted-foreground">الفواتير غير المدفوعة تظهر ضمن المفوتر والمستحق، بينما يبقى التحصيل صفرًا حتى تسجيل دفعة فعلية.</p></div><span className="text-sm text-muted-foreground">{report.data?.pagination.totalRows || 0} سجل</span></CardHeader><CardContent className="p-0">{report.isLoading ? <div className="p-16 text-center">جاري تحميل التقرير…</div> : report.isError ? <div className="p-10 text-center text-destructive">{(report.error as Error).message}</div> : !report.data?.rows.length ? <div className="p-16 text-center text-muted-foreground">لا توجد حركة مالية مطابقة خلال الفترة.</div> : <div className="overflow-x-auto"><Table className="min-w-max"><TableHeader className="sticky top-0 z-10 bg-muted"><TableRow>{selectedColumns.map((column) => <TableHead key={column.key} className="whitespace-nowrap">{column.ar}</TableHead>)}</TableRow></TableHeader><TableBody>{report.data.rows.map((row, index) => <TableRow key={String(row.operation_id || index)}>{selectedColumns.map((column) => <TableCell key={column.key} className={`max-w-[260px] whitespace-nowrap ${column.key === "gross_profit" ? Number(row[column.key] || 0) >= 0 ? "font-bold text-emerald-600" : "font-bold text-rose-600" : ""}`} dir={column.type === "money" || column.type === "number" || column.type === "percentage" ? "ltr" : undefined}>{display(row[column.key], column)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</CardContent></Card>

    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-2 text-muted-foreground"><CalendarRange size={16}/><span>أساس الشهر: الفاتورة حسب تاريخها، التحصيل حسب تاريخ الدفعة، والمصروف حسب تاريخ السند. VAT لا يدخل في الربح.</span></div><div className="flex items-center gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span dir="ltr">{page} / {report.data?.pagination.totalPages || 1}</span><Button variant="outline" disabled={page >= (report.data?.pagination.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>التالي</Button></div></div>
  </main>;
}
