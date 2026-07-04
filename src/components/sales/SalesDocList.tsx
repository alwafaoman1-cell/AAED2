import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Search, FileSpreadsheet, Cloud, Settings, MoreHorizontal, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { salesStore, SalesDoc, SalesDocType, SalesDocStatus, calculateTotals, cryptoRandom, makeEmptyDoc } from "@/lib/salesStore";
import SalesStatusBadge from "./SalesStatusBadge";
import { toast } from "sonner";

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
  const [, force] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    const unsub = salesStore.subscribe(() => force((x) => x + 1));
    void salesStore.refresh();
    return () => {
      unsub();
    };
  }, []);

  function exportCsv() {
    const all = salesStore.list({ type });
    if (all.length === 0) {
      toast.info(isAr ? "لا توجد بيانات للتصدير" : "Nothing to export");
      return;
    }
    const header = ["Number", "Date", "Customer", "Tax No.", "Status", "Subtotal", "Tax", "Total", "Paid", "Balance"];
    const rows = all.map((d) => [
      d.number,
      d.date,
      d.customerName,
      d.customerTaxNo || "",
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
  }

  function triggerImport() {
    fileRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
      let added = 0;
      for (const raw of arr) {
        const base = makeEmptyDoc(type);
        const items = Array.isArray(raw.items) ? raw.items.map((it: any) => ({
          id: cryptoRandom(),
          description: String(it.description || it.desc || ""),
          quantity: Number(it.quantity ?? it.qty ?? 1) || 1,
          unitPrice: Number(it.unitPrice ?? it.price ?? 0) || 0,
          discount: Number(it.discount ?? 0) || 0,
          tax: Number(it.tax ?? 5) || 0,
        })) : [];
        const totals = calculateTotals(items);
        salesStore.upsert({
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
      toast.success(isAr ? `تم استيراد ${added} مستند` : `Imported ${added} document(s)`);
    } catch (err: any) {
      toast.error(isAr ? "ملف غير صالح — يجب أن يكون JSON" : "Invalid file — must be JSON");
    }
  }

  function openSettings() {
    navigate("/settings/print-templates");
  }

  const items = useMemo(() => {
    const all = salesStore.list({ type });
    return all
      .filter((d) => (status === "all" ? true : d.status === status))
      .filter((d) => {
        if (!q.trim()) return true;
        const s = q.toLowerCase();
        return (
          d.number.toLowerCase().includes(s) ||
          d.customerName.toLowerCase().includes(s) ||
          (d.customerTaxNo || "").toLowerCase().includes(s)
        );
      });
  }, [q, status, type]);

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header bar (دفترة style) */}
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate(newRoute)} className="bg-success hover:bg-success/90 text-success-foreground gap-2">
            <Plus className="h-4 w-4" /> {isAr ? "جديد" : "New"}
          </Button>
          <Button variant="outline" size="icon" onClick={exportCsv} title={isAr ? "تصدير CSV" : "Export CSV"}><FileSpreadsheet className="h-4 w-4" /></Button>
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
            <Input value={q} onChange={(e) => setQ(e.target.value)} />
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
            <Button size="sm" className="gap-2"><Search className="h-3 w-3" /> {isAr ? "بحث" : "Search"}</Button>
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
        {items.length === 0 && (
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
                  {d.payments && d.payments.length > 0 && (() => {
                    const last = d.payments.reduce((a, b) => (a.date > b.date ? a : b)).date;
                    return (
                      <span className="text-success" title={isAr ? "تاريخ آخر تحصيل" : "Last payment"}>💵 {new Date(last).toLocaleDateString(isAr ? "ar-OM" : "en-GB")}</span>
                    );
                  })()}
                  <span>—</span>
                  <span className="font-mono">{d.number}</span>
                </div>
                <div className="text-sm font-medium truncate">{d.customerName || "—"}</div>
                {d.customerAddress && (
                  <div className="text-xs text-muted-foreground truncate">{d.customerAddress}</div>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono font-bold">{d.total.toFixed(3)} <span className="text-xs">{d.currency === "OMR" ? "ر.ع" : d.currency}</span></div>
                <div className="mt-1"><SalesStatusBadge status={d.status as SalesDocStatus} /></div>
              </div>
            </Link>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>{isAr ? `صفحة 1 من ${Math.max(1, Math.ceil(items.length / 20))}` : `Page 1 of ${Math.max(1, Math.ceil(items.length / 20))}`}</div>
        <div>{isAr ? `1 - ${items.length} من ${items.length}` : `1 - ${items.length} of ${items.length}`}</div>
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} label={isAr ? "مستند" : "doc"}>
        <Select onValueChange={(s) => {
          selected.forEach((id) => salesStore.setStatus(id, s as SalesDocStatus));
          toast.success(isAr ? `تم تحديث الحالة` : "Status updated");
          setSelected(new Set());
        }}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder={isAr ? "الحالة" : "Status"} /></SelectTrigger>
          <SelectContent>
            {["draft","sent","viewed","paid","partial","unpaid","overdue","cancelled"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => {
          const ids = Array.from(selected);
          const docs = salesStore.list({ type }).filter((d) => ids.includes(d.id));
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
        <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => {
          if (!confirm(isAr ? `حذف ${selected.size} مستند؟` : `Delete ${selected.size}?`)) return;
          selected.forEach((id) => salesStore.remove(id));
          toast.success(isAr ? "تم الحذف" : "Deleted");
          setSelected(new Set());
        }}>
          <Trash2 size={14} /> {isAr ? "حذف" : "Delete"}
        </Button>
      </BulkActionBar>
    </div>
  );
}
