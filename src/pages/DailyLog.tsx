// السجل اليومي — جدول تفصيلي وواضح. أنواع الصيانة Checkboxes (لا أرقام).
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import { Plus, Upload, Download, Trash2, FileSpreadsheet, Wand2, ExternalLink, FileText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import {
  dailyLogStore,
  emptyRow,
  autoNetRevenue,
  generateOrderAndInvoiceForRow,
  type DailyLogRow,
} from "@/lib/dailyLogStore";

const COL_HEADERS = [
  "تحديد",
  "التاريخ", "اسم العميل", "الهاتف", "رقم السيارة", "نوع السيارة",
  "ميك", "كهر", "سكر", "صبغ",
  "ما دفعه الزبون", "المدفوع من العميل", "شراء قطع", "بيع قطع",
  "صافي الإيراد", "أمر العمل / الفاتورة", "إجراءات",
];

function parseExcelRow(r: any[], headers: string[]): Partial<DailyLogRow> | null {
  const obj: any = {};
  headers.forEach((h, i) => { obj[String(h).trim()] = r[i]; });

  const get = (...names: string[]) => {
    for (const n of names) {
      for (const k of Object.keys(obj)) {
        if (String(k).replace(/\s+/g, "").includes(n.replace(/\s+/g, ""))) return obj[k];
      }
    }
    return "";
  };
  const num = (v: any): number => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const bool = (v: any): number => {
    if (!v) return 0;
    const s = String(v).trim().toLowerCase();
    if (["1", "x", "✓", "نعم", "yes", "true", "y"].includes(s)) return 1;
    return num(v) > 0 ? 1 : 0;
  };

  const dateRaw = get("التاريخ", "Date");
  let date = "";
  if (dateRaw instanceof Date) date = dateRaw.toISOString().slice(0, 10);
  else if (typeof dateRaw === "number") {
    const d = new Date(Math.round((dateRaw - 25569) * 86400 * 1000));
    date = d.toISOString().slice(0, 10);
  } else if (dateRaw) {
    const s = String(dateRaw).trim();
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const yyyy = y.length === 2 ? `20${y}` : y;
      date = `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    } else date = s;
  }

  const customer = String(get("العميل", "Customer") || "").trim();
  if (!customer && !date) return null;

  const finalAmount = num(get("إجماليالفاتورة", "الفعلي", "Final", "Total"));
  return {
    date: date || new Date().toISOString().slice(0, 10),
    customer,
    phone: String(get("الهاتف", "Phone") || "").trim(),
    plate: String(get("رقمالسيارة", "Plate") || "").trim(),
    vehicleType: String(get("نوعالسيارة", "VehicleType") || "").trim(),
    mechanic: bool(get("ميكانيكا", "ميك", "Mechanic")),
    electric: bool(get("كهرباء", "كهر", "Electric")),
    lock: bool(get("سكرة", "سكر", "Lock")),
    paint: bool(get("صبغ", "Paint")),
    finalAmount,
    paidAmount: num(get("المدفوع", "Paid")) || finalAmount,
    partsBuy: num(get("شراءقطع", "شراء", "Buy")),
    partsSell: num(get("بيعقطع", "بيع", "Sell")),
    vendorAmount: 0,
    netRevenue: 0,
  };
}

export default function DailyLog() {
  const [rows, setRows] = useState<DailyLogRow[]>(dailyLogStore.list());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkPublish, setBulkPublish] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const toggleRow = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  const clearSel = () => setSelected(new Set());

  const doBulkDelete = () => {
    selected.forEach((id) => dailyLogStore.remove(id));
    toast.success(`تم حذف ${selected.size} صف`);
    clearSel();
    setBulkDelete(false);
  };
  const doBulkPublish = async () => {
    let n = 0;
    try {
      for (const id of Array.from(selected)) {
        const r = dailyLogStore.list().find((x) => x.id === id);
        if (!r || r.invoiceId) continue;
        const res = await generateOrderAndInvoiceForRow(r);
        dailyLogStore.update(r.id, {
          workOrderId: res.workOrderId, invoiceId: res.invoiceId,
          invoiceNumber: res.invoiceNumber, expenseId: res.expenseId,
        });
        n++;
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر نشر الصفوف في Supabase");
      return;
    }
    toast.success(`تم نشر ${n} صف`);
    clearSel();
    setBulkPublish(false);
  };

  useEffect(() => {
    const unsub = dailyLogStore.subscribe(() => setRows(dailyLogStore.list()));
    return () => { unsub(); };
  }, []);

  const addRow = () => {
    dailyLogStore.add(emptyRow());
    toast.success("تمت إضافة صف جديد");
  };

  const updateField = (id: string, field: keyof DailyLogRow, value: any) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const patch: Partial<DailyLogRow> = { [field]: value };
    if (["finalAmount", "paidAmount", "partsBuy"].includes(field as string)) {
      const paid = field === "paidAmount" ? Number(value) || 0 : row.paidAmount;
      const buy = field === "partsBuy" ? Number(value) || 0 : row.partsBuy;
      patch.netRevenue = autoNetRevenue({ paidAmount: paid, partsBuy: buy });
      // إذا لم يُحدد المدفوع، نطابقه مع الإجمالي
      if (field === "finalAmount" && !row.paidAmount) {
        patch.paidAmount = Number(value) || 0;
        patch.netRevenue = autoNetRevenue({ paidAmount: Number(value) || 0, partsBuy: row.partsBuy });
      }
    }
    dailyLogStore.update(id, patch);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if (!data.length) { toast.error("الملف فارغ"); return; }

      let headerIdx = data.findIndex((r) =>
        r.some((c) => /العميل|التاريخ|Customer|Date/i.test(String(c || "")))
      );
      if (headerIdx < 0) headerIdx = 0;
      const headers = data[headerIdx].map((c) => String(c || "").trim());

      let imported = 0;
      for (let i = headerIdx + 1; i < data.length; i++) {
        const r = data[i];
        if (!r || !r.length) continue;
        const parsed = parseExcelRow(r, headers);
        if (!parsed) continue;
        const sumAmounts = (parsed.finalAmount || 0) + (parsed.partsBuy || 0) + (parsed.partsSell || 0);
        if (!parsed.customer && !sumAmounts) continue;
        const row: DailyLogRow = { ...emptyRow(), ...parsed } as DailyLogRow;
        if (!row.netRevenue) row.netRevenue = autoNetRevenue(row);
        if (!row.paidAmount) row.paidAmount = row.finalAmount;
        dailyLogStore.add(row);
        imported++;
      }
      toast.success(`تم استيراد ${imported} صف من ${file.name}`);
    } catch (err: any) {
      console.error(err);
      toast.error("تعذّر قراءة الملف: " + (err?.message || ""));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generateForRow = async (row: DailyLogRow) => {
    if (!row.customer && !row.finalAmount) {
      toast.error("أدخل اسم العميل أو المبلغ أولاً");
      return;
    }
    let res: Awaited<ReturnType<typeof generateOrderAndInvoiceForRow>>;
    try {
      res = await generateOrderAndInvoiceForRow(row);
    } catch (error: any) {
      toast.error(error?.message || "تعذر نشر الصف في Supabase");
      return;
    }
    dailyLogStore.update(row.id, {
      workOrderId: res.workOrderId,
      invoiceId: res.invoiceId,
      invoiceNumber: res.invoiceNumber,
      expenseId: res.expenseId,
    });
    const extra = res.expenseId ? " + مصروف قطع غيار" : "";
    toast.success(`تم نشر ${res.workOrderId} (مغلق) + فاتورة ${res.invoiceNumber}${extra}`);
  };

  const generateAll = async () => {
    const pending = rows.filter((r) => !r.invoiceId);
    if (!pending.length) { toast.info("لا توجد صفوف بانتظار النشر"); return; }
    let n = 0;
    try {
      for (const r of pending) {
        const res = await generateOrderAndInvoiceForRow(r);
        dailyLogStore.update(r.id, {
          workOrderId: res.workOrderId,
          invoiceId: res.invoiceId,
          invoiceNumber: res.invoiceNumber,
          expenseId: res.expenseId,
        });
        n++;
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر نشر الصفوف في Supabase");
      return;
    }
    toast.success(`تم نشر ${n} أمر عمل + فاتورة (مغلقة) بنجاح`);
  };

  const downloadTemplate = () => {
    // قالب احترافي وواضح: الصيانات Checkboxes بـ X / فراغ
    const headers = [
      "التاريخ", "اسم العميل", "الهاتف", "رقم السيارة", "نوع السيارة",
      "ميكانيكا", "كهرباء", "سكرة", "صبغ",
      "إجمالي الفاتورة", "المدفوع من العميل", "شراء قطع غيار", "بيع قطع غيار",
    ];
    const rows = [
      headers,
      ["01/04/2026", "عبدالله أحمد", "92574411", "5193", "جي ام سي", "X", "",  "",  "X", 25, 25, 0,  3],
      ["02/04/2026", "خالد سالم",   "99887766", "1122", "تويوتا",   "X", "X", "",  "",  80, 80, 30, 50],
      ["03/04/2026", "سعيد ناصر",   "97123456", "8899", "نيسان",    "",  "",  "X", "",  15, 15, 0,  0],
      [],
      ["تعليمات:"],
      ["1. التاريخ: dd/mm/yyyy أو yyyy-mm-dd"],
      ["2. أنواع الصيانة: ضع X في العمود إذا تم العمل (لا تكتب أرقام)"],
      ["3. إجمالي الفاتورة = المبلغ المتفق عليه مع الزبون"],
      ["4. المدفوع = المبلغ المُستلم فعلياً (إن لم تكتبه يُعتبر مساوياً للإجمالي)"],
      ["5. شراء قطع غيار = تكلفتك على المورد (يُسجّل تلقائياً مصروف بنفس التاريخ)"],
      ["6. بيع قطع غيار = ما حصّلته من الزبون مقابل القطع"],
      ["7. عند النشر: يُنشأ أمر عمل مغلق + فاتورة + مصروف قطع غيار (إن وُجد)"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "السجل اليومي");
    XLSX.writeFile(wb, "نموذج_السجل_اليومي.xlsx");
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        finalAmount: acc.finalAmount + r.finalAmount,
        paidAmount: acc.paidAmount + (r.paidAmount || 0),
        partsBuy: acc.partsBuy + r.partsBuy,
        partsSell: acc.partsSell + r.partsSell,
        netRevenue: acc.netRevenue + r.netRevenue,
        published: acc.published + (r.invoiceId ? 1 : 0),
      }),
      { finalAmount: 0, paidAmount: 0, partsBuy: 0, partsSell: 0, netRevenue: 0, published: 0 },
    );
  }, [rows]);

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-primary" />
            السجل اليومي — أرشفة بيانات قديمة
          </h1>
          <p className="text-sm text-muted-foreground">
            ارفع Excel أو أدخل يدوياً. كل صف يُنشئ <b>أمر عمل مغلق + فاتورة + مصروف قطع غيار</b> بنفس تاريخ الصف.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 ml-1" /> رفع Excel
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="w-4 h-4 ml-1" /> تنزيل النموذج
          </Button>
          <Button onClick={addRow}>
            <Plus className="w-4 h-4 ml-1" /> صف جديد
          </Button>
          <Button onClick={generateAll} className="bg-success hover:bg-success/90 text-white">
            <Wand2 className="w-4 h-4 ml-1" /> نشر الكل (إغلاق + فواتير)
          </Button>
        </div>
      </div>

      {/* الإحصائيات */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          { label: "إجمالي الفواتير", value: totals.finalAmount, color: "text-blue-600" },
          { label: "المدفوع فعلياً", value: totals.paidAmount, color: "text-emerald-600" },
          { label: "غير المدفوع", value: totals.finalAmount - totals.paidAmount, color: "text-orange-600" },
          { label: "شراء القطع", value: totals.partsBuy, color: "text-red-600" },
          { label: "صافي الربح", value: totals.netRevenue, color: "text-primary font-bold" },
          { label: `منشور / إجمالي`, value: `${totals.published} / ${rows.length}`, color: "text-muted-foreground" },
        ].map((s, i) => (
          <Card key={i} className="p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`text-lg font-mono ${s.color}`}>
              {typeof s.value === "number" ? fmt(s.value) : s.value}
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="bg-slate-800 text-white">
              {COL_HEADERS.map((h, i) => (
                <th key={i} className="p-2 border border-slate-700 whitespace-nowrap text-xs font-semibold">
                  {i === 0 ? (
                    <Checkbox
                      checked={rows.length > 0 && selected.size === rows.length}
                      onCheckedChange={toggleAll}
                      className="border-white data-[state=checked]:bg-primary"
                    />
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COL_HEADERS.length} className="text-center py-10 text-muted-foreground">
                  لا توجد بيانات — اضغط <b>صف جديد</b> أو <b>رفع Excel</b>
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const published = !!row.invoiceId;
              return (
                <tr key={row.id} className={`hover:bg-muted/30 ${published ? "opacity-70 bg-emerald-50/30 dark:bg-emerald-950/10" : ""} ${selected.has(row.id) ? "bg-primary/10" : ""}`}>
                  <td className="p-1 border text-center">
                    <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} />
                  </td>
                  <td className="p-1 border"><Input disabled={published} className="h-8 text-xs w-32" type="date" value={row.date} onChange={(e) => updateField(row.id, "date", e.target.value)} /></td>
                  <td className="p-1 border"><Input disabled={published} className="h-8 text-xs w-32" value={row.customer} onChange={(e) => updateField(row.id, "customer", e.target.value)} /></td>
                  <td className="p-1 border"><Input disabled={published} className="h-8 text-xs w-24" value={row.phone} onChange={(e) => updateField(row.id, "phone", e.target.value)} /></td>
                  <td className="p-1 border"><Input disabled={published} className="h-8 text-xs w-20" value={row.plate} onChange={(e) => updateField(row.id, "plate", e.target.value)} /></td>
                  <td className="p-1 border"><Input disabled={published} className="h-8 text-xs w-24" value={row.vehicleType} onChange={(e) => updateField(row.id, "vehicleType", e.target.value)} /></td>
                  {(["mechanic", "electric", "lock", "paint"] as const).map((k) => (
                    <td key={k} className="p-1 border bg-amber-50/40 dark:bg-amber-950/20 text-center">
                      <Checkbox
                        disabled={published}
                        checked={!!row[k]}
                        onCheckedChange={(v) => updateField(row.id, k, v ? 1 : 0)}
                      />
                    </td>
                  ))}
                  <td className="p-1 border bg-blue-50/40 dark:bg-blue-950/20">
                    <Input disabled={published} className="h-8 text-xs w-24 text-center font-semibold" type="number" step="0.001" value={row.finalAmount || ""} onChange={(e) => updateField(row.id, "finalAmount", Number(e.target.value) || 0)} />
                  </td>
                  <td className="p-1 border bg-emerald-50/40 dark:bg-emerald-950/20">
                    <Input disabled={published} className="h-8 text-xs w-24 text-center font-semibold" type="number" step="0.001" value={row.paidAmount || ""} onChange={(e) => updateField(row.id, "paidAmount", Number(e.target.value) || 0)} />
                  </td>
                  <td className="p-1 border bg-red-50/40 dark:bg-red-950/20">
                    <Input disabled={published} className="h-8 text-xs w-20 text-center" type="number" step="0.001" value={row.partsBuy || ""} onChange={(e) => updateField(row.id, "partsBuy", Number(e.target.value) || 0)} />
                  </td>
                  <td className="p-1 border bg-green-50/40 dark:bg-green-950/20">
                    <Input disabled={published} className="h-8 text-xs w-20 text-center" type="number" step="0.001" value={row.partsSell || ""} onChange={(e) => updateField(row.id, "partsSell", Number(e.target.value) || 0)} />
                  </td>
                  <td className="p-1 border bg-primary/10 text-center font-bold text-primary">
                    {fmt(row.netRevenue || 0)}
                  </td>
                  <td className="p-1 border text-xs">
                    {published ? (
                      <div className="flex flex-col gap-1">
                        <Link to={`/work-orders/${row.workOrderId}`} className="text-blue-600 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> {row.workOrderId}
                          <Badge variant="secondary" className="text-[9px] mr-1">مغلق</Badge>
                        </Link>
                        <Link to={`/sales/invoices/${row.invoiceId}`} className="text-green-600 hover:underline flex items-center gap-1">
                          <FileText className="w-3 h-3" /> {row.invoiceNumber}
                        </Link>
                        {row.expenseId && (
                          <span className="text-orange-600 flex items-center gap-1">
                            <Wallet className="w-3 h-3" /> مصروف قطع
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-1 border">
                    <div className="flex gap-1">
                      {!published && (
                        <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={() => generateForRow(row)}>
                          <Wand2 className="w-3 h-3 ml-1" /> نشر
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => dailyLogStore.remove(row.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-amber-100 dark:bg-amber-900/40 font-bold">
                <td colSpan={10} className="p-2 border text-center">الإجمالي</td>
                <td className="p-2 border text-center text-blue-700">{fmt(totals.finalAmount)}</td>
                <td className="p-2 border text-center text-emerald-700">{fmt(totals.paidAmount)}</td>
                <td className="p-2 border text-center text-red-700">{fmt(totals.partsBuy)}</td>
                <td className="p-2 border text-center text-green-700">{fmt(totals.partsSell)}</td>
                <td className="p-2 border text-center text-primary">{fmt(totals.netRevenue)}</td>
                <td colSpan={2} className="p-2 border"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      <Card className="p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground leading-relaxed">
          💡 <b>ملاحظة مهمة:</b> هذه الواجهة لإدخال بيانات قديمة. عند الضغط على <b>نشر</b>، يُنشأ أمر عمل بحالة <b>"مغلق"</b> مباشرة (لأن العمل تم فعلاً)، فاتورة بتاريخ الصف، ومصروف لقطع الغيار بنفس التاريخ يُربط بأمر العمل والسيارة.
        </p>
      </Card>

      <BulkActionBar count={selected.size} onClear={clearSel} label="صف">
        <Button size="sm" variant="default" onClick={() => setBulkPublish(true)} className="h-8 gap-1">
          <Wand2 className="w-3 h-3" /> نشر المحدد
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setBulkDelete(true)} className="h-8 gap-1">
          <Trash2 className="w-3 h-3" /> حذف
        </Button>
      </BulkActionBar>

      <ConfirmDeleteDialog
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        onConfirm={doBulkDelete}
        title={`حذف ${selected.size} صف`}
        description="سيتم حذف الصفوف المحددة من السجل اليومي. لا يمكن التراجع عن هذا الإجراء."
      />
      <ConfirmDeleteDialog
        open={bulkPublish}
        onOpenChange={setBulkPublish}
        onConfirm={doBulkPublish}
        title={`نشر ${selected.size} صف`}
        description="سيتم إنشاء أمر عمل + فاتورة + مصروف قطع غيار لكل صف غير منشور من المحددين."
        confirmLabel="نشر"
      />
    </div>
  );
}
