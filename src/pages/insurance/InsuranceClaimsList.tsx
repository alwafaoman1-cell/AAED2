import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, Download, Eye, Trash2, CheckCircle, Clock, XCircle, DollarSign, Ban, FileText, Zap, AlertTriangle, Columns, Settings2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import { useInsuranceClaims, useDeleteClaim } from "@/hooks/useInsuranceClaims";
import { toEnglishDigits, formatPlateLatin } from "@/lib/numberUtils";
import ClaimStatusDialog from "@/components/insurance/ClaimStatusDialog";
import WorkshopOperationsReportDialog from "@/components/insurance/WorkshopOperationsReportDialog";
import BulkClaimsActionsMenu from "@/components/insurance/BulkClaimsActionsMenu";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { computeDays, durationLevel, durationBadgeClass } from "@/lib/claimDurationStatus";
import {
  claimVehicleLocationClass,
  claimVehicleLocationLabels,
  getClaimVehicleLocation,
  isActiveClaim,
} from "@/lib/claimVehicleLocation";
import { TablePaginationControls } from "@/components/ui/table-pagination-controls";
import VehicleAvatar from "@/components/vehicles/VehicleAvatar";
import { useInsuranceEmployees } from "@/hooks/useInsuranceEmployees";

const statusColors: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  paid: "bg-info/15 text-info border-info/30",
  cancelled: "bg-muted text-muted-foreground border-muted",
};
const statusLabels: Record<string, string> = {
  pending: "بانتظار الاعتماد", approved: "معتمدة", rejected: "مرفوضة", paid: "مدفوعة", cancelled: "ملغاة",
};
const statusIcons: Record<string, typeof Clock> = {
  pending: Clock, approved: CheckCircle, rejected: XCircle, paid: DollarSign, cancelled: Ban,
};

const QUICK_TEMPLATES = [
  { label: "حادث بسيط", description: "خدوش وأضرار سطحية", icon: "🚗" },
  { label: "صدمة كاملة", description: "أضرار جسيمة بعدة قطع", icon: "💥" },
  { label: "سرقة", description: "بلاغ سرقة مركبة", icon: "🔓" },
  { label: "كسر زجاج", description: "زجاج أمامي/جانبي", icon: "🪟" },
];

export default function InsuranceClaimsList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: claims = [], isLoading } = useInsuranceClaims();
  const { data: insuranceEmployees = [] } = useInsuranceEmployees(null);
  const deleteClaim = useDeleteClaim();

  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("all"); // all, 7d, 30d, 90d
  const [statusClaim, setStatusClaim] = useState<InsuranceClaim | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // الافتراضي: كل المطالبات النشطة حتى لا تختفي المطالبة الجديدة قبل وصول المركبة للورشة.
  const [deliveryFilter, setDeliveryFilter] = useState<string>(() => searchParams.get("location") || "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState<number>("insurance_claims_page_size", 20);
  const [reportOpen, setReportOpen] = useState(false);
  const [visibleCols, setVisibleCols] = usePersistedState<Record<string, boolean>>("insurance_claims_columns_v2", {
    number: true, vehicle: true, customer: true, insurance_company: true,
    estimated: true, approved: true, duration: true, location: true, status: true,
    created_at: false, estimate_date: false, payment_status: false,
  });
  const toggleCol = (key: string) => setVisibleCols((prev) => ({ ...prev, [key]: !prev[key] }));
  type SortKey = "number" | "customer" | "created_at" | "estimate_date" | "payment_status" | "duration";
  const [sortBy, setSortBy] = usePersistedState<SortKey>("insurance_claims_sort", "created_at");
  const [sortDir, setSortDir] = usePersistedState<"asc" | "desc">("insurance_claims_sort_dir", "desc");
  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("desc"); }
  };
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortBy !== k ? <ArrowUpDown size={11} className="inline opacity-40" /> :
    sortDir === "asc" ? <ArrowUp size={11} className="inline text-primary" /> :
    <ArrowDown size={11} className="inline text-primary" />;

  const companies = useMemo(() => {
    const set = new Set<string>();
    claims.forEach((c) => c.insurance_company && set.add(c.insurance_company));
    return Array.from(set).sort();
  }, [claims]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const ranges: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    return claims.filter((c) => {
      const location = getClaimVehicleLocation(c);
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (companyFilter !== "all" && c.insurance_company !== companyFilter) return false;
      if (employeeFilter !== "all" && (c as any).insurance_employee_id !== employeeFilter) return false;
      // فلتر حالة الورشة (الافتراضي = قيد العمل = نشطة ولم تُسلَّم ولم تُلغَ)
      if (deliveryFilter === "active" && !isActiveClaim(c)) return false;
      if (deliveryFilter !== "all" && deliveryFilter !== "active" && location !== deliveryFilter) return false;
      // "all" → بدون فلتر
      if (dateRange !== "all" && ranges[dateRange]) {
        const age = (now - new Date(c.created_at).getTime()) / 86400000;
        if (age > ranges[dateRange]) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const match =
          c.claim_number?.toLowerCase().includes(s) ||
          c.insurance_company?.toLowerCase().includes(s) ||
          c.customer?.name?.toLowerCase().includes(s) ||
          ((c as any).vehicle_plate ?? "").toLowerCase().includes(s) ||
          ((c as any).vehicle_make ?? "").toLowerCase().includes(s) ||
          ((c as any).vehicle_model ?? "").toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [claims, search, statusFilter, companyFilter, employeeFilter, dateRange, deliveryFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const getKey = (c: any): string | number => {
      switch (sortBy) {
        case "number": return c.claim_number ?? "";
        case "customer": return c.customer?.name ?? "";
        case "estimate_date": return c.estimate_date ?? c.created_at ?? "";
        case "payment_status": return c.status === "paid" ? 1 : 0;
        case "duration": return computeDays((c as any).workshop_arrival_date ?? c.created_at, (c as any).delivered_at) ?? 0;
        case "created_at":
        default: return c.created_at ?? "";
      }
    };
    arr.sort((a, b) => {
      const va = getKey(a), vb = getKey(b);
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, companyFilter, employeeFilter, dateRange, deliveryFilter, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deliveryFilterLabel = useMemo(() => {
    const map: Record<string, string> = {
      active: "المطالبات النشطة",
      in_workshop: "وصلت إلى الورشة",
      with_customer: "مع العميل",
      delivered: "تم التسليم",
      paid_archive: "أرشيف المدفوع",
      cancelled: "ملغاة / مرفوضة",
      all: "جميع المطالبات",
    };
    const parts = [map[deliveryFilter] || "جميع المطالبات"];
    if (statusFilter !== "all") parts.push(`الحالة: ${statusLabels[statusFilter]}`);
    if (companyFilter !== "all") parts.push(`الشركة: ${companyFilter}`);
    if (employeeFilter !== "all") {
      const employee = insuranceEmployees.find((item) => item.id === employeeFilter);
      parts.push(`موظف التأمين: ${employee?.name || "—"}`);
    }
    if (search) parts.push(`بحث: ${search}`);
    return parts.join(" · ");
  }, [deliveryFilter, statusFilter, companyFilter, employeeFilter, insuranceEmployees, search]);

  const exportCsv = () => {
    const headers = ["رقم المطالبة", "شركة التأمين", "العميل", "السيارة", "اللوحة", "المقدر", "المعتمد", "الحالة", "التاريخ"];
    const rows = filtered.map((c) => [
      c.claim_number, c.insurance_company, c.customer?.name || "",
      `${(c as any).vehicle_make || ""} ${(c as any).vehicle_model || ""}`.trim(),
      (c as any).vehicle_plate || "",
      Number(c.estimated_amount || 0), Number(c.approved_amount || 0),
      statusLabels[c.status], new Date(c.created_at).toLocaleDateString("en-GB"),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `claims-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totalAmount = filtered.reduce((s, c) => s + Number(c.estimated_amount || 0), 0);

  const bulk = useBulkSelection(filtered);
  function handleBulkDelete() {
    bulk.selectedIds.forEach((id) => deleteClaim.mutate(id));
    bulk.clear();
  }
  function handleBulkExport() {
    exportRowsAsCsv(
      `claims-${new Date().toISOString().slice(0, 10)}`,
      ["رقم المطالبة", "شركة التأمين", "العميل", "السيارة", "اللوحة", "المقدر", "المعتمد", "الحالة", "التاريخ"],
      bulk.selectedItems.map((c) => [
        c.claim_number, c.insurance_company, c.customer?.name || "",
        `${(c as any).vehicle_make || ""} ${(c as any).vehicle_model || ""}`.trim(),
        (c as any).vehicle_plate || "",
        Number(c.estimated_amount || 0), Number(c.approved_amount || 0),
        statusLabels[c.status], new Date(c.created_at).toLocaleDateString("en-GB"),
      ]),
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">جميع المطالبات</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            {toEnglishDigits(sorted.length.toLocaleString())} مطالبة — إجمالي{" "}
            <span className="font-mono" dir="ltr">{toEnglishDigits(Math.round(totalAmount).toLocaleString("en-US"))} OMR</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Zap size={16} /> قوالب سريعة
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>إنشاء مطالبة من قالب</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {QUICK_TEMPLATES.map((t) => (
                <DropdownMenuItem
                  key={t.label}
                  onClick={() => navigate(`/insurance/new?template=${encodeURIComponent(t.label)}`)}
                  className="gap-2 cursor-pointer"
                >
                  <span className="text-lg">{t.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{t.label}</div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={() => setReportOpen(true)} className="gap-2">
            <FileText size={16} /> تقرير عمليات الورشة
          </Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2">
            <Download size={16} /> تصدير CSV
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Columns size={16} /> الأعمدة
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>إظهار / إخفاء الأعمدة</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={visibleCols.number} onCheckedChange={() => toggleCol("number")}>رقم المطالبة</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.vehicle} onCheckedChange={() => toggleCol("vehicle")}>السيارة</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.customer} onCheckedChange={() => toggleCol("customer")}>العميل</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.insurance_company} onCheckedChange={() => toggleCol("insurance_company")}>شركة التأمين</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.estimated} onCheckedChange={() => toggleCol("estimated")}>المبلغ المقدر</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.approved} onCheckedChange={() => toggleCol("approved")}>المبلغ المعتمد</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.duration} onCheckedChange={() => toggleCol("duration")}>المدة</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.location} onCheckedChange={() => toggleCol("location")}>موقع المركبة</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.status} onCheckedChange={() => toggleCol("status")}>الحالة</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.created_at} onCheckedChange={() => toggleCol("created_at")}>تاريخ الإنشاء</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.estimate_date} onCheckedChange={() => toggleCol("estimate_date")}>تاريخ التقدير</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={visibleCols.payment_status} onCheckedChange={() => toggleCol("payment_status")}>حالة الدفع</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => navigate("/insurance/new")} className="gap-2">
            <Plus size={16} /> مطالبة جديدة
          </Button>
        </div>
      </div>


      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-3 md:p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-2 md:gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="رقم مطالبة، عميل، لوحة، شركة..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="md:w-44"><SelectValue placeholder="الحالة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="md:w-52"><SelectValue placeholder="شركة التأمين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الشركات</SelectItem>
              {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="md:w-52"><SelectValue placeholder="موظف التأمين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الموظفين</SelectItem>
              {insuranceEmployees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}{employee.title ? ` — ${employee.title}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="md:w-40"><SelectValue placeholder="الفترة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفترات</SelectItem>
              <SelectItem value="7d">آخر 7 أيام</SelectItem>
              <SelectItem value="30d">آخر 30 يوم</SelectItem>
            <SelectItem value="90d">آخر 90 يوم</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
            <SelectTrigger className="md:w-52"><SelectValue placeholder="حالة الورشة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">المطالبات النشطة</SelectItem>
              <SelectItem value="with_customer">مع العميل</SelectItem>
              <SelectItem value="in_workshop">وصلت إلى الورشة</SelectItem>
              <SelectItem value="delivered">تم التسليم</SelectItem>
              <SelectItem value="paid_archive">أرشيف المدفوع</SelectItem>
              <SelectItem value="cancelled">ملغاة / مرفوضة</SelectItem>
              <SelectItem value="all">جميع المطالبات</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Selection banner */}
      {bulk.count > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-primary/5 border border-primary/30 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold">
            تم تحديد <span className="text-primary font-mono">{toEnglishDigits(String(bulk.count))}</span> مطالبة
            {(() => {
              const delivered = bulk.selectedItems.filter((c) => !!(c as any).delivered_at).length;
              return delivered > 0 ? <span className="text-emerald-600 mr-2 text-xs">({delivered} مُسلَّمة)</span> : null;
            })()}
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-8" onClick={bulk.clear}>إلغاء التحديد</Button>
          <BulkClaimsActionsMenu selected={bulk.selectedItems} onClear={bulk.clear} />
        </div>
      )}

      {/* Mobile cards / Desktop table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : !sorted.length ? (
          <div className="p-8 text-center text-muted-foreground">
            {claims.length ? "لا توجد نتائج مطابقة" : "لا توجد مطالبات بعد"}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {paginated.map((c) => {
                const StatusIcon = statusIcons[c.status] || Clock;
                const location = getClaimVehicleLocation(c);
                const isDeliveredMobile = location === "delivered";
                return (
                  <button key={c.id} onClick={() => navigate(`/insurance/${c.id}`)} className={`w-full p-3 text-right transition ${isDeliveredMobile ? "bg-emerald-50/70 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border-r-4 border-r-emerald-500" : "hover:bg-secondary/40"}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs text-primary" dir="ltr">{toEnglishDigits(c.claim_number)}</span>
                      {isDeliveredMobile ? (
                        <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white border border-emerald-600 text-[10px] gap-1">
                          <CheckCircle size={10} /> تم التسليم
                        </Badge>
                      ) : (
                        <Badge className={`${statusColors[c.status]} border text-[10px] gap-1`}>
                          <StatusIcon size={10} /> {statusLabels[c.status]}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm font-medium">{c.insurance_company}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {(c as any).vehicle_make} {(c as any).vehicle_model} — {formatPlateLatin((c as any).vehicle_plate || "")}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-xs font-mono" dir="ltr" data-amount="true">{toEnglishDigits(Number(c.estimated_amount).toLocaleString("en-US"))} OMR</span>
                      <Badge className={`${claimVehicleLocationClass(location)} border text-[10px] gap-1`}>
                        <AlertTriangle size={10} /> {claimVehicleLocationLabels[location]}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="p-3 w-10"><Checkbox checked={bulk.allChecked} onCheckedChange={bulk.toggleAll} /></th>
                    {visibleCols.number && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("number")}>رقم <SortIcon k="number" /></th>}
                    {visibleCols.vehicle && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">السيارة</th>}
                    {visibleCols.customer && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("customer")}>العميل <SortIcon k="customer" /></th>}
                    {visibleCols.insurance_company && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">شركة التأمين</th>}
                    {visibleCols.estimated && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">المقدر</th>}
                    {visibleCols.approved && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">المعتمد</th>}
                    {visibleCols.duration && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("duration")}>المدة <SortIcon k="duration" /></th>}
                    {visibleCols.location && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">موقع المركبة</th>}
                    {visibleCols.status && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">الحالة</th>}
                    {visibleCols.created_at && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("created_at")}>تاريخ الإنشاء <SortIcon k="created_at" /></th>}
                    {visibleCols.estimate_date && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("estimate_date")}>تاريخ التقدير <SortIcon k="estimate_date" /></th>}
                    {visibleCols.payment_status && <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("payment_status")}>حالة الدفع <SortIcon k="payment_status" /></th>}
                    <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c) => {
                    const StatusIcon = statusIcons[c.status] || Clock;
                    const make = (c as any).vehicle_make ?? c.vehicle?.brand ?? "";
                    const model = (c as any).vehicle_model ?? c.vehicle?.model ?? "";
                    const plate = (c as any).vehicle_plate ?? c.vehicle?.plate_number ?? "";
                    const stop = (e: React.MouseEvent) => e.stopPropagation();
                    const location = getClaimVehicleLocation(c);
                    const isDelivered = location === "delivered";
                    const noArrival = location === "with_customer";
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border/50 cursor-pointer transition ${
                          isDelivered
                            ? "bg-emerald-50/70 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
                            : noArrival
                              ? "bg-destructive/5 hover:bg-destructive/10"
                              : "hover:bg-secondary/40"
                        }`}
                        onClick={() => navigate(`/insurance/${c.id}`)}
                      >
                        <td className="p-3" onClick={stop}><Checkbox checked={bulk.isSelected(c.id)} onCheckedChange={() => bulk.toggle(c.id)} /></td>
                        {visibleCols.number && (
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <VehicleAvatar
                                size="sm"
                                vehicleId={c.vehicle_id}
                                imageUrl={c.vehicle?.vehicle_thumbnail_url || c.vehicle?.vehicle_cover_image_url}
                                fallbackPhotos={c.damage_photos}
                                label={`${make} ${model}`.trim() || plate || c.claim_number}
                              />
                              <span className="font-mono text-xs text-primary" dir="ltr">{toEnglishDigits(c.claim_number)}</span>
                            </div>
                          </td>
                        )}
                        {visibleCols.vehicle && (
                          <td className="py-3 px-4">
                            <div className="font-medium">{`${make} ${model}`.trim() || "—"}</div>
                            {plate && <div className="text-[11px] mt-0.5 inline-block px-2 py-0.5 rounded bg-secondary border border-border font-mono" dir="ltr">{formatPlateLatin(plate)}</div>}
                          </td>
                        )}
                        {visibleCols.customer && <td className="py-3 px-4 text-xs text-muted-foreground">{c.customer?.name || "-"}</td>}
                        {visibleCols.insurance_company && <td className="py-3 px-4">{c.insurance_company}</td>}
                        {visibleCols.estimated && <td className="py-3 px-4 font-mono text-xs" dir="ltr" data-amount="true">{toEnglishDigits(Number(c.estimated_amount).toLocaleString("en-US"))} OMR</td>}
                        {visibleCols.approved && (
                          <td className="py-3 px-4 font-mono text-xs" dir="ltr" data-amount="true">
                            {(c.status === "approved" || c.status === "paid") ? `${toEnglishDigits(Number(c.approved_amount).toLocaleString("en-US"))} OMR` : "-"}
                          </td>
                        )}
                        {visibleCols.duration && (
                          <td className="py-3 px-4">
                            {(() => {
                              const days = computeDays((c as any).workshop_arrival_date ?? c.created_at, (c as any).delivered_at);
                              const lvl = durationLevel(days);
                              return (
                                <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-semibold ${durationBadgeClass(lvl)}`}>
                                  {toEnglishDigits(String(days ?? 0))} يوم
                                </span>
                              );
                            })()}
                          </td>
                        )}
                        {visibleCols.location && (
                          <td className="py-3 px-4">
                            <Badge className={`${claimVehicleLocationClass(location)} border text-[10px]`}>
                              {claimVehicleLocationLabels[location]}
                            </Badge>
                          </td>
                        )}
                        {visibleCols.status && (
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {isDelivered ? (
                                <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white border border-emerald-600 text-[10px] gap-1">
                                  <CheckCircle size={10} /> تم التسليم
                                </Badge>
                              ) : (
                                <Badge className={`${statusColors[c.status]} border text-[10px] gap-1`}>
                                  <StatusIcon size={10} /> {statusLabels[c.status]}
                                </Badge>
                              )}
                              {noArrival && (
                                <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] gap-1">
                                  <AlertTriangle size={10} /> لم يصل
                                </Badge>
                              )}
                            </div>
                          </td>
                        )}
                        {visibleCols.created_at && (
                          <td className="py-3 px-4 text-xs text-muted-foreground font-mono" dir="ltr">
                            {c.created_at ? new Date(c.created_at).toLocaleDateString("en-GB") : "—"}
                          </td>
                        )}
                        {visibleCols.estimate_date && (
                          <td className="py-3 px-4 text-xs text-muted-foreground font-mono" dir="ltr">
                            {((c as any).estimate_date || c.created_at) ? new Date((c as any).estimate_date || c.created_at).toLocaleDateString("en-GB") : "—"}
                          </td>
                        )}
                        {visibleCols.payment_status && (
                          <td className="py-3 px-4">
                            {c.status === "paid" ? (
                              <Badge className="bg-info/15 text-info border-info/30 border text-[10px] gap-1"><DollarSign size={10} /> مدفوعة</Badge>
                            ) : (
                              <Badge className="bg-muted text-muted-foreground border-muted border text-[10px]">غير مدفوعة</Badge>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-4" onClick={stop}>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); navigate(`/insurance/${c.id}`); }}><Eye size={14} /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { stop(e); setStatusClaim(c); }}><CheckCircle size={14} /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { stop(e); setDeleteId(c.id); }}><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePaginationControls
              page={page}
              pageSize={pageSize}
              totalItems={sorted.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="مطالبة">
        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={handleBulkExport}>
          <Download size={14} /> تصدير CSV
        </Button>
        <BulkClaimsActionsMenu selected={bulk.selectedItems} onClear={bulk.clear} compact />
      </BulkActionBar>


      <ClaimStatusDialog open={!!statusClaim} onOpenChange={(o) => !o && setStatusClaim(null)} claim={statusClaim} />


      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المطالبة</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد؟ لا يمكن التراجع.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteClaim.mutate(deleteId); setDeleteId(null); }}
            >حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WorkshopOperationsReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        claims={filtered}
        filterLabel={deliveryFilterLabel}
      />
    </div>
  );
}
