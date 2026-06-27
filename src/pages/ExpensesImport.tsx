// استيراد المصروفات من Excel — يوزّع البنود تلقائياً حسب التصنيف
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import { Upload, Download, Trash2, Wallet, Wand2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import {
  expenseCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  type FinanceCategory,
} from "@/lib/financeSettingsStore";

interface StagedExpense {
  id: string;
  date: string;
  amount: number;
  categoryName: string;
  categoryId: string;
  beneficiary: string;
  description: string;
  paymentMethod: "cash" | "bank_transfer" | "cheque" | "card";
  pushed?: boolean;
  voucherNumber?: string;
}

const COLS = ["التاريخ", "البند / التصنيف", "المستفيد / المورد", "الوصف", "المبلغ (ر.ع)", "طريقة الدفع"];

function findCategory(name: string, cats: FinanceCategory[]): FinanceCategory | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return (
    cats.find((c) => c.name.toLowerCase() === n) ||
    cats.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()))
  );
}

function parseExcelDate(v: any): string {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function parsePayment(v: any): StagedExpense["paymentMethod"] {
  const s = String(v || "").trim().toLowerCase();
  if (/تحويل|bank/.test(s)) return "bank_transfer";
  if (/شيك|chequ/.test(s)) return "cheque";
  if (/بطاقة|card/.test(s)) return "card";
  return "cash";
}

export default function ExpensesImport() {
  const [staged, setStaged] = useState<StagedExpense[]>([]);
  const [cats, setCats] = useState<FinanceCategory[]>(expenseCategoriesStore.getAll());
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const u = expenseCategoriesStore.subscribe(() => setCats(expenseCategoriesStore.getAll()));
    return () => { u(); };
  }, []);

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
        r.some((c) => /التاريخ|البند|المبلغ|Date|Amount/i.test(String(c || "")))
      );
      if (headerIdx < 0) headerIdx = 0;
      const headers = data[headerIdx].map((c) => String(c || "").trim());
      const idx = (...names: string[]) => {
        for (const n of names) {
          const i = headers.findIndex((h) => h.replace(/\s+/g, "").includes(n.replace(/\s+/g, "")));
          if (i >= 0) return i;
        }
        return -1;
      };
      const iDate = idx("التاريخ", "Date");
      const iCat = idx("البند", "التصنيف", "Category");
      const iBenef = idx("المستفيد", "المورد", "Beneficiary", "Supplier");
      const iDesc = idx("الوصف", "Description");
      const iAmt = idx("المبلغ", "Amount");
      const iPay = idx("طريقةالدفع", "Payment");

      const out: StagedExpense[] = [];
      for (let i = headerIdx + 1; i < data.length; i++) {
        const r = data[i]; if (!r) continue;
        const amt = Number(String(r[iAmt] ?? "").replace(/[^\d.\-]/g, "")) || 0;
        const catName = String(r[iCat] ?? "").trim();
        if (!amt && !catName) continue;
        const cat = findCategory(catName, cats);
        out.push({
          id: `STG-${Date.now()}-${i}`,
          date: parseExcelDate(r[iDate]),
          amount: amt,
          categoryName: catName || cat?.name || "غير مصنف",
          categoryId: cat?.id || "",
          beneficiary: String(r[iBenef] ?? "").trim(),
          description: String(r[iDesc] ?? "").trim(),
          paymentMethod: parsePayment(r[iPay]),
        });
      }
      setStaged((prev) => [...out, ...prev]);
      toast.success(`تم تحميل ${out.length} بند للمراجعة`);
    } catch (err: any) {
      toast.error("تعذّر القراءة: " + (err?.message || ""));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pushOne = async (s: StagedExpense): Promise<boolean> => {
    if (!s.amount) { toast.error("المبلغ مطلوب"); return false; }
    const cat = cats.find((c) => c.id === s.categoryId) || findCategory(s.categoryName, cats);
    const cb = employeeCashboxesStore.getAll().find((c) => c.isDefault) || employeeCashboxesStore.getAll()[0];
    const voucher = voucherSettingsStore.generateNextNumber("payment");
    const rec: ExpenseRecord = {
      id: `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      voucherNumber: voucher,
      date: s.date,
      amount: s.amount,
      categoryId: cat?.id || "",
      categoryName: cat?.name || s.categoryName,
      cashboxId: cb?.id || "",
      cashboxName: cb?.cashboxName,
      paymentMethod: s.paymentMethod,
      beneficiary: s.beneficiary,
      description: s.description,
      createdAt: new Date().toISOString(),
    };
    try {
      await expensesStore.add(rec);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المصروف في Supabase");
      return false;
    }
    setStaged((prev) => prev.map((x) => x.id === s.id ? { ...x, pushed: true, voucherNumber: voucher } : x));
    return true;
  };

  const pushAll = async () => {
    const pending = staged.filter((s) => !s.pushed);
    if (!pending.length) { toast.info("لا يوجد بنود للنشر"); return; }
    let saved = 0;
    for (const item of pending) {
      if (await pushOne(item)) saved++;
    }
    toast.success(`تم نشر ${saved} بند مصروفات`);
  };

  const downloadTemplate = () => {
    const headers = COLS;
    const cats = expenseCategoriesStore.getAll().map((c) => c.name);
    const sampleCats = cats.length ? cats : ["إيجار وفواتير", "رواتب الموظفين", "قطع غيار", "صيانة معدات"];
    const rows = [
      headers,
      ["01/04/2026", sampleCats[0] || "إيجار وفواتير", "مالك العقار", "إيجار شهر أبريل", 350, "تحويل بنكي"],
      ["05/04/2026", sampleCats[1] || "رواتب الموظفين", "محمد علي", "راتب شهر مارس", 280, "نقدي"],
      ["07/04/2026", sampleCats[2] || "قطع غيار", "مؤسسة النور", "قطع تويوتا", 120, "نقدي"],
      ["10/04/2026", sampleCats[3] || "صيانة معدات", "ورشة الفنية", "صيانة كمبروسر", 45, "نقدي"],
      [],
      ["البنود المتاحة في النظام:"],
      ...cats.map((c) => ["", c]),
      [],
      ["تعليمات:"],
      ["• التاريخ: dd/mm/yyyy"],
      ["• البند / التصنيف: اكتبه كما هو في النظام (سيُطابق تلقائياً، أو يُنشأ كـ 'غير مصنف')"],
      ["• المبلغ بالريال العماني"],
      ["• طريقة الدفع: نقدي / تحويل بنكي / شيك / بطاقة"],
      ["• بعد الرفع، راجع البنود ثم اضغط 'نشر الكل' لإضافتها لسجل المصروفات"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المصروفات");
    XLSX.writeFile(wb, "نموذج_استيراد_المصروفات.xlsx");
  };

  // توزيع حسب البند للمعاينة
  const byCategory = useMemo(() => {
    const m = new Map<string, { count: number; total: number; pushed: number }>();
    staged.forEach((s) => {
      const k = s.categoryName || "غير مصنف";
      const cur = m.get(k) || { count: 0, total: 0, pushed: 0 };
      cur.count++; cur.total += s.amount; if (s.pushed) cur.pushed++;
      m.set(k, cur);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [staged]);

  const totals = useMemo(() => ({
    count: staged.length,
    total: staged.reduce((a, s) => a + s.amount, 0),
    pushed: staged.filter((s) => s.pushed).length,
  }), [staged]);

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" />
            استيراد المصروفات من Excel
          </h1>
          <p className="text-sm text-muted-foreground">
            ارفع ملف Excel للمصروفات — سيُوزَّع تلقائياً حسب البند والتصنيف.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/accounting/expenses/new">
            <Button variant="ghost"><ArrowRight className="w-4 h-4 ml-1" /> سجل المصروفات</Button>
          </Link>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="w-4 h-4 ml-1" /> تنزيل النموذج
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 ml-1" /> رفع Excel
          </Button>
          <Button onClick={pushAll} className="bg-success hover:bg-success/90 text-white">
            <Wand2 className="w-4 h-4 ml-1" /> نشر الكل
          </Button>
        </div>
      </div>

      {/* الإحصائيات */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-3"><div className="text-xs text-muted-foreground">عدد البنود</div><div className="text-xl font-bold">{totals.count}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي المصروفات</div><div className="text-xl font-mono text-red-600">{fmt(totals.total)} ر.ع</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">تم النشر</div><div className="text-xl font-bold text-emerald-600">{totals.pushed}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">بانتظار النشر</div><div className="text-xl font-bold text-orange-600">{totals.count - totals.pushed}</div></Card>
      </div>

      {/* توزيع حسب البند */}
      {byCategory.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">توزيع حسب البند</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {byCategory.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between p-2 border rounded bg-muted/30">
                <div>
                  <div className="font-medium text-sm">{k}</div>
                  <div className="text-xs text-muted-foreground">{v.count} بند ({v.pushed} منشور)</div>
                </div>
                <div className="font-mono text-red-600 font-bold">{fmt(v.total)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* جدول المعاينة */}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="bg-slate-800 text-white">
              {["#", "التاريخ", "البند", "المستفيد", "الوصف", "المبلغ", "طريقة الدفع", "الحالة", ""].map((h, i) => (
                <th key={i} className="p-2 border border-slate-700 text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staged.length === 0 && (
              <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">
                ابدأ برفع ملف Excel — استخدم زر "تنزيل النموذج" للحصول على القالب.
              </td></tr>
            )}
            {staged.map((s, i) => (
              <tr key={s.id} className={s.pushed ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                <td className="p-2 border text-center">{i + 1}</td>
                <td className="p-2 border whitespace-nowrap">{s.date}</td>
                <td className="p-2 border">{s.categoryName}</td>
                <td className="p-2 border">{s.beneficiary || "—"}</td>
                <td className="p-2 border text-xs">{s.description || "—"}</td>
                <td className="p-2 border text-center font-mono text-red-600">{fmt(s.amount)}</td>
                <td className="p-2 border text-center text-xs">{s.paymentMethod}</td>
                <td className="p-2 border text-center">
                  {s.pushed
                    ? <Badge className="bg-emerald-600">منشور — {s.voucherNumber}</Badge>
                    : <Badge variant="outline">بانتظار</Badge>}
                </td>
                <td className="p-2 border">
                  <div className="flex gap-1 justify-center">
                    {!s.pushed && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => pushOne(s)}>نشر</Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => setStaged((p) => p.filter((x) => x.id !== s.id))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
