import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarRange, FileDown, FileSpreadsheet, Printer, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatOMR } from "@/lib/money";
import { fetchMonthlyWorkshopOverheads, monthlyWorkshopReportKeys, type MonthlyExpenseRow } from "@/lib/accounting/monthlyWorkshopReport";
import { exportReportRowsToPdf, exportReportRowsToXlsx, printReportRows, type ReportExportRequest } from "@/lib/reports-center/reportExportService";

type Column = { key: string; ar: string; en: string; type?: "money" | "date" | "text"; default?: boolean };
const COLUMNS: Column[] = [
  { key: "date", ar: "التاريخ", en: "Date", type: "date", default: true },
  { key: "voucher_number", ar: "رقم السند", en: "Voucher No.", default: true },
  { key: "department_ar", ar: "القسم", en: "Department", default: true },
  { key: "category_ar", ar: "التصنيف", en: "Category", default: true },
  { key: "subcategory_ar", ar: "التصنيف الفرعي", en: "Subcategory", default: true },
  { key: "supplier_name", ar: "المورد/المستفيد", en: "Supplier/Beneficiary", default: true },
  { key: "description", ar: "البيان", en: "Description", default: true },
  { key: "source_basis", ar: "أساس الاحتساب", en: "Calculation Basis", default: true },
  { key: "subtotal", ar: "قبل الضريبة", en: "Subtotal", type: "money", default: true },
  { key: "vat", ar: "الضريبة", en: "VAT", type: "money", default: true },
  { key: "total", ar: "الإجمالي", en: "Total", type: "money", default: true },
];

function monthBounds() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}

function value(row: MonthlyExpenseRow, column: Column, english: boolean) {
  const raw = row[column.key];
  if (column.type === "money") return formatOMR(Number(raw || 0));
  if (column.type === "date" && raw) return String(raw).slice(0, 10);
  if (column.key.endsWith("_ar") && english) return String(row[column.key.replace(/_ar$/, "_en")] || raw || "—");
  if (column.key === "source_basis") {
    const labels: Record<string, { ar: string; en: string }> = {
      hr_payslip: { ar: "مسير رواتب HR", en: "HR payslip" }, hr_accrual: { ar: "استحقاق HR تلقائي", en: "Automatic HR accrual" },
      monthly_settings: { ar: "إجمالي رواتب الإعدادات", en: "Payroll setting" }, fixed_cost_setting: { ar: "تكلفة ثابتة من الإعدادات", en: "Fixed-cost setting" },
    };
    return labels[String(raw || "")]?.[english ? "en" : "ar"] || (english ? "Actual expense voucher" : "سند مصروف فعلي");
  }
  return raw === null || raw === undefined || raw === "" ? "—" : String(raw);
}

export default function MonthlyExpensesReportPage() {
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.startsWith("en") ?? false;
  const { profile } = useAuth();
  const bounds = useMemo(monthBounds, []);
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [visible, setVisible] = useState(COLUMNS.filter((column) => column.default).map((column) => column.key));
  const report = useQuery({
    queryKey: monthlyWorkshopReportKeys.overheads(profile?.tenant_id, from, to),
    queryFn: ({ signal }) => fetchMonthlyWorkshopOverheads(from, to, signal),
    enabled: Boolean(profile?.tenant_id), staleTime: 120_000, gcTime: 900_000, refetchOnWindowFocus: false,
  });
  const columns = COLUMNS.filter((column) => visible.includes(column.key));
  const exportRequest = (): ReportExportRequest<MonthlyExpenseRow> => ({
    fileName: `Monthly_Expenses_${from}_${to}.xlsx`, sheetName: "Monthly Expenses",
    title: english ? "Monthly Expense Report" : "تقرير المصروفات الشهرية",
    filters: [{ label: english ? "From" : "من", value: from }, { label: english ? "To" : "إلى", value: to }, { label: english ? "Basis" : "الأساس", value: report.data?.basis || "—" }],
    columns: columns.map((column) => ({ key: column.key, label: english ? column.en : column.ar, type: column.type })),
    rows: report.data?.expenseRows || [], language: english ? "en" : "ar", generatedBy: profile?.full_name || profile?.user_id || "System",
  });
  async function exportRows(kind: "xlsx" | "pdf" | "print") {
    try {
      if (!columns.length) throw new Error(english ? "Select at least one column." : "اختر عمودًا واحدًا على الأقل.");
      if (!report.data?.expenseRows.length) throw new Error(english ? "No expenses to export." : "لا توجد مصروفات للتصدير.");
      const request = exportRequest();
      if (kind === "xlsx") exportReportRowsToXlsx(request);
      else if (kind === "pdf") await exportReportRowsToPdf(request);
      else await printReportRows(request);
    } catch (error) { toast.error((error as Error).message); }
  }
  const summary = report.data?.summary;
  return <main className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6" dir={english ? "ltr" : "rtl"}>
    <header className="flex flex-col gap-3 rounded-2xl border bg-card p-5 lg:flex-row lg:items-center lg:justify-between">
      <div><p className="text-xs text-muted-foreground">{english ? "Accounting / Reports" : "المحاسبة / التقارير"}</p><h1 className="text-2xl font-bold">{english ? "Monthly Expense Report" : "تقرير المصروفات الشهرية"}</h1><p className="text-sm text-muted-foreground">{english ? "Actual expense vouchers plus safe payroll and fixed-cost accruals without double counting." : "سندات المصروف الفعلية مع استحقاق الرواتب والتكاليف الثابتة تلقائيًا دون احتساب مزدوج."}</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/accounting/reports">{english ? "All reports" : "كل التقارير"}</Link></Button><Button variant="outline" onClick={() => report.refetch()}><RefreshCw size={15}/>{english ? "Refresh" : "تحديث"}</Button></div>
    </header>
    <Card><CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_1fr_auto_auto_auto_auto]"><label className="text-xs">{english ? "From" : "من"}<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label><label className="text-xs">{english ? "To" : "إلى"}<Input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label><DropdownMenu><DropdownMenuTrigger asChild><Button className="self-end" variant="outline"><SlidersHorizontal size={15}/>{english ? "Columns" : "الأعمدة"}</Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-[65vh] overflow-y-auto"><DropdownMenuLabel>{english ? "Display and export" : "العرض والتصدير"}</DropdownMenuLabel>{COLUMNS.map((column) => <DropdownMenuCheckboxItem key={column.key} checked={visible.includes(column.key)} onCheckedChange={(checked) => setVisible((current) => checked ? [...new Set([...current, column.key])] : current.filter((key) => key !== column.key))}>{english ? column.en : column.ar}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu><Button className="self-end" variant="outline" onClick={() => void exportRows("xlsx")}><FileSpreadsheet size={15}/>Excel</Button><Button className="self-end" variant="outline" onClick={() => void exportRows("pdf")}><FileDown size={15}/>PDF</Button><Button className="self-end" variant="outline" onClick={() => void exportRows("print")}><Printer size={15}/>{english ? "Print" : "طباعة"}</Button></CardContent></Card>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
      [english ? "Payroll" : "الرواتب", summary?.salaries], [english ? "Fixed costs" : "التكاليف الثابتة", summary?.fixed],
      [english ? "Operating" : "تشغيلية", summary?.operating], [english ? "Unlinked parts" : "قطع غير مرتبطة", summary?.unlinked_parts],
      [english ? "Other" : "أخرى", summary?.other], [english ? "Total excl. VAT" : "الإجمالي قبل VAT", summary?.subtotal],
    ].map(([label, amount]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-lg font-bold" dir="ltr">{formatOMR(Number(amount || 0))}</p></CardContent></Card>)}</section>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarRange size={18}/>{english ? "Expense details" : "تفاصيل المصروفات"}</CardTitle></CardHeader><CardContent className="p-0">{report.isLoading ? <div className="p-16 text-center">{english ? "Loading…" : "جاري التحميل…"}</div> : report.isError ? <div className="p-10 text-center text-destructive">{(report.error as Error).message}</div> : !report.data?.expenseRows.length ? <div className="p-16 text-center text-muted-foreground">{english ? "No expenses in this period." : "لا توجد مصروفات خلال الفترة."}</div> : <div className="overflow-x-auto"><Table className="min-w-max"><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key}>{english ? column.en : column.ar}</TableHead>)}</TableRow></TableHeader><TableBody>{report.data.expenseRows.map((row, index) => <TableRow key={String(row.id || index)}>{columns.map((column) => <TableCell key={column.key} dir={column.type === "money" ? "ltr" : undefined}>{value(row, column, english)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    <p className="text-xs text-muted-foreground">{english ? "Actual payroll/fixed vouchers override generated accruals for the same month. Generated accruals are report-only and never create expense records." : "إذا وُجد سند راتب أو تكلفة ثابتة فعلي في الشهر فإنه يتقدم على الاستحقاق التلقائي. الاستحقاقات التلقائية للعرض فقط ولا تنشئ سندات مصروف."}</p>
  </main>;
}
