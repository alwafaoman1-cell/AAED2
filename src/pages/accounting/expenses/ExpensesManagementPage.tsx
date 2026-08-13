import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, Loader2, Plus, Printer, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryKeys } from "@/lib/queryKeys";
import { formatOMR } from "@/lib/money";
import {
  listAllExpenses,
  listCostCenters,
  listExpenseCategories,
  listExpenses,
  softDeleteExpense,
  type ExpenseManagementFilters,
} from "@/lib/expenses/expenseClassificationService";
import { exportReportRowsToPdf, exportReportRowsToXlsx, printReportRows, type ReportExportRequest } from "@/lib/reports-center/reportExportService";

const columns = [
  { key: "voucher_number", label: "رقم السند / Voucher" }, { key: "date", label: "التاريخ / Date", type: "date" as const },
  { key: "expense_scope", label: "النطاق / Scope" }, { key: "work_order_channel", label: "القناة / Channel" },
  { key: "department_ar", label: "القسم AR" }, { key: "department_en", label: "Department EN" },
  { key: "category_ar", label: "التصنيف AR" }, { key: "category_en", label: "Category EN" },
  { key: "subcategory_ar", label: "الفرعي AR" }, { key: "subcategory_en", label: "Subcategory EN" },
  { key: "order_number", label: "أمر العمل / Work Order" }, { key: "plate", label: "المركبة / Vehicle" },
  { key: "claim_number", label: "المطالبة / Claim" }, { key: "supplier_name", label: "المورد / Supplier" },
  { key: "description", label: "البيان / Description" }, { key: "subtotal", label: "قبل الضريبة / Subtotal", type: "money" as const },
  { key: "vat_amount", label: "VAT", type: "money" as const }, { key: "total", label: "الإجمالي / Total", type: "money" as const },
  { key: "payment_method", label: "طريقة الدفع / Payment" }, { key: "cost_center_en", label: "Cost Center" },
];

const filterNames: Array<keyof ExpenseManagementFilters> = ["search", "from", "to", "scope", "channel", "work_order", "claim", "vehicle", "customer", "insurance_company", "department_id", "category_id", "subcategory_id", "supplier", "payment_method", "cost_center_id", "amount_from", "amount_to", "vat", "classification_status"];

export default function ExpensesManagementPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { profile, user } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(params.get("search") || "");
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | "print" | null>(null);
  const filters = useMemo<ExpenseManagementFilters>(() => Object.fromEntries(filterNames.map((key) => [key, params.get(key) || ""])) as ExpenseManagementFilters, [params]);
  const query = useQuery({ queryKey: queryKeys.expenseManagement.list({ tenantId, page, filters }), enabled: !!tenantId, queryFn: () => listExpenses(page, 50, filters), staleTime: 30_000 });
  const categories = useQuery({ queryKey: queryKeys.expenseManagement.categories({ tenantId, active: true }), enabled: !!tenantId, queryFn: () => listExpenseCategories(tenantId, false) });
  const centers = useQuery({ queryKey: queryKeys.expenseManagement.costCenters, enabled: !!tenantId, queryFn: () => listCostCenters(tenantId) });
  const qc = useQueryClient();
  const remove = useMutation({ mutationFn: (id: string) => softDeleteExpense(tenantId, id), onSuccess: async () => { toast.success("تم حذف المصروف"); await qc.invalidateQueries({ queryKey: queryKeys.expenseManagement.all }); }, onError: (e: Error) => toast.error(e.message) });
  const rows = query.data?.rows || [];
  const agg = query.data?.aggregates || {};
  const roots = (categories.data || []).filter((row) => row.level === 1);
  const categoryRows = (categories.data || []).filter((row) => !filters.department_id || row.parent_id === filters.department_id);
  const subcategoryRows = (categories.data || []).filter((row) => !filters.category_id || row.parent_id === filters.category_id);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "department_id") { next.delete("category_id"); next.delete("subcategory_id"); }
    if (key === "category_id") next.delete("subcategory_id");
    setPage(1); setParams(next);
  };
  const clearFilters = () => { setSearch(""); setPage(1); setParams(new URLSearchParams()); };
  const buildExport = (allRows: any[]): ReportExportRequest<any> => ({
    fileName: `expenses-${new Date().toISOString().slice(0, 10)}`,
    sheetName: "Expenses",
    title: isAr ? "إدارة المصروفات" : "Expense Management",
    filters: filterNames.filter((key) => filters[key]).map((key) => ({ label: key, value: String(filters[key]) })),
    columns,
    rows: allRows,
    language: isAr ? "ar" : "en",
    generatedBy: user?.email || "Authenticated user",
  });
  const runExport = async (kind: "xlsx" | "pdf" | "print") => {
    setExporting(kind);
    try {
      const allRows = await listAllExpenses(filters);
      if (!allRows.length) throw new Error(isAr ? "لا توجد سجلات للتصدير" : "No rows to export");
      const request = buildExport(allRows);
      if (kind === "xlsx") exportReportRowsToXlsx(request);
      else if (kind === "pdf") await exportReportRowsToPdf(request);
      else await printReportRows(request);
      toast.success(isAr ? `تم تصدير ${allRows.length} سجلًا` : `Exported ${allRows.length} rows`);
    } catch (error) { toast.error((error as Error).message); } finally { setExporting(null); }
  };
  const value = (key: keyof ExpenseManagementFilters) => filters[key] || "";

  return <div className="space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">إدارة المصروفات</h1><p className="text-sm text-muted-foreground">Expense Management — تصنيف تشغيلي ومحاسبي موحد</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/accounting/expenses/categories"><Settings2 className="h-4 w-4"/> التصنيفات</Link></Button><Button asChild><Link to="/accounting/expenses/new"><Plus className="h-4 w-4"/> إضافة مصروف</Link></Button></div></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{[["الإجمالي", agg.total], ["أوامر كاش", agg.cashWorkOrders], ["أوامر تأمين", agg.insuranceWorkOrders], ["تشغيلية", agg.operating], ["VAT", agg.vat], ["تكاليف مباشرة", agg.directCosts], ["تكاليف تشغيلية", agg.operatingCosts]].map(([label, amount]) => <Card key={String(label)}><CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="p-3 pt-0 font-bold">{formatOMR(amount || 0)}</CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>الفلاتر المتقدمة / Advanced Filters</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <div className="flex gap-2 md:col-span-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالسند، أمر العمل، اللوحة أو المورد" onKeyDown={(e) => { if (e.key === "Enter") update("search", search); }}/><Button variant="outline" onClick={() => update("search", search)}><Search className="h-4 w-4"/></Button></div>
      <Input type="date" value={value("from")} onChange={(e) => update("from", e.target.value)} aria-label="Date From"/><Input type="date" value={value("to")} onChange={(e) => update("to", e.target.value)} aria-label="Date To"/>
      <Select value={value("scope") || "all"} onValueChange={(v) => update("scope", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="النطاق"/></SelectTrigger><SelectContent><SelectItem value="all">كل النطاقات</SelectItem><SelectItem value="work_order">أوامر العمل</SelectItem><SelectItem value="operating">تشغيلية</SelectItem></SelectContent></Select>
      <Select value={value("channel") || "all"} onValueChange={(v) => update("channel", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="القناة"/></SelectTrigger><SelectContent><SelectItem value="all">كاش وتأمين</SelectItem><SelectItem value="cash">كاش</SelectItem><SelectItem value="insurance">تأمين</SelectItem></SelectContent></Select>
      <Input value={value("work_order")} onChange={(e) => update("work_order", e.target.value)} placeholder={isAr ? "رقم أمر العمل" : "Work order number"}/><Input value={value("claim")} onChange={(e) => update("claim", e.target.value)} placeholder={isAr ? "رقم المطالبة" : "Claim number"}/><Input value={value("vehicle")} onChange={(e) => update("vehicle", e.target.value)} placeholder={isAr ? "رقم أو حروف اللوحة" : "Plate number or letters"}/><Input value={value("customer")} onChange={(e) => update("customer", e.target.value)} placeholder={isAr ? "اسم العميل" : "Customer name"}/>
      <Input value={value("insurance_company")} onChange={(e) => update("insurance_company", e.target.value)} placeholder="شركة التأمين"/>
      <Select value={value("department_id") || "all"} onValueChange={(v) => update("department_id", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="القسم"/></SelectTrigger><SelectContent><SelectItem value="all">كل الأقسام</SelectItem>{roots.map((row) => <SelectItem key={row.id} value={row.id}>{isAr ? row.name_ar : row.name_en}</SelectItem>)}</SelectContent></Select>
      <Select value={value("category_id") || "all"} onValueChange={(v) => update("category_id", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="التصنيف"/></SelectTrigger><SelectContent><SelectItem value="all">كل التصنيفات</SelectItem>{categoryRows.map((row) => <SelectItem key={row.id} value={row.id}>{isAr ? row.name_ar : row.name_en}</SelectItem>)}</SelectContent></Select>
      <Select value={value("subcategory_id") || "all"} onValueChange={(v) => update("subcategory_id", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="التصنيف الفرعي"/></SelectTrigger><SelectContent><SelectItem value="all">كل التصنيفات الفرعية</SelectItem>{subcategoryRows.map((row) => <SelectItem key={row.id} value={row.id}>{isAr ? row.name_ar : row.name_en}</SelectItem>)}</SelectContent></Select>
      <Input value={value("supplier")} onChange={(e) => update("supplier", e.target.value)} placeholder={isAr ? "اسم المورد" : "Supplier name"}/>
      <Select value={value("payment_method") || "all"} onValueChange={(v) => update("payment_method", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="طريقة الدفع"/></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank">Bank</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent></Select>
      <Select value={value("cost_center_id") || "all"} onValueChange={(v) => update("cost_center_id", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="مركز التكلفة"/></SelectTrigger><SelectContent><SelectItem value="all">كل مراكز التكلفة</SelectItem>{(centers.data || []).map((row: any) => <SelectItem key={row.id} value={row.id}>{row.code} — {isAr ? row.name_ar : row.name_en}</SelectItem>)}</SelectContent></Select>
      <Input inputMode="decimal" value={value("amount_from")} onChange={(e) => update("amount_from", e.target.value)} placeholder="Amount From"/><Input inputMode="decimal" value={value("amount_to")} onChange={(e) => update("amount_to", e.target.value)} placeholder="Amount To"/>
      <Select value={value("vat") || "all"} onValueChange={(v) => update("vat", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="VAT"/></SelectTrigger><SelectContent><SelectItem value="all">VAT + Non-VAT</SelectItem><SelectItem value="vat">VAT</SelectItem><SelectItem value="non_vat">Non-VAT</SelectItem></SelectContent></Select>
      <Select value={value("classification_status") || "all"} onValueChange={(v) => update("classification_status", v === "all" ? "" : v)}><SelectTrigger><SelectValue placeholder="حالة التصنيف"/></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem><SelectItem value="classified">Classified</SelectItem><SelectItem value="needs_classification">Needs Classification</SelectItem></SelectContent></Select>
      <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-4 xl:col-span-6"><Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="h-4 w-4"/> تحديث</Button><Button variant="outline" onClick={clearFilters}>مسح الفلاتر</Button><Button variant="outline" disabled={!!exporting} onClick={() => runExport("xlsx")}>{exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin"/> : <FileSpreadsheet className="h-4 w-4"/>} Excel</Button><Button variant="outline" disabled={!!exporting} onClick={() => runExport("pdf")}>{exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin"/> : <FileDown className="h-4 w-4"/>} PDF</Button><Button variant="outline" disabled={!!exporting} onClick={() => runExport("print")}>{exporting === "print" ? <Loader2 className="h-4 w-4 animate-spin"/> : <Printer className="h-4 w-4"/>} طباعة</Button></div>
    </CardContent></Card>
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow>{columns.slice(0, 18).map((column) => <TableHead key={column.key} className="whitespace-nowrap">{column.label}</TableHead>)}<TableHead>الإجراءات</TableHead></TableRow></TableHeader><TableBody>
      {query.isLoading ? <TableRow><TableCell colSpan={19} className="text-center">جاري التحميل...</TableCell></TableRow> : query.isError ? <TableRow><TableCell colSpan={19} className="text-center text-destructive">{(query.error as Error).message}</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={19} className="text-center">لا توجد مصروفات مطابقة</TableCell></TableRow> : rows.map((row: any) => <TableRow key={row.id}>{columns.slice(0, 18).map((column) => <TableCell key={column.key} className="whitespace-nowrap">{column.key === "expense_scope" || column.key === "work_order_channel" ? <Badge variant="outline">{String(row[column.key] ?? "—")}</Badge> : column.type === "money" ? formatOMR(row[column.key] || 0) : String(row[column.key] ?? "—")}</TableCell>)}<TableCell><div className="flex gap-1"><Button size="sm" variant="outline" asChild><Link to={`/accounting/expenses/${row.id}/edit`}>تعديل</Link></Button><Button size="icon" variant="ghost" disabled={remove.isPending} onClick={() => { if (confirm("حذف المصروف؟")) remove.mutate(row.id); }}><Trash2 className="h-4 w-4 text-destructive"/></Button></div></TableCell></TableRow>)}
    </TableBody></Table></div><div className="flex items-center justify-between p-3"><span className="text-sm">{query.data?.pagination?.totalRows || 0} سجل</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>السابق</Button><span className="px-3 py-2">{page} / {query.data?.pagination?.totalPages || 1}</span><Button variant="outline" disabled={page >= (query.data?.pagination?.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>التالي</Button></div></div></CardContent></Card>
  </div>;
}
