// أوامر عمل شركات التأمين — مع تحديد متعدد وحذف متتالٍ
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wrench, Search, Eye, Car, Building2, FileText, ExternalLink, Filter, Trash2, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import { useInsuranceClaims, useDeleteClaim } from "@/hooks/useInsuranceClaims";
import { getWorkOrders, subscribeWorkOrders, deleteWorkOrder, type WorkOrder } from "@/lib/workOrdersStore";
import { toast } from "sonner";

interface InsuranceWorkOrderRow {
  id: string;
  source: "claim" | "local";
  workOrderId: string | null;
  workOrderNumber: string | null;
  claimId: string | null;
  claimNumber: string;
  insuranceCompany: string;
  customerName: string;
  plate: string;
  vehicle: string;
  status: string;
  totalCost: number;
  date: string;
}

const statusColor = (s: string) => {
  if (/تسليم|جاهز|مدفوع|مكتمل/i.test(s)) return "bg-success/15 text-success";
  if (/إصلاح|تنفيذ/i.test(s)) return "bg-warning/15 text-warning";
  if (/فحص|بانتظار|قيد/i.test(s)) return "bg-info/15 text-info";
  if (/ملغ|رفض/i.test(s)) return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
};

export default function InsuranceWorkOrders() {
  const navigate = useNavigate();
  const { data: claims, isLoading } = useInsuranceClaims();
  const deleteClaim = useDeleteClaim();
  const [localOrders, setLocalOrders] = useState<WorkOrder[]>(() => getWorkOrders());

  useEffect(() => subscribeWorkOrders(() => setLocalOrders(getWorkOrders())), []);

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteRow, setDeleteRow] = useState<InsuranceWorkOrderRow | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const rows = useMemo<InsuranceWorkOrderRow[]>(() => {
    const list: InsuranceWorkOrderRow[] = [];
    const seenWoIds = new Set<string>();

    (claims ?? [])
      .filter((c) => c.status !== "cancelled" && c.status !== "rejected")
      .forEach((c) => {
        const linkedLocal = localOrders.find(
          (lo) => lo.claimNumber && lo.claimNumber.trim() === (c.claim_number ?? "").trim(),
        );
        if (linkedLocal) seenWoIds.add(linkedLocal.id);

        list.push({
          id: `claim-${c.id}`,
          source: "claim",
          workOrderId: linkedLocal?.id ?? c.job_order_id ?? null,
          workOrderNumber: linkedLocal?.id ?? (c.job_order?.order_number ?? null),
          claimId: c.id,
          claimNumber: c.claim_number,
          insuranceCompany: c.insurance_company || "—",
          customerName: c.vehicle_owner_name || c.customer?.name || "—",
          plate: c.vehicle?.plate_number || linkedLocal?.plate || "—",
          vehicle: c.vehicle
            ? `${c.vehicle.brand ?? ""} ${c.vehicle.model ?? ""}`.trim()
            : linkedLocal
              ? `${linkedLocal.vehicleType ?? ""} ${linkedLocal.model ?? ""}`.trim()
              : "—",
          status: linkedLocal?.status || (c.status === "approved" ? "تحت الإصلاح" : c.status === "paid" ? "مدفوع" : "بانتظار الموافقة"),
          totalCost: linkedLocal?.totalCost ?? Number(c.approved_amount || c.estimated_amount || 0),
          date: linkedLocal?.entryDate || c.created_at?.slice(0, 10) || "",
        });
      });

    localOrders
      .filter((lo) => lo.insurance && lo.insurance !== "-" && !seenWoIds.has(lo.id))
      .forEach((lo) => {
        list.push({
          id: `local-${lo.id}`,
          source: "local",
          workOrderId: lo.id,
          workOrderNumber: lo.id,
          claimId: null,
          claimNumber: lo.claimNumber || "—",
          insuranceCompany: lo.insurance,
          customerName: lo.customer,
          plate: lo.plate,
          vehicle: `${lo.vehicleType ?? ""} ${lo.model ?? ""}`.trim(),
          status: lo.status,
          totalCost: lo.totalCost,
          date: lo.entryDate,
        });
      });

    return list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [claims, localOrders]);

  const companies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.insuranceCompany).filter((x) => x && x !== "—"))),
    [rows],
  );
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))), [rows]);

  const filtered = rows.filter((r) => {
    if (companyFilter !== "all" && r.insuranceCompany !== companyFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.claimNumber.toLowerCase().includes(q) ||
        (r.workOrderNumber ?? "").toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.plate.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const bulk = useBulkSelection(filtered);

  const totals = useMemo(() => ({
    count: filtered.length,
    amount: filtered.reduce((s, r) => s + (r.totalCost || 0), 0),
    open: filtered.filter((r) => !/تسليم|مدفوع|مكتمل/.test(r.status)).length,
  }), [filtered]);

  function deleteOneRow(r: InsuranceWorkOrderRow) {
    if (r.claimId) {
      deleteClaim.mutate(r.claimId); // cascade
    } else if (r.workOrderId) {
      deleteWorkOrder(r.workOrderId);
      toast.success("تم حذف أمر العمل");
    }
  }

  function handleBulkDelete() {
    bulk.selectedItems.forEach((r) => deleteOneRow(r));
    bulk.clear();
    setBulkConfirmOpen(false);
  }

  function handleBulkExport() {
    exportRowsAsCsv(
      `insurance-work-orders-${new Date().toISOString().slice(0, 10)}`,
      ["أمر العمل", "المطالبة", "شركة التأمين", "العميل", "اللوحة", "السيارة", "الحالة", "التكلفة", "التاريخ"],
      bulk.selectedItems.map((r) => [
        r.workOrderNumber ?? "", r.claimNumber, r.insuranceCompany,
        r.customerName, r.plate, r.vehicle, r.status, r.totalCost, r.date,
      ]),
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="text-primary" /> أوامر عمل شركات التأمين
          </h1>
          <p className="text-sm text-muted-foreground">
            كل أوامر العمل المربوطة بمطالبات تأمين — حذف المطالبة يحذف الفواتير والتقديرات والدفعات وأمر العمل تلقائياً.
          </p>
        </div>
        <Button onClick={() => navigate("/insurance/new")} className="gap-2">
          <FileText size={16} /> مطالبة جديدة
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">عدد أوامر العمل</div>
          <div className="text-2xl font-bold mt-1">{totals.count}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">قيد التنفيذ</div>
          <div className="text-2xl font-bold mt-1 text-warning">{totals.open}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي التكاليف</div>
          <div className="text-2xl font-bold mt-1 text-primary">{totals.amount.toFixed(3)} ر.ع</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم المطالبة، أمر العمل، اللوحة، أو العميل..." className="pr-9" />
          </div>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger><Filter size={14} className="ml-2" /><SelectValue placeholder="شركة التأمين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الشركات</SelectItem>
              {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><Filter size={14} className="ml-2" /><SelectValue placeholder="حالة أمر العمل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Mobile */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">جاري التحميل...</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">لا توجد أوامر عمل مرتبطة بمطالبات تأمين.</Card>
        ) : filtered.map((r) => (
          <Card key={r.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <Checkbox checked={bulk.isSelected(r.id)} onCheckedChange={() => bulk.toggle(r.id)} className="mt-1" />
                <div className="min-w-0">
                  <div className="font-mono text-xs text-primary truncate">
                    {r.workOrderNumber || <span className="text-muted-foreground">— لم يُحوَّل بعد</span>}
                  </div>
                  <div className="text-sm font-semibold truncate">{r.insuranceCompany}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    مطالبة <span className="font-mono">{r.claimNumber}</span> • {r.customerName}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    <span className="font-mono">{r.plate}</span> — {r.vehicle}
                  </div>
                </div>
              </div>
              <Badge className={statusColor(r.status)}>{r.status}</Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">{(r.totalCost ?? 0).toFixed(3)} ر.ع</span>
              <div className="flex gap-1">
                {r.workOrderId && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate(`/work-orders/${r.workOrderId}`)}>
                    <Wrench size={12} /> أمر العمل
                  </Button>
                )}
                {r.claimId && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-info/40 text-info hover:bg-info/10" onClick={() => navigate(`/insurance/${r.claimId}`)}>
                    <Eye size={12} /> المطالبة
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDeleteRow(r)}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Desktop */}
      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="p-3 w-10"><Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} /></th>
                <th className="text-right p-3 font-semibold">أمر العمل</th>
                <th className="text-right p-3 font-semibold">المطالبة</th>
                <th className="text-right p-3 font-semibold">شركة التأمين</th>
                <th className="text-right p-3 font-semibold">السيارة</th>
                <th className="text-right p-3 font-semibold">العميل</th>
                <th className="text-right p-3 font-semibold">الحالة</th>
                <th className="text-right p-3 font-semibold">التكلفة</th>
                <th className="text-right p-3 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (<tr><td colSpan={9} className="p-6 text-center text-muted-foreground">جاري التحميل...</td></tr>)}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">لا توجد أوامر عمل مرتبطة بمطالبات تأمين.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3"><Checkbox checked={bulk.isSelected(r.id)} onCheckedChange={() => bulk.toggle(r.id)} /></td>
                  <td className="p-3 font-mono text-xs">
                    {r.workOrderNumber ? (
                      <button onClick={() => r.workOrderId && navigate(`/work-orders/${r.workOrderId}`)}
                        className="text-primary hover:underline inline-flex items-center gap-1" disabled={!r.workOrderId}>
                        {r.workOrderNumber} <ExternalLink size={11} />
                      </button>
                    ) : <span className="text-muted-foreground">— لم يُحوَّل بعد</span>}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {r.claimId ? (
                      <button onClick={() => navigate(`/insurance/${r.claimId}`)} className="text-primary hover:underline inline-flex items-center gap-1">
                        {r.claimNumber} <ExternalLink size={11} />
                      </button>
                    ) : <span className="text-muted-foreground">{r.claimNumber}</span>}
                  </td>
                  <td className="p-3"><span className="inline-flex items-center gap-1.5"><Building2 size={12} className="text-muted-foreground" /> {r.insuranceCompany}</span></td>
                  <td className="p-3">
                    <button onClick={() => navigate(`/vehicles?plate=${encodeURIComponent(r.plate)}`)}
                      className="inline-flex items-center gap-1.5 hover:text-primary" title="عرض في أرشيف السيارات">
                      <Car size={12} className="text-muted-foreground" />
                      <span className="font-medium">{r.plate}</span>
                      <span className="text-muted-foreground text-xs">— {r.vehicle}</span>
                    </button>
                  </td>
                  <td className="p-3 text-xs">{r.customerName}</td>
                  <td className="p-3"><Badge className={statusColor(r.status)}>{r.status}</Badge></td>
                  <td className="p-3 font-semibold">{(r.totalCost ?? 0).toFixed(3)} ر.ع</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {r.workOrderId && (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/work-orders/${r.workOrderId}`)} className="gap-1 h-8">
                          <Wrench size={13} /> أمر العمل
                        </Button>
                      )}
                      {r.claimId && (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/insurance/${r.claimId}`)} className="gap-1 h-8 border-info/40 text-info hover:bg-info/10">
                          <Eye size={13} /> المطالبة
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setDeleteRow(r)}
                        className="gap-1 h-8 border-destructive/40 text-destructive hover:bg-destructive/10">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="عنصر">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <Download size={14} /> تصدير CSV
        </Button>
        <Button size="sm" variant="destructive" className="gap-1 h-8" onClick={() => setBulkConfirmOpen(true)}>
          <Trash2 size={14} /> حذف المحدد
        </Button>
      </BulkActionBar>

      {/* Single delete confirm */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {deleteRow?.claimId ? "المطالبة" : "أمر العمل"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow?.claimId
                ? "سيتم حذف المطالبة وكل ما يرتبط بها: الفواتير، التقديرات، الدفعات، قيود اليومية، وأمر العمل. لا يمكن التراجع."
                : "سيتم حذف أمر العمل نهائياً. لا يمكن التراجع."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteRow) deleteOneRow(deleteRow); setDeleteRow(null); }}
            >حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {bulk.count} عنصر</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف كل المطالبات المحددة + الفواتير + التقديرات + الدفعات + أوامر العمل المرتبطة. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >حذف الكل</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
