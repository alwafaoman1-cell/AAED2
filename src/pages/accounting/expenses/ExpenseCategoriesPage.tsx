import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { List, Network, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
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
import {
  applyDefaultCategoryTemplate,
  compareExpenseCategoryRows,
  deleteExpenseCategory,
  disableExpenseCategory,
  listCategoryAudit,
  listExpenseCategories,
  type ExpenseCategoryRow,
} from "@/lib/expenses/expenseClassificationService";

type ViewMode = "tree" | "flat";

function treeOrder(rows: ExpenseCategoryRow[]) {
  const children = new Map<string | null, ExpenseCategoryRow[]>();
  rows.forEach((row) => children.set(row.parent_id, [...(children.get(row.parent_id) || []), row]));
  children.forEach((items) => items.sort((a, b) => compareExpenseCategoryRows(a, b)));
  const result: ExpenseCategoryRow[] = [];
  const visited = new Set<string>();
  const visit = (parent: string | null) => (children.get(parent) || []).forEach((row) => {
    if (visited.has(row.id)) return;
    visited.add(row.id); result.push(row); visit(row.id);
  });
  visit(null);
  // A search can match a child while excluding its parent. Keep that matching
  // row visible instead of silently dropping it from Tree view.
  rows.filter((row) => !visited.has(row.id))
    .sort((a, b) => compareExpenseCategoryRows(a, b))
    .forEach((row) => { visited.add(row.id); result.push(row); });
  return result;
}

export default function ExpenseCategoriesPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const { profile, user } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("tree");
  const [scope, setScope] = useState("all");
  const [department, setDepartment] = useState("all");
  const [active, setActive] = useState("all");

  const query = useQuery({
    queryKey: queryKeys.expenseManagement.categories({ tenantId, includeInactive: true }),
    enabled: !!tenantId,
    queryFn: () => listExpenseCategories(tenantId, true),
  });
  const audit = useQuery({
    queryKey: queryKeys.expenseManagement.categoryAudit(tenantId),
    enabled: !!tenantId,
    queryFn: () => listCategoryAudit(tenantId),
  });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: queryKeys.expenseManagement.all }); };
  const template = useMutation({ mutationFn: applyDefaultCategoryTemplate, onSuccess: async (n) => { toast.success(`تم تجهيز ${n} تصنيفًا`); await refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const disable = useMutation({ mutationFn: (id: string) => disableExpenseCategory(tenantId, id, user?.id || ""), onSuccess: async () => { toast.success("تم تعطيل التصنيف"); await refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => deleteExpenseCategory(tenantId, id), onSuccess: async () => { toast.success("تم حذف التصنيف غير المستخدم"); await refresh(); }, onError: (e: Error) => toast.error(e.message) });

  const departments = useMemo(() => (query.data || []).filter((row) => row.level === 1), [query.data]);
  const rows = useMemo(() => {
    const all = query.data || [];
    const q = search.trim().toLowerCase();
    const departmentIds = department === "all"
      ? null
      : new Set([department, ...all.filter((row) => row.parent_id === department).map((row) => row.id)]);
    const filtered = all.filter((row) => {
      if (q && ![row.code, row.name_ar, row.name_en].some((value) => String(value || "").toLowerCase().includes(q))) return false;
      if (scope !== "all" && row.expense_scope !== scope && row.expense_scope !== "both") return false;
      if (active !== "all" && row.is_active !== (active === "active")) return false;
      if (departmentIds && row.id !== department && !departmentIds.has(row.parent_id || "") && !departmentIds.has(row.id)) return false;
      return true;
    });
    return view === "tree" ? treeOrder(filtered) : [...filtered].sort((a, b) => compareExpenseCategoryRows(a, b, "code"));
  }, [active, department, query.data, scope, search, view]);

  return <div className="space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">تصنيفات المصروفات</h1><p className="text-sm text-muted-foreground">Expense Categories — شجرة ثنائية اللغة مرتبطة بمفاتيح الحسابات</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { if (confirm("تطبيق القالب الافتراضي على هذه الورشة؟ لن يعاد تصنيف المصروفات القديمة.")) template.mutate(); }} disabled={template.isPending}><ShieldCheck className="h-4 w-4"/> تطبيق القالب الافتراضي</Button>
        <Button asChild><Link to="/accounting/expenses/categories/new"><Plus className="h-4 w-4"/> تصنيف جديد</Link></Button>
      </div>
    </div>
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-6">
      <div className="flex gap-2 md:col-span-2"><Search className="mt-2 h-4 w-4"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الكود"/></div>
      <Select value={scope} onValueChange={setScope}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">كل النطاقات</SelectItem><SelectItem value="work_order">Work Order</SelectItem><SelectItem value="operating">Operating</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent></Select>
      <Select value={department} onValueChange={setDepartment}><SelectTrigger><SelectValue placeholder="القسم"/></SelectTrigger><SelectContent><SelectItem value="all">كل الأقسام</SelectItem>{departments.map((row) => <SelectItem key={row.id} value={row.id}>{isAr ? row.name_ar : row.name_en}</SelectItem>)}</SelectContent></Select>
      <Select value={active} onValueChange={setActive}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">نشط ومعطل</SelectItem><SelectItem value="active">نشط</SelectItem><SelectItem value="inactive">معطل</SelectItem></SelectContent></Select>
      <div className="flex gap-2"><Button variant={view === "tree" ? "default" : "outline"} onClick={() => setView("tree")}><Network className="h-4 w-4"/> Tree</Button><Button variant={view === "flat" ? "default" : "outline"} onClick={() => setView("flat")}><List className="h-4 w-4"/> Flat</Button><Button size="icon" variant="outline" onClick={() => query.refetch()}><RefreshCw className="h-4 w-4"/></Button></div>
    </CardContent></Card>
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>العربي</TableHead><TableHead>English</TableHead><TableHead>المستوى</TableHead><TableHead>النطاق</TableHead><TableHead>Mapping Key</TableHead><TableHead>الحالة</TableHead><TableHead>الإجراءات</TableHead></TableRow></TableHeader><TableBody>
      {query.isLoading ? <TableRow><TableCell colSpan={8} className="text-center">جاري التحميل...</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id}><TableCell className="font-mono">{row.code}</TableCell><TableCell style={view === "tree" ? { paddingInlineStart: `${Math.max(0, row.level - 1) * 24 + 16}px` } : undefined}>{row.name_ar}</TableCell><TableCell>{row.name_en}</TableCell><TableCell>{row.category_type}</TableCell><TableCell><Badge variant="outline">{row.expense_scope}</Badge></TableCell><TableCell className="font-mono text-xs">{row.accounting_mapping_key || "—"}</TableCell><TableCell>{row.is_active ? "نشط" : "معطل"}</TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="outline" asChild><Link to={`/accounting/expenses/categories/${row.id}`}>تعديل</Link></Button>{row.is_active && <Button size="sm" variant="outline" onClick={() => disable.mutate(row.id)}>تعطيل</Button>}<Button size="icon" variant="ghost" onClick={() => { if (confirm("يُحذف فقط إن لم يكن مستخدمًا. متابعة؟")) remove.mutate(row.id); }}><Trash2 className="h-4 w-4 text-destructive"/></Button></div></TableCell></TableRow>)}
      {!query.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center">لا توجد تصنيفات. طبّق القالب يدويًا أو أنشئ تصنيفًا.</TableCell></TableRow>}
    </TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>سجل تدقيق التصنيفات / Category Audit Trail</CardTitle></CardHeader><CardContent className="p-0"><div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الإجراء</TableHead><TableHead>التصنيف</TableHead><TableHead>المستخدم</TableHead></TableRow></TableHeader><TableBody>{audit.isLoading ? <TableRow><TableCell colSpan={4} className="text-center">جاري التحميل...</TableCell></TableRow> : (audit.data || []).map((row: any) => <TableRow key={row.id}><TableCell>{new Date(row.created_at).toLocaleString("en-GB")}</TableCell><TableCell>{row.action}</TableCell><TableCell className="font-mono text-xs">{row.category_id || "—"}</TableCell><TableCell className="font-mono text-xs">{row.user_id || "—"}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
  </div>;
}
