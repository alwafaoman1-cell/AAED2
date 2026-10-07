import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Search, FileSpreadsheet, Cloud, Settings, MoreHorizontal, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { salesStore, SalesDocType, SalesDocStatus, calculateTotals, cryptoRandom, makeEmptyDoc } from "@/lib/salesStore";
import { fetchNextNonInvoiceNumber, fetchSalesDocumentExport, fetchSalesDocumentPage, SALES_LIST_PAGE_SIZE } from "@/lib/salesDocumentQueries";
import SalesStatusBadge from "./SalesStatusBadge";
import { toast } from "sonner";
import { findUnifiedInvoiceNumber, type UnifiedInvoiceSearchResult } from "@/lib/unifiedInvoiceSearch";
import UnifiedInvoiceSearchResultsDialog from "./UnifiedInvoiceSearchResultsDialog";

interface Props {
  type: SalesDocType;
  title: string;
  newRoute: string;
  detailRoute: (id: string) => string;
}

const STATUS_FILTERS: { value: string; ar: string; en: string }[] = [
  { value: "all",      ar: "الكل",                en: "All" },
  { value: "paid",     ar: "مدفوعة بالزيادة",      en: "Paid" },
  { value: "unpaid",   ar: "غير مدفوعة",          en: "Unpaid" },
  { value: "overdue",  ar: "متأخر",               en: "Overdue" },
  { value: "partial",  ar: "مستحقة الدفع",         en: "Due" },
  { value: "draft",    ar: "مسودة",                en: "Draft" },
];

export default function SalesDocList({ type, title, newRoute, detailRoute }: Props) {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceSearchBusy, setInvoiceSearchBusy] = useState(false);
  const [invoiceMatches, setInvoiceMatches] = useState<UnifiedInvoiceSearchResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const tenantId = profile?.tenant_id || "";
  const listKey = ["sales_documents", tenantId, type, status, debouncedSearch, page] as const;
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => fetchSalesDocumentPage({ tenantId, type, status, search: debouncedSearch, page }),
    enabled: Boolean(tenantId),
    staleTime: 20_000,
    gcTime: 120_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  const items = listQuery.data?.rows || [];
  const total = listQuery.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / SALES_LIST_PAGE_SIZE));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(q.trim());
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [status, type]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    const unsubscribe = salesStore.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ["sales_documents", tenantId] });
    });
    return () => { unsubscribe(); };
  }, [queryClient, tenantId]);

  async function exportCsv() {
    if (!tenantId) return;
    setExporting(true);
    try {
    const all = await fetchSalesDocumentExport({ tenantId, type, status, search: debouncedSearch });
    if (!all.length) {
      toast.info(isAr ? "لا توجد بيانات للتصدير" : "Nothing to export");
      return;
    }
    const header = ["Number", "Date", "Customer", "Tax No.", "Status", "Subtotal", "Tax", "Total", "Paid", "Balance"];
    const rows = all.map((d) => [
      d.number,
      d.date,
      d.customerName,
      d.customerTaxNo,
      d.status,
      d.subtotal.toFixed(3),
      d.taxTotal.toFixed(3),
      d.total.toFixed(3),
      d.paidTotal.toFixed(3),
      d.balanceDue.toFixed(3),
    ]);
    const csv =
      "\uFEFF" + // BOM for Excel UTF-8
      [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(isAr ? "تم تصدير CSV" : "CSV exported");
    } catch (error) {
      console.error("[sales] export failed", error);
      toast.error(isAr ? "تعذر تصدير جميع النتائج. لم يُنشأ ملف ناقص." : "Export failed; no incomplete file was created.");
    } finally {
      setExporting(false);
    }
  }

  function triggerImport() {
    fileRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let added = 0;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
      const nextNumber = type === "invoice" ? "" : await fetchNextNonInvoiceNumber(tenantId, type);
      const sequence = nextNumber.match(/^(.*-)(\d+)$/);
      for (const raw of arr) {
        const base = makeEmptyDoc(type);
        if (sequence) base.number = `${sequence[1]}${String(Number(sequence[2]) + added).padStart(sequence[2].length, "0")}`;
        const items = Array.isArray(raw.items) ? raw.items.map((it: any) => ({
          id: cryptoRandom(),
          description: String(it.description || it.desc || ""),
          quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
          unitPrice: Number(it.unitPrice ?? it.price ?? 0) || 0,
          discount: Number(it.discount ?? 0) || 0,
          tax: Number(it.tax ?? 5) || 0,
        })) : [];
        const totals = calculateTotals(items);
        await salesStore.saveDraft({
          ...base,
          customerName: String(raw.customerName || raw.customer || ""),
          customerAddress: raw.customerAddress || "",
          customerTaxNo: raw.customerTaxNo || "",
          notes: raw.notes || "",
          items,
          ...totals,
          balanceDue: totals.total,
        });
        added++;
      }
      void queryClient.invalidateQueries({ queryKey: ["sales_documents", tenantId] });
      toast.success(isAr ? `تم حفظ ${added} مستند` : `Saved ${added} document(s)`);
    } catch (err: any) {
      void queryClient.invalidateQueries({ queryKey: ["sales_documents", tenantId] });
      const partial = added ? (isAr ? `حُفظ ${added} مستند قبل الخطأ. ` : `${added} document(s) saved before the error. `) : "";
      toast.error(partial + (err?.message || (isAr ? "تعذر استيراد الملف أو حفظه" : "Import or save failed")));
    }
  }

  function openSettings() {
    navigate("/settings/print-templates");
  }

  async function runUnifiedInvoiceSearch() {
    if (!q.trim()) return;
    setInvoiceSearchBusy(true);
    try {
      const matches = await findUnifiedInvoiceNumber(q);
      if (matches.length === 1) {
        navigate(matches[0].route);
        return;
      }
      if (matches.length > 1) {
        setInvoiceMatches(matches);
        return;
      }
      toast.info(isAr ? "لم يتم العثور على فاتورة بهذا الرقم" : "No invoice found with this number");
    } catch (error: any) {
      toast.error(error?.message || (isAr ? "تعذر البحث عن رقم الفاتورة" : "Invoice search failed"));
    } finally {
      setInvoiceSearchBusy(false);
    }
  }

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header bar (دفترة style) */}
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate(newRoute)} className="bg-success hover:bg-success/90 text-success-foreground gap-2">
            <Plus className="h-4 w-4" /> {isAr ? "جديد" : "New"}
          </Button>
          <Button variant="outline" size="icon" onClick={() => void exportCsv()} disabled={exporting || !tenantId} title={isAr ? "تصدير كل نتائج الفلتر CSV" : "Export all filtered results CSV"}><FileSpreadsheet className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" onClick={triggerImport} title={isAr ? "استيراد JSON" : "Import JSON"}><Cloud className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" onClick={openSettings} title={isAr ? "إعدادات القوالب" : "Template settings"}><Settings className="h-4 w-4" /></Button>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImportFile} hidden />
        </div>
      </div>

      {/* Search panel */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold text-muted-foreground">{isAr ? "بحث" : "Search"}</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">{isAr ? "العميل" : "Customer"}</label>
            <Input placeholder={isAr ? "أي عميل" : "Any customer"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{isAr ? "رقم المستند" : "Number"}</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter") void runUnifiedInvoiceSearch();
            }} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{isAr ? "الحالة" : "Status"}</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{isAr ? s.ar : s.en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setQ(""); setStatus("all"); }}>
              {isAr ? "إلغاء الفلتر" : "Reset"}
            </Button>
            <Button size="sm" className="gap-2" onClick={() => void runUnifiedInvoiceSearch()} disabled={invoiceSearchBusy}>
              <Search className="h-3 w-3" /> {invoiceSearchBusy ? (isAr ? "جاري البحث..." : "Searching...") : (isAr ? "بحث" : "Search")}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs row */}
      <div className="flex items-center gap-1 border-b">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`px-3 py-2 text-xs border-b-2 -mb-px transition ${
              status === s.value
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {isAr ? s.ar : s.en}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="rounded-lg border bg-card divide-y">
        {listQuery.isPending && <div className="text-center py-12 text-muted-foreground text-sm">{isAr ? "جارٍ تحميل الصفحة..." : "Loading page..."}</div>}
        {listQuery.isError && <div className="text-center py-12 text-destructive text-sm">{isAr ? "تعذر تحميل الفواتير" : "Unable to load documents"}<Button variant="link" onClick={() => void listQuery.refetch()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></div>}
        {!listQuery.isPending && !listQuery.isError && items.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {isAr ? "لا توجد نتائج" : "No results"}
          </div>
        )}
        {items.map((d) => (
          <div
            key={d.id}
            className={`flex items-center justify-between gap-4 p-3 hover:bg-muted/50 transition ${selected.has(d.id) ? "bg-primary/5" : ""}`}
          >
            <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
            </div>
            <Link to={detailRoute(d.id)} className="flex items-center justify-between gap-4 flex-1 min-w-0">
              <div className="flex-shrink-0 w-8 text-muted-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span title={isAr ? "تاريخ إصدار الفاتورة" : "Issue date"}>📄 {new Date(d.date).toLocaleDateString(isAr ? "ar-OM" : "en-GB")}</span>
                  {d.lastPaymentDate && <span className="text-success" title={isAr ? "تاريخ آخر تحصيل" : "Last payment"}>💵 {new Date(d.lastPaymentDate).toLocaleDateString(isAr ? "ar-OM" : "en-GB")}</span>}
                  <span>—</span>
                  <span className="font-mono">{d.number}</span>
                </div>
                <div className="text-sm font-medium truncate">{d.customerName || "—"}</div>
                {d.customerAddress && <div className="text-xs text-muted-foreground truncate">{d.customerAddress}</div>}
              </div>
              <div className="text-right">
                <div className="font-mono font-bold">{d.total.toFixed(3)} <span className="text-xs">{isAr ? "ر.ع" : "OMR"}</span></div>
                <div className="mt-1"><SalesStatusBadge status={d.status as SalesDocStatus} /></div>
              </div>
            </Link>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || listQuery.isFetching} onClick={() => { setPage((value) => value - 1); setSelected(new Set()); }}>{isAr ? "السابق" : "Previous"}</Button>
          <span>{isAr ? `صفحة ${page} من ${pageCount}` : `Page ${page} of ${pageCount}`}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount || listQuery.isFetching} onClick={() => { setPage((value) => value + 1); setSelected(new Set()); }}>{isAr ? "التالي" : "Next"}</Button>
        </div>
        <div>{total ? (page - 1) * SALES_LIST_PAGE_SIZE + 1 : 0} - {Math.min(page * SALES_LIST_PAGE_SIZE, total)} {isAr ? "من" : "of"} {total}</div>
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} label={isAr ? "مستند" : "doc"}>
        {type !== "invoice" && <Select onValueChange={async (s) => {
          setSavingBulk(true);
          const ids = Array.from(selected);
          const results = await Promise.allSettled(ids.map(async (id) => {
            const fresh = await salesStore.refreshOne(id);
            if (!fresh) throw new Error("Document not found");
            await salesStore.setStatusConfirmed(id, s as SalesDocStatus);
          }));
          const failed = ids.filter((_, index) => results[index].status === "rejected");
          setSelected(new Set(failed));
          setSavingBulk(false);
          void queryClient.invalidateQueries({ queryKey: ["sales_documents", tenantId] });
          if (failed.length) toast.error(isAr ? `تعذر تحديث ${failed.length} مستند` : `Failed to update ${failed.length} document(s)`);
          else toast.success(isAr ? "تم تحديث الحالة" : "Status updated");
        }}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder={isAr ? "الحالة" : "Status"} /></SelectTrigger>
          <SelectContent>
            {["draft","sent","viewed","paid","partial","unpaid","overdue","cancelled"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>}
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={savingBulk} onClick={() => {
          const ids = Array.from(selected);
          const docs = items.filter((d) => ids.includes(d.id));
          const header = ["Number","Date","Customer","Status","Total","Paid","Balance"];
          const rows = docs.map((d) => [d.number, d.date, d.customerName, d.status, d.total.toFixed(3), d.paidTotal.toFixed(3), d.balanceDue.toFixed(3)]);
          const csv = "\uFEFF" + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `${type}-selected.csv`; a.click(); URL.revokeObjectURL(url);
          toast.success(isAr ? `تم تصدير ${docs.length} سجل` : `Exported ${docs.length}`);
        }}>
          <FileSpreadsheet size={14} /> {isAr ? "تصدير" : "Export"}
        </Button>
        <Button size="sm" variant="destructive" className="h-8 gap-1" disabled={savingBulk} onClick={async () => {
          if (!confirm(isAr ? `حذف ${selected.size} مستند؟` : `Delete ${selected.size}?`)) return;
          setSavingBulk(true);
          const ids = Array.from(selected);
          const results = await Promise.allSettled(ids.map(async (id) => {
            const fresh = await salesStore.refreshOne(id);
            if (!fresh) throw new Error("Document not found");
            await salesStore.remove(id);
          }));
          const failedIds = ids.filter((_, index) => results[index].status === "rejected");
          setSavingBulk(false);
          void queryClient.invalidateQueries({ queryKey: ["sales_documents", tenantId] });
          if (failedIds.length === 0) {
            toast.success(isAr ? "تم حذف الفواتير وسندات القبض المرتبطة" : "Invoices and linked receipts deleted");
            setSelected(new Set());
          } else {
            toast.error(isAr ? `تعذر حذف ${failedIds.length} مستند` : `Failed to delete ${failedIds.length} document(s)`);
            setSelected(new Set(failedIds));
          }
        }}>
          <Trash2 size={14} /> {isAr ? "حذف" : "Delete"}
        </Button>
      </BulkActionBar>

      <UnifiedInvoiceSearchResultsDialog
        open={invoiceMatches.length > 1}
        onOpenChange={(open) => { if (!open) setInvoiceMatches([]); }}
        results={invoiceMatches}
        isAr={isAr}
        onOpenResult={(result) => {
          setInvoiceMatches([]);
          navigate(result.route);
        }}
      />
    </div>
  );
}
