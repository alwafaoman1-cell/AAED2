// قائمة تقديرات الإصلاح — مأخوذة من المطالبات (lump_sum / UPL)
// مع زر "تحويل إلى فاتورة ضريبية" يُنشئ سجلًا في insurance_invoices
// بنفس صيغة فاتورة الضريبة في صفحة الموافقة، ثم يفتح محرر الفاتورة.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Eye, FileText, Receipt, Filter, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowLeftRight,
  Printer, X, CheckSquare, Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import StatCard from "@/components/StatCard";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import EditInsuranceInvoiceDialog from "@/components/insurance/EditInsuranceInvoiceDialog";
import { useInsuranceClaims, useUpdateClaimStatus, type InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import {
  useInsuranceInvoices,
  useCreateInsuranceInvoice,
  type InsuranceInvoice,
} from "@/hooks/useInsuranceInvoices";
import { getClaimEstimateHtml, getClaimTaxInvoiceHtml } from "@/lib/insurancePdfTemplates";
import { buildHtmlWithPageMarginStyle } from "@/lib/pdfLayoutSettings";
import { openAndPrintWindow } from "@/lib/safePdfWindow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateLatin } from "@/lib/numberUtils";
import { buildPublicUrl } from "@/lib/publicAccessSettingsStore";

const VAT_RATE = 0.05;

const STATUS_LABEL: Record<string, string> = {
  pending: "قيد الانتظار",
  approved: "معتمدة",
  rejected: "مرفوضة",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  paid: "bg-info/15 text-info",
  cancelled: "bg-muted text-muted-foreground",
};

export default function InsuranceEstimates() {
  const navigate = useNavigate();
  const { data: claims, isLoading } = useInsuranceClaims();
  const { data: invoices } = useInsuranceInvoices();
  const { data: companiesList } = useInsuranceCompanies();
  const createInvoice = useCreateInsuranceInvoice();
  const updateStatus = useUpdateClaimStatus();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // all | lump_sum | upl
  const [convertedFilter, setConvertedFilter] = useState("all"); // all | converted | not_converted

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [editInvoice, setEditInvoice] = useState<InsuranceInvoice | null>(null);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Map claim_id → invoice (latest) لمعرفة المُحوّل إلى فاتورة
  const invoiceByClaim = useMemo(() => {
    const m = new Map<string, InsuranceInvoice>();
    (invoices || []).forEach((inv) => {
      if (!m.has(inv.claim_id)) m.set(inv.claim_id, inv);
    });
    return m;
  }, [invoices]);

  const filtered = useMemo(() => {
    return (claims || []).filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      const t = (c as any).estimation_type || "lump_sum";
      if (typeFilter !== "all" && t !== typeFilter) return false;
      const hasInv = invoiceByClaim.has(c.id);
      if (convertedFilter === "converted" && !hasInv) return false;
      if (convertedFilter === "not_converted" && hasInv) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        c.claim_number.toLowerCase().includes(s) ||
        c.insurance_company.toLowerCase().includes(s) ||
        (c.vehicle?.plate_number || (c as any).vehicle_plate || "").toLowerCase().includes(s) ||
        (c.customer?.name || "").toLowerCase().includes(s)
      );
    });
  }, [claims, search, statusFilter, typeFilter, convertedFilter, invoiceByClaim]);

  const totalEstimated = filtered.reduce((s, c) => s + Number(c.estimated_amount || 0), 0);
  const totalApproved = filtered.reduce((s, c) => s + Number(c.approved_amount || 0), 0);
  const convertedCount = filtered.filter((c) => invoiceByClaim.has(c.id)).length;

  function getClaimItems(c: InsuranceClaim): { description: string; quantity: number; unit_price: number }[] {
    const t = (c as any).estimation_type || "lump_sum";
    const upl = (c as any).upl_items as any[] | undefined;
    if (t === "upl" && Array.isArray(upl) && upl.length) {
      return upl.map((it) => ({
        description: String(it.description ?? ""),
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
      }));
    }
    const amount = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
    return [{
      description: `إصلاح أضرار المركبة - مطالبة ${c.claim_number}`,
      quantity: 1,
      unit_price: amount,
    }];
  }

  async function handlePreviewEstimate(c: InsuranceClaim) {
    try {
      const t = (c as any).estimation_type || "lump_sum";
      const upl = (c as any).upl_items as any[] | undefined;
      const html = getClaimEstimateHtml({
        claimNumber: c.claim_number,
        date: c.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        insuranceCompany: c.insurance_company,
        policyNumber: c.policy_number,
        policyExpiry: c.policy_expiry_date,
        adjusterName: c.adjuster_name,
        adjusterPhone: c.adjuster_phone,
        incidentDate: c.incident_date,
        incidentLocation: c.incident_location,
        incidentDescription: c.incident_description,
        customerName: c.customer?.name,
        customerPhone: c.customer?.phone,
        vehicle: {
          make: c.vehicle?.brand ?? (c as any).vehicle_make,
          model: c.vehicle?.model ?? (c as any).vehicle_model,
          plate: c.vehicle?.plate_number ?? (c as any).vehicle_plate,
          year: c.vehicle?.year ?? (c as any).vehicle_year,
          color: (c as any).vehicle_color,
        },
        estimationType: t as any,
        lumpSumAmount: Number(c.estimated_amount) || 0,
        uplItems: (Array.isArray(upl) ? upl : []) as any,
        deductibleAmount: Number(c.deductible_amount) || 0,
        damagePhotos: c.damage_photos || [],
      } as any);
      setPreviewHtml(html);
      setPreviewTitle(`تقدير الإصلاح ${c.claim_number}`);
      setShowPreview(true);
    } catch (e: any) {
      toast.error(e.message || "تعذّر إنشاء المعاينة");
    }
  }

  async function handlePreviewInvoice(inv: InsuranceInvoice) {
    const claim = (claims || []).find((c) => c.id === inv.claim_id);
    const storedItems = Array.isArray(inv.items) && inv.items.length
      ? inv.items.map((it: any) => ({
          description: String(it.description ?? ""),
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
        }))
      : [{
          description: `إصلاح أضرار المركبة - مطالبة ${claim?.claim_number || "—"}`,
          quantity: 1,
          unit_price: Number(inv.subtotal),
        }];
    const company = (companiesList || []).find((c) => c.id === (inv as any).insurance_company_id);
    const html = await getClaimTaxInvoiceHtml({
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date || inv.issued_at.slice(0, 10),
      dueDate: inv.due_date,
      claimNumber: claim?.claim_number || "—",
      insuranceCompany: inv.insurance_company_name,
      insuranceCompanyLogoUrl: (company as any)?.logo_url ?? null,
      vehicle: {
        make: inv.vehicle_make, model: inv.vehicle_model, plate: inv.vehicle_plate,
        year: claim?.vehicle?.year,
      },
      customerName: claim?.customer?.name,
      items: storedItems,
      vatRate: inv.subtotal > 0 ? (Number(inv.vat) / Number(inv.subtotal)) * 100 : 5,
      notes: inv.notes,
      lpoNumber: inv.lpo_number,
      estimationType: (claim?.estimation_type as any) || null,
      verifyUrl: (inv as any).secure_token ? buildPublicUrl(`/invoice/view/${(inv as any).secure_token}`) : null,
    });
    setPreviewHtml(html);
    setPreviewTitle(`فاتورة ${inv.invoice_number}`);
    setShowPreview(true);
  }

  async function convertToInvoice(c: InsuranceClaim) {
    if (c.status !== "approved" && c.status !== "paid") {
      toast.error("لا يمكن تحويل مطالبة غير معتمدة إلى فاتورة");
      return;
    }
    setBusyClaimId(c.id);
    try {
      const items = getClaimItems(c);
      const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
      const vat = subtotal * VAT_RATE;
      const total = subtotal + vat;

      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      if (!tenant) throw new Error("تعذّر التعرف على المستأجر");

      const created = await createInvoice.mutateAsync({
        tenant_id: tenant as string,
        claim_id: c.id,
        insurance_company_id: c.insurance_company_id ?? null,
        insurance_company_name: c.insurance_company,
        vehicle_make: c.vehicle?.brand ?? (c as any).vehicle_make ?? null,
        vehicle_model: c.vehicle?.model ?? (c as any).vehicle_model ?? null,
        vehicle_plate: c.vehicle?.plate_number ?? (c as any).vehicle_plate ?? null,
        subtotal,
        vat,
        total,
        paid_amount: 0,
        status: "issued",
        items,
      });
      // افتح محرر الفاتورة لتعديل الـ L.P.O / الملاحظات / الاستحقاق قبل الإصدار
      setEditInvoice(created as any);
    } catch (e: any) {
      toast.error(e.message || "فشل التحويل إلى فاتورة");
    } finally {
      setBusyClaimId(null);
    }
  }

  function exportCsv() {
    if (!filtered.length) { toast.error("لا توجد بيانات للتصدير"); return; }
    const headers = ["رقم المطالبة", "التاريخ", "الشركة", "المركبة", "النوع", "المبلغ المقدّر", "المعتمد", "الحالة", "محولة لفاتورة"];
    const rows = filtered.map((c) => {
      const t = (c as any).estimation_type || "lump_sum";
      return [
        c.claim_number,
        c.created_at.slice(0, 10),
        c.insurance_company,
        `${c.vehicle?.brand || (c as any).vehicle_make || ""} ${c.vehicle?.model || (c as any).vehicle_model || ""}`.trim(),
        t === "upl" ? "بنود (UPL)" : "إجمالي",
        Number(c.estimated_amount).toFixed(3),
        Number(c.approved_amount).toFixed(3),
        STATUS_LABEL[c.status] || c.status,
        invoiceByClaim.has(c.id) ? "نعم" : "لا",
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `claim-estimates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير الملف");
  }

  // ===== Bulk actions =====
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const selectedClaims = useMemo(
    () => filtered.filter((c) => selected.has(c.id)),
    [filtered, selected]
  );

  async function bulkChangeStatus(status: "pending" | "approved" | "rejected" | "paid" | "cancelled") {
    if (!selectedClaims.length) return;
    setBulkBusy(true);
    try {
      for (const c of selectedClaims) {
        if (c.status === status) continue;
        await updateStatus.mutateAsync({ id: c.id, status });
      }
      toast.success(`تم تحديث ${selectedClaims.length} تقدير`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e.message || "فشل تحديث الحالات");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkConvertToInvoice() {
    const eligible = selectedClaims.filter(
      (c) => (c.status === "approved" || c.status === "paid") && !invoiceByClaim.has(c.id)
    );
    if (!eligible.length) {
      toast.error("لا توجد تقديرات معتمدة قابلة للتحويل ضمن المحدد");
      return;
    }
    setBulkBusy(true);
    try {
      for (const c of eligible) await convertToInvoice(c);
      toast.success(`تم تحويل ${eligible.length} تقدير إلى فواتير`);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkPrintEstimates() {
    if (!selectedClaims.length) return;
    try {
      const parts = selectedClaims.map((c) => {
        const t = (c as any).estimation_type || "lump_sum";
        const upl = (c as any).upl_items as any[] | undefined;
        const html = getClaimEstimateHtml({
          claimNumber: c.claim_number,
          date: c.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
          insuranceCompany: c.insurance_company,
          policyNumber: c.policy_number,
          policyExpiry: c.policy_expiry_date,
          adjusterName: c.adjuster_name,
          adjusterPhone: c.adjuster_phone,
          incidentDate: c.incident_date,
          incidentLocation: c.incident_location,
          incidentDescription: c.incident_description,
          customerName: c.customer?.name,
          customerPhone: c.customer?.phone,
          vehicle: {
            make: c.vehicle?.brand ?? (c as any).vehicle_make,
            model: c.vehicle?.model ?? (c as any).vehicle_model,
            plate: c.vehicle?.plate_number ?? (c as any).vehicle_plate,
            year: c.vehicle?.year ?? (c as any).vehicle_year,
            color: (c as any).vehicle_color,
          },
          estimationType: t as any,
          lumpSumAmount: Number(c.estimated_amount) || 0,
          uplItems: (Array.isArray(upl) ? upl : []) as any,
          deductibleAmount: Number(c.deductible_amount) || 0,
          damagePhotos: c.damage_photos || [],
        } as any);
        return `<div style="page-break-after: always;">${html}</div>`;
      });
    const fullHtml = buildHtmlWithPageMarginStyle(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>طباعة تقديرات</title></head><body>${parts.join("")}</body></html>`);
      const w = openAndPrintWindow(fullHtml);
      if (!w) { toast.error("متصفحك يمنع النوافذ المنبثقة"); return; }
    } catch (e: any) {
      toast.error(e.message || "فشل الطباعة");
    }
  }


  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">قائمة تقديرات الإصلاح</h1>
          <p className="text-xs md:text-sm text-muted-foreground">جميع تقديرات إصلاح المركبات — يمكن تحويل أي تقدير إلى فاتورة ضريبية بنقرة واحدة</p>
        </div>
        <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
          <Button onClick={() => navigate("/insurance/independent-estimates?new=1")} className="gap-2 w-full md:w-auto">
            <Plus size={16} /> تقدير يدوي جديد
          </Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2 w-full md:w-auto">
            <FileSpreadsheet size={16} /> تصدير CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <StatCard title="إجمالي التقديرات" value={`${totalEstimated.toLocaleString()} ر.ع`} icon={FileText} variant="info" />
        <StatCard title="المعتمد" value={`${totalApproved.toLocaleString()} ر.ع`} icon={CheckCircle2} variant="success" />
        <StatCard title="عدد التقديرات" value={filtered.length} icon={Filter} variant="gold" />
        <StatCard title="محوّلة لفواتير" value={`${convertedCount} / ${filtered.length}`} icon={Receipt} variant="warning" />
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-primary/30 bg-primary/5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckSquare size={16} className="text-primary" />
            <span>{selected.size} تقدير محدد</span>
          </div>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={bulkBusy}>تغيير الحالة</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => bulkChangeStatus(k as any)}>{v}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={bulkConvertToInvoice} disabled={bulkBusy} className="gap-1">
            <ArrowLeftRight size={14} /> تحويل لفواتير
          </Button>
          <Button size="sm" variant="outline" onClick={bulkPrintEstimates} disabled={bulkBusy} className="gap-1">
            <Printer size={14} /> طباعة جماعية
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="gap-1">
            <X size={14} /> إلغاء
          </Button>
        </div>
      )}

      {/* Filters — responsive (تتدفق على الجوال) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <div className="relative sm:col-span-2 md:col-span-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="بحث: رقم/شركة/لوحة/عميل..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger><SelectValue placeholder="نوع التقدير" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="lump_sum">إجمالي (Lump Sum)</SelectItem>
            <SelectItem value="upl">بنود (UPL)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={convertedFilter} onValueChange={setConvertedFilter}>
          <SelectTrigger><SelectValue placeholder="حالة التحويل" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="converted">محوّلة لفاتورة</SelectItem>
            <SelectItem value="not_converted">لم تُحوَّل بعد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List — جدول للكمبيوتر، بطاقات للجوال */}
      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">جاري التحميل...</Card>
      ) : !filtered.length ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد تقديرات مطابقة</Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((c) => {
              const t = (c as any).estimation_type || "lump_sum";
              const inv = invoiceByClaim.get(c.id);
              return (
                <Card key={c.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-primary truncate">{c.claim_number}</div>
                      <div className="text-sm font-semibold truncate">{c.insurance_company}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(c.vehicle?.brand || (c as any).vehicle_make) || "—"} {(c.vehicle?.model || (c as any).vehicle_model) || ""}
                        {" • "}
                        <span className="font-mono">{c.vehicle?.plate_number || (c as any).vehicle_plate || "—"}</span>
                      </div>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[c.status] || ""}`}>
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t === "upl" ? "بنود (UPL)" : "إجمالي"} • {formatDateLatin(c.created_at)}
                    </span>
                    <span className="font-bold" dir="ltr">
                      {Number(c.approved_amount || c.estimated_amount).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} OMR
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                    <Button size="sm" variant="ghost" className="flex-1 h-8 text-xs" onClick={() => handlePreviewEstimate(c)}>
                      <Eye size={14} className="ml-1" /> معاينة
                    </Button>
                    {inv ? (
                      <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1" onClick={() => handlePreviewInvoice(inv)}>
                        <Receipt size={14} /> فاتورة #{inv.invoice_number.split("-").pop()}
                      </Button>
                    ) : (
                      <Button
                        size="sm" className="flex-1 h-8 text-xs gap-1"
                        onClick={() => convertToInvoice(c)}
                        disabled={busyClaimId === c.id || (c.status !== "approved" && c.status !== "paid")}
                      >
                        <ArrowLeftRight size={14} />
                        {busyClaimId === c.id ? "..." : "تحويل لفاتورة"}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="py-3 px-3 w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                    </th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">رقم المطالبة</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">التاريخ</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الشركة</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المركبة</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">النوع</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المبلغ</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الحالة</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الفاتورة</th>
                    <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const t = (c as any).estimation_type || "lump_sum";
                    const inv = invoiceByClaim.get(c.id);
                    const amount = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
                    return (
                      <tr key={c.id} className={`border-b border-border/50 hover:bg-secondary/20 ${selected.has(c.id) ? "bg-primary/5" : ""}`}>
                        <td className="py-3 px-3">
                          <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} />
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-primary">{c.claim_number}</td>
                        <td className="py-3 px-4 text-muted-foreground" dir="ltr">{formatDateLatin(c.created_at)}</td>
                        <td className="py-3 px-4 text-foreground">{c.insurance_company}</td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {`${c.vehicle?.brand || (c as any).vehicle_make || ""} ${c.vehicle?.model || (c as any).vehicle_model || ""}`.trim() || "—"}
                          <span className="text-[10px] block font-mono">{c.vehicle?.plate_number || (c as any).vehicle_plate || ""}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${t === "upl" ? "bg-info/15 text-info" : "bg-muted text-muted-foreground"}`}>
                            {t === "upl" ? "UPL" : "إجمالي"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-foreground font-medium" dir="ltr">
                          {amount.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} OMR
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${STATUS_COLORS[c.status] || ""}`}>
                            {STATUS_LABEL[c.status] || c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {inv ? (
                            <button
                              className="text-xs font-mono text-success hover:underline"
                              onClick={() => handlePreviewInvoice(inv)}
                              title="معاينة الفاتورة"
                            >
                              {inv.invoice_number}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePreviewEstimate(c)} title="معاينة التقدير">
                              <Eye size={14} />
                            </Button>
                            {!inv && (
                              <Button
                                variant="default" size="sm" className="h-7 text-xs gap-1"
                                onClick={() => convertToInvoice(c)}
                                disabled={busyClaimId === c.id || (c.status !== "approved" && c.status !== "paid")}
                                title={c.status !== "approved" ? "اعتمد المطالبة أولاً" : "تحويل إلى فاتورة ضريبية"}
                              >
                                <ArrowLeftRight size={12} />
                                {busyClaimId === c.id ? "..." : "تحويل لفاتورة"}
                              </Button>
                            )}
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => navigate(`/insurance/${c.id}`)}
                              title="فتح المطالبة"
                            >
                              <FileText size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <PdfPreviewDialog
        open={showPreview}
        onOpenChange={setShowPreview}
        htmlContent={previewHtml}
        title={previewTitle}
      />

      <EditInsuranceInvoiceDialog
        invoice={editInvoice}
        open={!!editInvoice}
        onOpenChange={(o) => !o && setEditInvoice(null)}
      />
    </div>
  );
}
