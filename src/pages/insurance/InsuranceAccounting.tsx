import { useMemo, useState, useEffect } from "react";
import { buildPublicUrl } from "@/lib/publicAccessSettingsStore";
import { useAuth } from "@/contexts/AuthContext";
import { Search, Download, Eye, Trash2, Pencil, Plus, Filter, Receipt, AlertTriangle, CheckCircle2, FileSpreadsheet, FolderArchive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StatCard from "@/components/StatCard";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useInsuranceInvoices,
  useDeleteInsuranceInvoice,
  type InsuranceInvoice,
} from "@/hooks/useInsuranceInvoices";
import EditInsuranceInvoiceDialog from "@/components/insurance/EditInsuranceInvoiceDialog";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { getClaimTaxInvoiceHtml } from "@/lib/insurancePdfTemplates";
import { claimDocLabel, type ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { supabase } from "@/integrations/supabase/client";
import { formatDateLatin } from "@/lib/numberUtils";
import { toast } from "sonner";
import { usePersistedState } from "@/hooks/usePersistedState";
import { TablePaginationControls } from "@/components/ui/table-pagination-controls";

const STATUS_LABEL: Record<string, string> = {
  issued: "صادرة",
  partial: "جزئية",
  paid: "مدفوعة",
  overdue: "متأخرة",
  cancelled: "ملغاة",
};
const STATUS_COLORS: Record<string, string> = {
  issued: "bg-info/15 text-info",
  partial: "bg-warning/15 text-warning",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const insuranceInvoiceDate = (invoice: Pick<InsuranceInvoice, "invoice_date" | "issued_at" | "created_at">) =>
  invoice.invoice_date || invoice.issued_at?.slice(0, 10) || invoice.created_at?.slice(0, 10) || "";

export default function InsuranceAccounting() {
  const { hasRole } = useAuth();
  const { data: invoices, isLoading } = useInsuranceInvoices();
  const { data: claims } = useInsuranceClaims();
  const { data: companiesList } = useInsuranceCompanies();
  const del = useDeleteInsuranceInvoice();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState<number>("insurance_invoices_page_size", 20);

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editInvoice, setEditInvoice] = useState<InsuranceInvoice | null>(null);

  // ── أرشيف كل المستندات (تقديرات + عروض + فواتير + ملخصات) من claim_audit_logs ──
  const [allDocs, setAllDocs] = useState<Array<{
    id: string; claim_id: string; category: ClaimDocCategory;
    file_name: string; url: string; created_at: string; claim_number?: string;
  }>>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docCategoryFilter, setDocCategoryFilter] = useState<string>("all");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveUrl, setArchiveUrl] = useState("");
  const [archiveName, setArchiveName] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setDocsLoading(true);
      const { data, error } = await supabase
        .from("claim_audit_logs")
        .select("id, claim_id, category, file_path, details, created_at")
        .eq("action", "document_generated")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!active) return;
      if (error) { setDocsLoading(false); return; }
      const claimMap = new Map((claims || []).map((c) => [c.id, c.claim_number]));
      const rows = data || [];
      const { refreshSignedUrls } = await import("@/lib/refreshSignedUrls");
      const fresh = await refreshSignedUrls(
        "insurance-docs",
        rows.map((r: any) => r.file_path).filter(Boolean),
      );
      setAllDocs(rows.map((r: any) => ({
        id: r.id,
        claim_id: r.claim_id,
        category: (r.category || "claim_summary") as ClaimDocCategory,
        file_name: r.details?.file_name || r.file_path?.split("/").pop() || "document",
        url: fresh.get(r.file_path) || r.details?.url || "",
        created_at: r.created_at,
        claim_number: claimMap.get(r.claim_id) || "—",
      })));
      setDocsLoading(false);
    })();
    return () => { active = false; };
  }, [claims]);

  const allowDelete = hasRole("admin", "manager");

  const filteredDocs = useMemo(() => {
    return allDocs.filter((d) => {
      if (docCategoryFilter !== "all" && d.category !== docCategoryFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return d.file_name.toLowerCase().includes(s) || (d.claim_number || "").toLowerCase().includes(s);
    });
  }, [allDocs, docCategoryFilter, search]);

  // Aging
  const now = new Date();
  const ageDays = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));

  const companies = useMemo(() => {
    const set = new Set<string>();
    (invoices || []).forEach((i) => i.insurance_company_name && set.add(i.insurance_company_name));
    return Array.from(set).sort();
  }, [invoices]);

  const filtered = useMemo(() => {
    return (invoices || []).filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (companyFilter !== "all" && inv.insurance_company_name !== companyFilter) return false;
      const visibleDate = insuranceInvoiceDate(inv);
      if (dateFrom && visibleDate < dateFrom) return false;
      if (dateTo && visibleDate > dateTo) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        inv.invoice_number.toLowerCase().includes(s) ||
        inv.insurance_company_name.toLowerCase().includes(s) ||
        (inv.vehicle_plate || "").toLowerCase().includes(s) ||
        ((inv.vehicle_make || "") + " " + (inv.vehicle_model || "")).toLowerCase().includes(s)
      );
    });
  }, [invoices, search, statusFilter, companyFilter, dateFrom, dateTo]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedInvoices = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, companyFilter, dateFrom, dateTo, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // KPIs
  const totalIssued = filtered.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalPaid = filtered.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalOutstanding = totalIssued - totalPaid;
  const aging = filtered.reduce(
    (acc, i) => {
      const out = Number(i.total || 0) - Number(i.paid_amount || 0);
      if (out <= 0) return acc;
      const a = ageDays(insuranceInvoiceDate(i));
      if (a > 90) acc.over90 += out;
      else if (a > 60) acc.over60 += out;
      else if (a > 30) acc.over30 += out;
      else acc.current += out;
      return acc;
    },
    { current: 0, over30: 0, over60: 0, over90: 0 }
  );

  async function handlePreview(inv: InsuranceInvoice) {
    // اجلب دائماً أحدث نسخة من قاعدة البيانات لضمان وجود رقم الفاتورة المولّد من الـ trigger
    try {
      const { data: fresh } = await supabase
        .from("insurance_invoices" as any)
        .select("*")
        .eq("id", inv.id)
        .maybeSingle();
      if (fresh && (fresh as any).invoice_number) {
        inv = { ...inv, ...(fresh as any) } as InsuranceInvoice;
      }
    } catch {}
    const claim = claims?.find((c) => c.id === inv.claim_id);
    const company = companiesList?.find((c) => c.id === inv.insurance_company_id);
    // استخدام البنود المخزّنة إن وجدت، وإلا بند افتراضي من المجموع
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

    const html = await getClaimTaxInvoiceHtml({
      invoiceNumber: inv.invoice_number,
      invoiceDate: insuranceInvoiceDate(inv),
      dueDate: inv.due_date,
      claimNumber: claim?.claim_number || "—",
      insuranceCompany: inv.insurance_company_name,
      insuranceCompanyVat: company?.tax_number ?? null,
      insuranceCompanyCR: company?.commercial_registration ?? null,
      insuranceCompanyAddress: company?.address ?? null,
      insuranceCompanyPhone: company?.phone ?? null,
      insuranceCompanyLogoUrl: (company as any)?.logo_url ?? null,
      vehicle: {
        make: inv.vehicle_make ?? (claim as any)?.vehicle_make ?? claim?.vehicle?.brand ?? null,
        model: inv.vehicle_model ?? (claim as any)?.vehicle_model ?? claim?.vehicle?.model ?? null,
        plate: inv.vehicle_plate ?? (claim as any)?.vehicle_plate ?? claim?.vehicle?.plate_number ?? null,
        year: claim?.vehicle?.year ?? (claim as any)?.vehicle_year ?? null,
        color: (claim as any)?.vehicle_color ?? (claim as any)?.vehicle?.color ?? null,
        vin: (inv as any).vehicle_vin ?? (claim as any)?.vehicle_vin ?? (claim as any)?.vehicle?.vin ?? null,
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

  function exportCsv() {
    if (!filtered.length) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    const headers = ["رقم الفاتورة", "تاريخ الإصدار", "شركة التأمين", "المركبة", "اللوحة", "الإجمالي", "المدفوع", "المتبقي", "الحالة", "الاستحقاق"];
    const rows = filtered.map((i) => [
      i.invoice_number,
      insuranceInvoiceDate(i),
      i.insurance_company_name,
      `${i.vehicle_make || ""} ${i.vehicle_model || ""}`.trim(),
      i.vehicle_plate || "",
      Number(i.total).toFixed(3),
      Number(i.paid_amount).toFixed(3),
      (Number(i.total) - Number(i.paid_amount)).toFixed(3),
      STATUS_LABEL[i.status] || i.status,
      i.due_date || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `insurance-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير الملف");
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">محاسبة المطالبات</h1>
          <p className="text-xs md:text-sm text-muted-foreground">جميع الفواتير الصادرة لشركات التأمين مع المعاينة والتحميل</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} className="gap-2 w-full md:w-auto">
            <FileSpreadsheet size={16} /> تصدير CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <StatCard title="إجمالي الفواتير" value={`${totalIssued.toLocaleString()} ر.ع`} icon={Receipt} variant="info" />
        <StatCard title="المُحصّل" value={`${totalPaid.toLocaleString()} ر.ع`} icon={CheckCircle2} variant="success" />
        <StatCard title="المتبقي" value={`${totalOutstanding.toLocaleString()} ر.ع`} icon={AlertTriangle} variant="warning" />
        <StatCard title="عدد الفواتير" value={filtered.length} icon={Filter} variant="gold" />
      </div>

      {/* Aging panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-card border border-border rounded-xl p-4">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">جاري (≤30 يوم)</p>
          <p className="text-base font-bold text-success">{aging.current.toLocaleString()} ر.ع</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">31-60 يوم</p>
          <p className="text-base font-bold text-info">{aging.over30.toLocaleString()} ر.ع</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">61-90 يوم</p>
          <p className="text-base font-bold text-warning">{aging.over60.toLocaleString()} ر.ع</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">+90 يوم</p>
          <p className="text-base font-bold text-destructive">{aging.over90.toLocaleString()} ر.ع</p>
        </div>
      </div>

      {/* Filters — تتدفق على الجوال */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
        <div className="relative sm:col-span-2 md:col-span-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="بحث برقم الفاتورة، الشركة، اللوحة..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger><SelectValue placeholder="شركة التأمين" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الشركات</SelectItem>
            {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="من" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="إلى" />
      </div>

      {/* Tabs: Invoices / All documents archive */}
      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="grid w-full md:w-[460px] grid-cols-2 h-auto">
          <TabsTrigger value="invoices" className="gap-2 text-xs md:text-sm"><Receipt size={14} /> الفواتير</TabsTrigger>
          <TabsTrigger value="archive" className="gap-2 text-xs md:text-sm"><FolderArchive size={14} /> كل المستندات</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          {isLoading ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">جاري التحميل...</div>
          ) : !filtered.length ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              لا توجد فواتير. أصدر فاتورة من تفاصيل المطالبة بعد اعتمادها.
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {paginatedInvoices.map((inv) => (
                  <div key={inv.id} className="bg-card border border-border rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-primary truncate">{inv.invoice_number}</div>
                        <div className="text-sm font-semibold truncate">{inv.insurance_company_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {`${inv.vehicle_make || ""} ${inv.vehicle_model || ""}`.trim() || "—"}
                          {inv.vehicle_plate ? <> • <span className="font-mono">{inv.vehicle_plate}</span></> : null}
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[inv.status] || ""}`}>
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground" dir="ltr">{formatDateLatin(insuranceInvoiceDate(inv))}</span>
                      <span className="font-bold" dir="ltr">
                        {Number(inv.total).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} OMR
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                      <Button size="sm" variant="ghost" className="flex-1 h-8 text-xs" onClick={() => handlePreview(inv)}>
                        <Eye size={14} className="ml-1" /> معاينة
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-8 text-xs text-info" onClick={() => setEditInvoice(inv)}>
                        <Pencil size={14} className="ml-1" /> تعديل
                      </Button>
                      {allowDelete && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(inv.id)}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block bg-card border border-border rounded-xl shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">رقم الفاتورة</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">التاريخ</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">شركة التأمين</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المركبة</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">اللوحة</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الإجمالي</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المدفوع</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الحالة</th>
                        <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedInvoices.map((inv) => (
                        <tr key={inv.id} className="border-b border-border/50 hover:bg-secondary/20">
                          <td className="py-3 px-4 font-mono text-xs text-primary">{inv.invoice_number}</td>
                          <td className="py-3 px-4 text-muted-foreground" dir="ltr">
                            <div className="flex flex-col gap-0.5">
                              <span title="تاريخ إصدار الفاتورة">📄 {formatDateLatin(insuranceInvoiceDate(inv))}</span>
                              {(inv as any).last_payment_date && (
                                <span className="text-[10px] text-success" title="تاريخ آخر تحصيل">💵 {formatDateLatin((inv as any).last_payment_date)}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-foreground">{inv.insurance_company_name}</td>
                          <td className="py-3 px-4 text-muted-foreground">{`${inv.vehicle_make || ""} ${inv.vehicle_model || ""}`.trim() || "—"}</td>
                          <td className="py-3 px-4 text-muted-foreground font-mono">{inv.vehicle_plate || "—"}</td>
                          <td className="py-3 px-4 text-foreground font-medium" dir="ltr">{Number(inv.total).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} OMR</td>
                          <td className="py-3 px-4 text-success" dir="ltr">{Number(inv.paid_amount).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                          <td className="py-3 px-4">
                            <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${STATUS_COLORS[inv.status] || ""}`}>
                              {STATUS_LABEL[inv.status] || inv.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePreview(inv)} title="معاينة">
                                <Eye size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:text-info" onClick={() => setEditInvoice(inv)} title="تعديل">
                                <Pencil size={14} />
                              </Button>
                              {inv.pdf_url && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="تحميل PDF">
                                  <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer">
                                    <Download size={14} />
                                  </a>
                                </Button>
                              )}
                              {allowDelete && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(inv.id)} title="حذف">
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <TablePaginationControls
                page={page}
                pageSize={pageSize}
                totalItems={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="archive" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Select value={docCategoryFilter} onValueChange={setDocCategoryFilter}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="نوع المستند" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستندات</SelectItem>
                <SelectItem value="claim_estimate">تقدير المطالبة</SelectItem>
                <SelectItem value="tax_invoice">فاتورة ضريبية</SelectItem>
                <SelectItem value="claim_summary">ملخص المطالبة</SelectItem>
                <SelectItem value="delivery_proof">محضر تسليم</SelectItem>
                <SelectItem value="inspection">تقرير فحص</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{filteredDocs.length} مستند</span>
          </div>
          <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
            {docsLoading ? (
              <div className="p-8 text-center text-muted-foreground">جاري تحميل الأرشيف...</div>
            ) : !filteredDocs.length ? (
              <div className="p-8 text-center text-muted-foreground">لا توجد مستندات مؤرشفة.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">النوع</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">رقم المطالبة</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">اسم الملف</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">التاريخ</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map((d) => (
                      <tr key={d.id} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="py-3 px-4">
                          <span className="text-[10px] px-2 py-1 rounded-full font-medium bg-primary/15 text-primary">
                            {claimDocLabel(d.category, "ar")}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-primary">{d.claim_number}</td>
                        <td className="py-3 px-4 text-foreground truncate max-w-[260px]" title={d.file_name}>{d.file_name}</td>
                        <td className="py-3 px-4 text-muted-foreground" dir="ltr">{formatDateLatin(d.created_at)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {d.url && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="معاينة"
                                  onClick={() => { setArchiveUrl(d.url); setArchiveName(d.file_name); setArchiveOpen(true); }}>
                                  <Eye size={14} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="تحميل">
                                  <a href={d.url} target="_blank" rel="noopener noreferrer"><Download size={14} /></a>
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ArchivedPdfPreviewDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        url={archiveUrl}
        fileName={archiveName}
        title={archiveName}
      />

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

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفاتورة</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذه الفاتورة؟ لا يمكن التراجع عن الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) del.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
