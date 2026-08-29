import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Edit, Eye, Phone, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatCard from "@/components/StatCard";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import SupplierFormDialog from "@/components/purchases/SupplierFormDialog";
import ImportSuppliersFromExcelButton from "@/components/purchases/ImportSuppliersFromExcelButton";
import { canDelete, canEdit } from "@/lib/permissions";
import { formatOMR } from "@/lib/money";
import { queryKeys } from "@/lib/queryKeys";
import { deactivateSupplier, fetchSupplierAccounts, fetchSupplierDirectorySummary, type CloudSupplier } from "@/lib/purchases/supplierAccountService";

export default function Suppliers() {
  const { i18n } = useTranslation();
  const english = i18n.resolvedLanguage?.startsWith("en") ?? false;
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CloudSupplier | null>(null);
  const [deleting, setDeleting] = useState<CloudSupplier | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();
  useEffect(() => { const timer = window.setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 350); return () => window.clearTimeout(timer); }, [search]);
  const directory = useQuery({
    queryKey: queryKeys.suppliers.list({ tenantId: profile?.tenant_id, search: appliedSearch, page, pageSize: 25 }),
    queryFn: () => fetchSupplierAccounts({ tenantId: profile!.tenant_id, search: appliedSearch, page, pageSize: 25 }),
    enabled: Boolean(profile?.tenant_id), staleTime: 60_000, gcTime: 600_000, refetchOnWindowFocus: false,
  });
  const summary = useQuery({
    queryKey: queryKeys.suppliers.summary(profile?.tenant_id), queryFn: () => fetchSupplierDirectorySummary(profile!.tenant_id),
    enabled: Boolean(profile?.tenant_id), staleTime: 120_000, gcTime: 600_000, refetchOnWindowFocus: false,
  });
  const deactivate = useMutation({
    mutationFn: (supplierId: string) => deactivateSupplier(profile!.tenant_id, supplierId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      toast.success(english ? "Supplier deactivated. Historical purchases were preserved." : "تم تعطيل المورد مع الحفاظ على كل مشترياته السابقة.");
      setDeleting(null);
    }, onError: (error) => toast.error((error as Error).message),
  });
  const Back = english ? ArrowLeft : ArrowRight;
  return <main className="space-y-6" dir={english ? "ltr" : "rtl"}>
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground"><Link to="/inventory" className="flex items-center gap-1 hover:text-foreground"><Back size={14}/>{english ? "Inventory" : "المخزون"}</Link><span>/</span><span>{english ? "Suppliers" : "الموردون"}</span></div><h1 className="text-2xl font-bold">{english ? "Supplier Accounts" : "حسابات الموردين"}</h1><p className="text-sm text-muted-foreground">{english ? "Canonical cloud purchases, payments and outstanding balances." : "المشتريات والدفعات والأرصدة الفعلية من قاعدة البيانات السحابية."}</p></div><div className="flex flex-wrap gap-2">{allowEdit && <ImportSuppliersFromExcelButton/>}{allowEdit && <Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={17}/>{english ? "New supplier" : "مورد جديد"}</Button>}</div></header>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard title={english ? "Suppliers" : "عدد الموردين"} value={summary.data?.supplierCount || 0} icon={Building2} variant="info"/><StatCard title={english ? "Purchases" : "إجمالي المشتريات"} value={formatOMR(summary.data?.purchases || 0)} icon={Building2} variant="gold"/><StatCard title={english ? "Payments" : "إجمالي المدفوع"} value={formatOMR(summary.data?.payments || 0)} icon={Building2} variant="success"/><StatCard title={english ? "Outstanding" : "إجمالي المستحق"} value={formatOMR(summary.data?.outstanding || 0)} icon={Building2} variant="warning"/></section>
    <Card><CardContent className="pt-4"><div className="relative max-w-xl"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"/><Input className="ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={english ? "Search by supplier, phone or category…" : "بحث باسم المورد أو الهاتف أو التصنيف…"}/></div></CardContent></Card>
    <Card><CardContent className="p-0">{directory.isLoading ? <div className="p-16 text-center">{english ? "Loading suppliers…" : "جاري تحميل الموردين…"}</div> : directory.isError ? <div className="p-12 text-center text-destructive">{(directory.error as Error).message}</div> : !directory.data?.rows.length ? <div className="p-16 text-center text-muted-foreground">{english ? "No suppliers found." : "لا يوجد موردون مطابقون."}</div> : <div className="overflow-x-auto"><Table className="min-w-[1050px]"><TableHeader><TableRow><TableHead>{english ? "Supplier" : "المورد"}</TableHead><TableHead>{english ? "Phone" : "الهاتف"}</TableHead><TableHead>{english ? "Tax No." : "الرقم الضريبي"}</TableHead><TableHead>{english ? "Category / Brands" : "التصنيف / الماركات"}</TableHead><TableHead>{english ? "Purchases" : "المشتريات"}</TableHead><TableHead>{english ? "Paid" : "المدفوع"}</TableHead><TableHead>{english ? "Outstanding" : "المستحق"}</TableHead><TableHead>{english ? "Actions" : "إجراءات"}</TableHead></TableRow></TableHeader><TableBody>{directory.data.rows.map((supplier) => <TableRow key={supplier.id}><TableCell><Link className="font-semibold text-primary hover:underline" to={`/inventory/suppliers/${supplier.id}`}>{supplier.name}</Link><p className="text-[10px] text-muted-foreground">{supplier.contact_person || supplier.email || "—"}</p></TableCell><TableCell dir="ltr">{supplier.phone || "—"}</TableCell><TableCell dir="ltr">{supplier.tax_number || "—"}</TableCell><TableCell><p className="text-xs">{supplier.category || "—"}</p><div className="mt-1 flex max-w-[260px] flex-wrap gap-1">{(supplier.vehicle_brands || []).slice(0, 5).map((brand) => <span key={brand} className="rounded-full border bg-primary/5 px-1.5 py-0.5 text-[10px]">{brand}</span>)}</div></TableCell><TableCell dir="ltr">{formatOMR(supplier.purchases)}</TableCell><TableCell dir="ltr" className="text-emerald-600">{formatOMR(supplier.payments)}</TableCell><TableCell dir="ltr" className={supplier.outstanding > 0 ? "font-bold text-destructive" : "text-emerald-600"}>{formatOMR(supplier.outstanding)}</TableCell><TableCell><div className="flex gap-1"><Button asChild size="icon" variant="ghost"><Link to={`/inventory/suppliers/${supplier.id}`} title={english ? "Open account" : "فتح الحساب"}><Eye size={15}/></Link></Button>{supplier.phone && <Button asChild size="icon" variant="ghost"><a href={`tel:${supplier.phone}`} title={english ? "Call" : "اتصال"}><Phone size={15}/></a></Button>}{allowEdit && <Button size="icon" variant="ghost" onClick={() => { setEditing(supplier); setShowForm(true); }}><Edit size={15}/></Button>}{allowDelete && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(supplier)}><Trash2 size={15}/></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{english ? "Total" : "الإجمالي"}: {directory.data?.total || 0}</span><div className="flex items-center gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{english ? "Previous" : "السابق"}</Button><span dir="ltr">{page} / {directory.data?.totalPages || 1}</span><Button variant="outline" disabled={page >= (directory.data?.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>{english ? "Next" : "التالي"}</Button></div></div>
    <SupplierFormDialog open={showForm} onOpenChange={setShowForm} editing={editing}/>
    <ConfirmDeleteDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} onConfirm={() => deleting && deactivate.mutate(deleting.id)} title={english ? `Deactivate ${deleting?.name || ""}` : `تعطيل ${deleting?.name || ""}`} description={english ? "The supplier will be hidden, while purchases, payments and history remain unchanged." : "سيختفي المورد من القائمة مع بقاء جميع المشتريات والدفعات والسجل دون حذف."}/>
  </main>;
}
