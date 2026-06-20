import { useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { Building2, Plus, Search, Eye, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useInsuranceCompanies,
  useDeleteInsuranceCompany,
  type InsuranceCompany,
} from "@/hooks/useInsuranceCompanies";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import InsuranceCompanyFormDialog from "@/components/insurance/InsuranceCompanyFormDialog";

export default function InsuranceCompanies() {
  const navigate = useNavigate();
  const { data: companies, isLoading } = useInsuranceCompanies();
  const { data: claims } = useInsuranceClaims();
  const { data: payments } = useClaimPayments();
  const del = useDeleteInsuranceCompany();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<InsuranceCompany | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = companies?.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.name.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s);
  });

  // Per-company aggregates
  const aggForCompany = (c: InsuranceCompany) => {
    const cClaims = (claims ?? []).filter(
      (cl) => (cl as any).insurance_company_id === c.id || cl.insurance_company === c.name,
    );
    const approved = cClaims.reduce(
      (sum, cl) => sum + (Number(cl.approved_amount) || Number(cl.estimated_amount) || 0),
      0,
    );
    const claimIds = new Set(cClaims.map((cl) => cl.id));
    const cPayments = (payments ?? []).filter(
      (p) => p.insurance_company_id === c.id || claimIds.has(p.claim_id),
    );
    const paid = cPayments
      .filter((p) => p.status !== "bounced")
      .reduce((s, p) => s + Number(p.amount), 0);
    const remaining = approved - paid;
    return { count: cClaims.length, approved, paid, remaining };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">شركات التأمين</h1>
          <p className="text-sm text-muted-foreground">إدارة جهات الدفع وكشوف الحساب</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => smartBack(navigate, "/insurance")}>← العودة للمطالبات</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus size={18} /> شركة جديدة
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : !filtered?.length ? (
          <div className="p-8 text-center text-muted-foreground">
            <Building2 size={32} className="mx-auto mb-2 opacity-50" />
            لا توجد شركات بعد. أضف أول شركة تأمين.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الشركة</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">الاتصال</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المطالبات</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المعتمد</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المدفوع</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المتبقي</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const a = aggForCompany(c);
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer transition" onClick={() => navigate(`/insurance/companies/${c.id}`)}>

                      <td className="py-3 px-4 font-semibold">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full bg-secondary border border-border overflow-hidden flex items-center justify-center shrink-0">
                            {(c as any).logo_url ? (
                              <img src={(c as any).logo_url} alt={c.name} className="w-full h-full object-cover" />
                            ) : (
                              <Building2 size={16} className="text-muted-foreground" />
                            )}
                          </div>
                          <span className="truncate">{c.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">
                        {c.contact_person && <div>{c.contact_person}</div>}
                        {c.phone && <div className="text-xs">{c.phone}</div>}
                      </td>
                      <td className="py-3 px-4">{a.count}</td>
                      <td className="py-3 px-4 font-medium">{a.approved.toLocaleString()} ر.ع</td>
                      <td className="py-3 px-4 text-success">{a.paid.toLocaleString()} ر.ع</td>
                      <td className={`py-3 px-4 font-bold ${a.remaining > 0 ? "text-warning" : "text-success"}`}>
                        {a.remaining.toLocaleString()} ر.ع
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="كشف الحساب"
                            onClick={() => navigate(`/insurance/companies/${c.id}`)}>
                            <Eye size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="تعديل"
                            onClick={() => setEditing(c)}>
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="حذف"
                            onClick={() => setDeleteId(c.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InsuranceCompanyFormDialog open={showCreate} onOpenChange={setShowCreate} />
      <InsuranceCompanyFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} company={editing} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف شركة التأمين</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد؟ لن يتم حذف المطالبات المرتبطة لكنها ستفقد الربط بهذه الشركة.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) del.mutate(deleteId); setDeleteId(null); }}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
