import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, FileDown, Printer, CalendarRange, Plus, Trash2,
  TrendingUp, TrendingDown, Wallet, Building2, Users, Settings2, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { salesStore } from "@/lib/salesStore";
import { expensesStore } from "@/lib/expensesStore";
import { journalStore } from "@/lib/journalStore";
import { hrStore } from "@/lib/hrStore";
import { monthlySettingsStore, type FixedMonthlyCost } from "@/lib/monthlySettingsStore";
import { exportLandscapePdf } from "@/lib/landscapePdf";

const COLORS = {
  rev: "text-success",
  exp: "text-destructive",
  net: "text-primary",
};

function arabicMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-");
  const names = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

export default function MonthlyReport() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [openSettings, setOpenSettings] = useState(false);
  const [settings, setSettings] = useState(monthlySettingsStore.get());
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = monthlySettingsStore.subscribe(() => {
      setSettings(monthlySettingsStore.get());
      force((n) => n + 1);
    });
    return () => { unsub(); };
  }, []);

  // ====== جمع البيانات الشهرية ======
  const data = useMemo(() => {
    const monthPrefix = month; // YYYY-MM
    const inMonth = (iso?: string) => !!iso && iso.startsWith(monthPrefix);

    // 1) الإيرادات (فواتير المبيعات + قيود الإيرادات)
    const invoices = salesStore.list({ type: "invoice" })
      .filter((d) => inMonth((d.date || d.createdAt || "").slice(0, 10)));
    const salesRevenue = invoices.reduce((s, d) => s + (Number(d.total) || 0), 0);
    const salesPaid = invoices.reduce((s, d) => s + (Number(d.paidTotal) || 0), 0);
    const salesUnpaid = salesRevenue - salesPaid;

    // 2) إيرادات إضافية من قيود اليومية (تأمين/خدمات ورشة) لتكتمل الصورة
    const journals = journalStore.getAll().filter((j) => inMonth(j.date));
    const insuranceRevenue = journals
      .filter((j) => j.creditAccount === "إيرادات التأمين")
      .reduce((s, j) => s + j.amount, 0);
    const workshopServiceRevenue = journals
      .filter((j) => j.creditAccount === "إيرادات خدمات الورشة")
      .reduce((s, j) => s + j.amount, 0);

    const totalRevenue = salesRevenue + insuranceRevenue + workshopServiceRevenue;

    // 3) المصروفات من سندات الصرف
    const expenses = expensesStore.getAll().filter((e) => inMonth(e.date));
    // فصل قطع الغيار عن باقي المصروفات
    const partsExpenses = expenses.filter((e) => !!e.partName);
    const otherExpenses = expenses.filter((e) => !e.partName);
    const partsCost = partsExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const otherCost = otherExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    // تصنيف المصروفات الأخرى
    const byCategory: Record<string, { name: string; total: number; count: number }> = {};
    otherExpenses.forEach((e) => {
      const k = e.categoryName || e.categoryId || "غير مصنّف";
      if (!byCategory[k]) byCategory[k] = { name: k, total: 0, count: 0 };
      byCategory[k].total += Number(e.amount) || 0;
      byCategory[k].count += 1;
    });

    // 4) رواتب الموظفين (نظام HR)
    const employees = hrStore.listEmployees().filter((e) => e.employmentStatus === "active");
    const employeesPayroll = employees.map((e) => {
      const base = Number(e.baseSalary || 0);
      const allow = Number(e.housingAllowance || 0) + Number(e.transportAllowance || 0) + Number(e.otherAllowances || 0);
      const sum = hrStore.summary(e.id, monthPrefix);
      const gross = base + allow + (sum.monthBonuses || 0);
      const net = gross - (sum.monthDeductions || 0) - (sum.advanceMonthlyRepay || 0);
      return {
        employee: e,
        base, allow,
        bonuses: sum.monthBonuses,
        deductions: sum.monthDeductions,
        advanceRepay: sum.advanceMonthlyRepay,
        net,
      };
    });
    const salariesTotal = employeesPayroll.reduce((s, p) => s + p.net, 0)
      || (settings.defaultMonthlySalariesTotal || 0);

    // 5) التكاليف الثابتة الشهرية (إيجار + غيرها)
    const fixedCosts = settings.fixedCosts.filter((f) => f.active);
    const fixedTotal = fixedCosts.reduce((s, f) => s + (f.amount || 0), 0);

    // 6) المجاميع
    const totalExpense = partsCost + otherCost + salariesTotal + fixedTotal;
    const netProfit = totalRevenue - totalExpense;
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      monthPrefix,
      revenue: {
        sales: salesRevenue,
        salesPaid,
        salesUnpaid,
        insurance: insuranceRevenue,
        workshop: workshopServiceRevenue,
        total: totalRevenue,
        invoicesCount: invoices.length,
      },
      expenses: {
        parts: partsCost,
        partsCount: partsExpenses.length,
        other: otherCost,
        otherCount: otherExpenses.length,
        byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
        salaries: salariesTotal,
        employeesCount: employeesPayroll.length,
        fixed: fixedTotal,
        fixedItems: fixedCosts,
        total: totalExpense,
      },
      employeesPayroll,
      netProfit,
      margin,
    };
  }, [month, settings]);

  // ====== إعدادات: تعديل التكاليف الثابتة ======
  const addFixed = () => {
    const next: FixedMonthlyCost = {
      id: `FX-${Date.now()}`,
      name: "تكلفة شهرية جديدة",
      amount: 0,
      active: true,
    };
    monthlySettingsStore.update({ fixedCosts: [...settings.fixedCosts, next] });
  };
  const updateFixed = (id: string, patch: Partial<FixedMonthlyCost>) => {
    monthlySettingsStore.update({
      fixedCosts: settings.fixedCosts.map((f) => f.id === id ? { ...f, ...patch } : f),
    });
  };
  const removeFixed = (id: string) => {
    monthlySettingsStore.update({
      fixedCosts: settings.fixedCosts.filter((f) => f.id !== id),
    });
  };

  // ====== تصدير PDF أفقي شامل ======
  const exportPdf = async () => {
    try {
      toast({ title: "جاري إنشاء PDF…" });
      await exportLandscapePdf({
        title: `التقرير الشهري الشامل — ${arabicMonth(month)}`,
        subtitle: "ملخص الإيرادات، المصروفات، الرواتب، التكاليف الثابتة وصافي الربح",
        rangeLabel: arabicMonth(month),
        kpis: [
          { label: "إجمالي الإيرادات", value: data.revenue.total.toLocaleString(), color: "success" },
          { label: "إجمالي المصروفات", value: data.expenses.total.toLocaleString(), color: "danger" },
          { label: "الرواتب", value: data.expenses.salaries.toLocaleString(), color: "warning" },
          { label: "التكاليف الثابتة", value: data.expenses.fixed.toLocaleString(), color: "info" },
          { label: "صافي الربح", value: `${data.netProfit.toLocaleString()} (${data.margin.toFixed(1)}%)`,
            color: data.netProfit >= 0 ? "primary" : "danger" },
        ],
        sections: [
          {
            title: "1) الإيرادات",
            columns: [
              { key: "src", label: "المصدر", width: "40%" },
              { key: "count", label: "عدد", align: "center", width: "10%" },
              { key: "amount", label: "المبلغ (ر.ع)", align: "center", mono: true, color: "success" },
              { key: "pct", label: "النسبة %", align: "center", mono: true },
            ],
            rows: [
              { src: "فواتير المبيعات والورشة", count: data.revenue.invoicesCount, amount: data.revenue.sales.toLocaleString(),
                pct: data.revenue.total ? ((data.revenue.sales/data.revenue.total)*100).toFixed(1) : "0" },
              { src: "إيرادات تأمين (مرحّلة محاسبياً)", count: "—", amount: data.revenue.insurance.toLocaleString(),
                pct: data.revenue.total ? ((data.revenue.insurance/data.revenue.total)*100).toFixed(1) : "0" },
              { src: "إيرادات خدمات ورشة أخرى", count: "—", amount: data.revenue.workshop.toLocaleString(),
                pct: data.revenue.total ? ((data.revenue.workshop/data.revenue.total)*100).toFixed(1) : "0" },
              { src: "— مدفوع من فواتير المبيعات", count: "", amount: data.revenue.salesPaid.toLocaleString(), pct: "" },
              { src: "— متبقي على العملاء", count: "", amount: data.revenue.salesUnpaid.toLocaleString(), pct: "" },
            ],
            totals: { src: "إجمالي الإيرادات", count: "", amount: data.revenue.total.toLocaleString(), pct: "100" },
          },
          {
            title: "2) المصروفات حسب التصنيف",
            columns: [
              { key: "cat", label: "تصنيف المصروف", width: "55%" },
              { key: "count", label: "عدد السندات", align: "center", width: "15%" },
              { key: "amount", label: "المبلغ (ر.ع)", align: "center", mono: true, color: "danger" },
              { key: "pct", label: "النسبة %", align: "center", mono: true },
            ],
            rows: [
              { cat: "🔧 قطع غيار (مشتريات للسيارات)", count: data.expenses.partsCount,
                amount: data.expenses.parts.toLocaleString(),
                pct: data.expenses.total ? ((data.expenses.parts/data.expenses.total)*100).toFixed(1) : "0" },
              ...data.expenses.byCategory.map((c) => ({
                cat: c.name, count: c.count, amount: c.total.toLocaleString(),
                pct: data.expenses.total ? ((c.total/data.expenses.total)*100).toFixed(1) : "0",
              })),
            ],
            totals: { cat: "إجمالي المصروفات التشغيلية", count: data.expenses.partsCount + data.expenses.otherCount,
              amount: (data.expenses.parts + data.expenses.other).toLocaleString(), pct: "" },
          },
          {
            title: "3) الرواتب الشهرية للموظفين",
            columns: [
              { key: "n", label: "م", align: "center", width: "4%" },
              { key: "name", label: "الموظف", width: "20%" },
              { key: "pos", label: "المسمى", width: "15%" },
              { key: "base", label: "أساسي", align: "center", mono: true },
              { key: "allow", label: "بدلات", align: "center", mono: true },
              { key: "bonuses", label: "مكافآت", align: "center", mono: true, color: "success" },
              { key: "deductions", label: "خصومات", align: "center", mono: true, color: "danger" },
              { key: "advance", label: "سداد سُلف", align: "center", mono: true, color: "warning" },
              { key: "net", label: "صافي الراتب", align: "center", mono: true, color: "primary" },
            ],
            rows: data.employeesPayroll.length
              ? data.employeesPayroll.map((p, i) => ({
                  n: i + 1,
                  name: p.employee.name,
                  pos: p.employee.position || "—",
                  base: p.base.toLocaleString(),
                  allow: p.allow.toLocaleString(),
                  bonuses: (p.bonuses || 0).toLocaleString(),
                  deductions: (p.deductions || 0).toLocaleString(),
                  advance: (p.advanceRepay || 0).toLocaleString(),
                  net: p.net.toLocaleString(),
                }))
              : [{ n: "—", name: "لا يوجد موظفون مسجلون في النظام", pos: "", base: "", allow: "", bonuses: "", deductions: "", advance: "",
                  net: (settings.defaultMonthlySalariesTotal || 0).toLocaleString() }],
            totals: data.employeesPayroll.length ? {
              n: "", name: "إجمالي الرواتب", pos: "", base: "", allow: "", bonuses: "", deductions: "", advance: "",
              net: data.expenses.salaries.toLocaleString(),
            } : undefined,
          },
          {
            title: "4) التكاليف الثابتة الشهرية",
            columns: [
              { key: "name", label: "البند", width: "70%" },
              { key: "amount", label: "المبلغ (ر.ع)", align: "center", mono: true, color: "info" },
            ],
            rows: data.expenses.fixedItems.length
              ? data.expenses.fixedItems.map((f) => ({ name: f.name, amount: f.amount.toLocaleString() }))
              : [{ name: "لم يتم إعداد تكاليف ثابتة بعد — افتح الإعدادات لإضافتها", amount: "0" }],
            totals: { name: "إجمالي التكاليف الثابتة", amount: data.expenses.fixed.toLocaleString() },
          },
          {
            title: "5) ملخص الربح والخسارة (P&L)",
            columns: [
              { key: "label", label: "البيان", width: "70%" },
              { key: "value", label: "المبلغ (ر.ع)", align: "center", mono: true },
            ],
            rows: [
              { label: "إجمالي الإيرادات", value: data.revenue.total.toLocaleString() },
              { label: "(−) قطع غيار ومشتريات", value: `(${data.expenses.parts.toLocaleString()})` },
              { label: "(−) مصروفات تشغيلية أخرى", value: `(${data.expenses.other.toLocaleString()})` },
              { label: "(−) رواتب الموظفين", value: `(${data.expenses.salaries.toLocaleString()})` },
              { label: "(−) تكاليف ثابتة (إيجار وغيره)", value: `(${data.expenses.fixed.toLocaleString()})` },
              { label: "إجمالي المصروفات", value: data.expenses.total.toLocaleString() },
            ],
            totals: {
              label: data.netProfit >= 0 ? "✅ صافي الربح" : "❌ صافي الخسارة",
              value: `${data.netProfit.toLocaleString()} (هامش ${data.margin.toFixed(1)}%)`,
            },
          },
        ],
        footerNote: `تم إنشاء التقرير بناءً على بيانات الفواتير والمصروفات والرواتب لشهر ${arabicMonth(month)}.`,
      }, `monthly-report-${month}.pdf`);
      toast({ title: "تم التصدير بنجاح ✓" });
    } catch (e: any) {
      toast({ title: "فشل التصدير", description: e?.message || "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarRange className="text-primary" size={24} />
            التقرير الشهري الشامل
          </h1>
          <p className="text-xs text-muted-foreground">
            إيرادات + مصروفات + رواتب + إيجار وتكاليف ثابتة + صافي الربح — تقرير احترافي شهري
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-[180px]"
          />
          <Dialog open={openSettings} onOpenChange={setOpenSettings}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-1"><Settings2 size={14} /> التكاليف الثابتة</Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>إعدادات التكاليف الثابتة الشهرية</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  هذه البنود تُضاف تلقائياً كل شهر إلى التقرير (إيجار المحل، اشتراكات...).
                </p>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {settings.fixedCosts.map((f) => (
                    <div key={f.id} className="grid grid-cols-12 gap-2 items-center p-2 rounded border">
                      <Input className="col-span-6" value={f.name}
                        onChange={(e) => updateFixed(f.id, { name: e.target.value })}
                        placeholder="اسم البند" />
                      <Input className="col-span-3" type="number" value={f.amount}
                        onChange={(e) => updateFixed(f.id, { amount: Number(e.target.value) || 0 })}
                        placeholder="0" />
                      <div className="col-span-2 flex items-center gap-1">
                        <Switch checked={f.active}
                          onCheckedChange={(v) => updateFixed(f.id, { active: v })} />
                        <span className="text-xs text-muted-foreground">نشط</span>
                      </div>
                      <Button variant="ghost" size="icon" className="col-span-1 text-destructive"
                        onClick={() => removeFixed(f.id)}><Trash2 size={14} /></Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={addFixed} className="gap-1 w-full">
                  <Plus size={14} /> إضافة بند ثابت
                </Button>
                <div className="p-3 rounded bg-info/10 border border-info/30">
                  <Label className="text-xs">رواتب شهرية افتراضية (إذا لم يكن نظام HR معبأ)</Label>
                  <Input type="number" value={settings.defaultMonthlySalariesTotal || 0}
                    onChange={(e) => monthlySettingsStore.update({ defaultMonthlySalariesTotal: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setOpenSettings(false); toast({ title: "تم الحفظ ✓" }); }} className="gap-1">
                  <Save size={14} /> حفظ وإغلاق
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={exportPdf} className="gap-1 bg-destructive hover:bg-destructive/90">
            <FileDown size={14} /> PDF أفقي شامل
          </Button>
          <Button variant="outline" onClick={() => window.print()} className="gap-1"><Printer size={14} /> طباعة</Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1"><ArrowRight size={14} /> رجوع</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3 bg-success/5 border-success/30">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingUp size={11} /> إيرادات</p>
          <p className="text-lg font-bold text-success font-mono">{data.revenue.total.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground mt-1">{data.revenue.invoicesCount} فاتورة</p>
        </Card>
        <Card className="p-3 bg-destructive/5 border-destructive/30">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingDown size={11} /> مصروفات</p>
          <p className="text-lg font-bold text-destructive font-mono">{data.expenses.total.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground mt-1">{data.expenses.partsCount + data.expenses.otherCount} سند</p>
        </Card>
        <Card className="p-3 bg-warning/5 border-warning/30">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Users size={11} /> رواتب</p>
          <p className="text-lg font-bold text-warning font-mono">{data.expenses.salaries.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground mt-1">{data.expenses.employeesCount} موظف</p>
        </Card>
        <Card className="p-3 bg-info/5 border-info/30">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Building2 size={11} /> ثابتة</p>
          <p className="text-lg font-bold text-info font-mono">{data.expenses.fixed.toLocaleString()}</p>
          <p className="text-[9px] text-muted-foreground mt-1">{data.expenses.fixedItems.length} بند</p>
        </Card>
        <Card className={`p-3 ${data.netProfit >= 0 ? "bg-primary/5 border-primary/30" : "bg-destructive/10 border-destructive/40"}`}>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Wallet size={11} /> صافي الربح</p>
          <p className={`text-lg font-bold font-mono ${data.netProfit >= 0 ? "text-primary" : "text-destructive"}`}>
            {data.netProfit.toLocaleString()}
          </p>
          <p className="text-[9px] text-muted-foreground mt-1">هامش {data.margin.toFixed(1)}%</p>
        </Card>
      </div>

      {/* Section 1: Revenue */}
      <Card className="overflow-hidden">
        <div className="bg-success/10 px-4 py-2 border-b">
          <h2 className="font-bold text-success flex items-center gap-2"><TrendingUp size={16} /> 1) الإيرادات</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المصدر</TableHead>
              <TableHead className="text-center">عدد</TableHead>
              <TableHead className="text-center">المبلغ</TableHead>
              <TableHead className="text-center">النسبة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>فواتير المبيعات والورشة</TableCell>
              <TableCell className="text-center">{data.revenue.invoicesCount}</TableCell>
              <TableCell className="text-center font-mono text-success">{data.revenue.sales.toLocaleString()}</TableCell>
              <TableCell className="text-center text-xs">{data.revenue.total ? ((data.revenue.sales/data.revenue.total)*100).toFixed(1) : 0}%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="pl-8 text-xs text-muted-foreground">— مدفوع</TableCell>
              <TableCell />
              <TableCell className="text-center font-mono text-xs text-success">{data.revenue.salesPaid.toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell className="pl-8 text-xs text-muted-foreground">— متبقي على العملاء</TableCell>
              <TableCell />
              <TableCell className="text-center font-mono text-xs text-warning">{data.revenue.salesUnpaid.toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell>إيرادات تأمين</TableCell>
              <TableCell className="text-center">—</TableCell>
              <TableCell className="text-center font-mono text-success">{data.revenue.insurance.toLocaleString()}</TableCell>
              <TableCell className="text-center text-xs">{data.revenue.total ? ((data.revenue.insurance/data.revenue.total)*100).toFixed(1) : 0}%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>إيرادات خدمات ورشة أخرى</TableCell>
              <TableCell className="text-center">—</TableCell>
              <TableCell className="text-center font-mono text-success">{data.revenue.workshop.toLocaleString()}</TableCell>
              <TableCell className="text-center text-xs">{data.revenue.total ? ((data.revenue.workshop/data.revenue.total)*100).toFixed(1) : 0}%</TableCell>
            </TableRow>
            <TableRow className="bg-success/10 font-bold">
              <TableCell>الإجمالي</TableCell>
              <TableCell />
              <TableCell className="text-center font-mono text-success">{data.revenue.total.toLocaleString()}</TableCell>
              <TableCell className="text-center">100%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Section 2: Expenses by Category */}
      <Card className="overflow-hidden">
        <div className="bg-destructive/10 px-4 py-2 border-b">
          <h2 className="font-bold text-destructive flex items-center gap-2"><TrendingDown size={16} /> 2) المصروفات حسب التصنيف</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التصنيف</TableHead>
              <TableHead className="text-center">عدد السندات</TableHead>
              <TableHead className="text-center">المبلغ</TableHead>
              <TableHead className="text-center">النسبة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>🔧 قطع غيار للسيارات</TableCell>
              <TableCell className="text-center">{data.expenses.partsCount}</TableCell>
              <TableCell className="text-center font-mono text-destructive">{data.expenses.parts.toLocaleString()}</TableCell>
              <TableCell className="text-center text-xs">{data.expenses.total ? ((data.expenses.parts/data.expenses.total)*100).toFixed(1) : 0}%</TableCell>
            </TableRow>
            {data.expenses.byCategory.map((c) => (
              <TableRow key={c.name}>
                <TableCell>{c.name}</TableCell>
                <TableCell className="text-center">{c.count}</TableCell>
                <TableCell className="text-center font-mono text-destructive">{c.total.toLocaleString()}</TableCell>
                <TableCell className="text-center text-xs">{data.expenses.total ? ((c.total/data.expenses.total)*100).toFixed(1) : 0}%</TableCell>
              </TableRow>
            ))}
            {data.expenses.byCategory.length === 0 && data.expenses.partsCount === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا توجد مصروفات في هذا الشهر</TableCell></TableRow>
            )}
            <TableRow className="bg-destructive/10 font-bold">
              <TableCell>إجمالي المصروفات التشغيلية</TableCell>
              <TableCell className="text-center">{data.expenses.partsCount + data.expenses.otherCount}</TableCell>
              <TableCell className="text-center font-mono text-destructive">{(data.expenses.parts + data.expenses.other).toLocaleString()}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Section 3: Salaries */}
      <Card className="overflow-hidden">
        <div className="bg-warning/10 px-4 py-2 border-b flex items-center justify-between">
          <h2 className="font-bold text-warning flex items-center gap-2"><Users size={16} /> 3) الرواتب الشهرية ({data.expenses.employeesCount} موظف)</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/staff")} className="text-xs">إدارة الموظفين →</Button>
        </div>
        {data.employeesPayroll.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            لا يوجد موظفون نشطون في النظام —
            {settings.defaultMonthlySalariesTotal ? ` يستخدم التقرير القيمة الافتراضية: ${settings.defaultMonthlySalariesTotal.toLocaleString()} ر.ع` : " افتح الإعدادات لتحديد قيمة افتراضية."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">م</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>المسمى</TableHead>
                <TableHead className="text-center">أساسي</TableHead>
                <TableHead className="text-center">بدلات</TableHead>
                <TableHead className="text-center">مكافآت</TableHead>
                <TableHead className="text-center">خصومات</TableHead>
                <TableHead className="text-center">سداد سُلف</TableHead>
                <TableHead className="text-center">صافي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employeesPayroll.map((p, i) => (
                <TableRow key={p.employee.id}>
                  <TableCell className="text-center text-xs">{i + 1}</TableCell>
                  <TableCell className="text-xs font-medium">{p.employee.name}</TableCell>
                  <TableCell className="text-xs">{p.employee.position}</TableCell>
                  <TableCell className="text-center font-mono text-xs">{p.base.toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs">{p.allow.toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-success">{(p.bonuses || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-destructive">{(p.deductions || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-warning">{(p.advanceRepay || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs font-bold text-primary">{p.net.toLocaleString()}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-warning/10 font-bold">
                <TableCell colSpan={8} className="text-right">إجمالي الرواتب</TableCell>
                <TableCell className="text-center font-mono text-primary">{data.expenses.salaries.toLocaleString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Section 4: Fixed Costs */}
      <Card className="overflow-hidden">
        <div className="bg-info/10 px-4 py-2 border-b flex items-center justify-between">
          <h2 className="font-bold text-info flex items-center gap-2"><Building2 size={16} /> 4) التكاليف الثابتة الشهرية</h2>
          <Button variant="ghost" size="sm" onClick={() => setOpenSettings(true)} className="text-xs gap-1">
            <Settings2 size={12} /> تعديل
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>البند</TableHead><TableHead className="text-center">المبلغ (ر.ع)</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data.expenses.fixedItems.length === 0 ? (
              <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">لم يتم إعداد تكاليف ثابتة بعد — اضغط "تعديل" لإضافة الإيجار وغيره</TableCell></TableRow>
            ) : data.expenses.fixedItems.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="text-sm">{f.name}</TableCell>
                <TableCell className="text-center font-mono text-info">{f.amount.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-info/10 font-bold">
              <TableCell>إجمالي التكاليف الثابتة</TableCell>
              <TableCell className="text-center font-mono text-info">{data.expenses.fixed.toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Section 5: P&L Summary */}
      <Card className="overflow-hidden border-2 border-primary/30">
        <div className="bg-primary/10 px-4 py-2 border-b">
          <h2 className="font-bold text-primary flex items-center gap-2"><Wallet size={16} /> 5) ملخص الربح والخسارة (P&L)</h2>
        </div>
        <Table>
          <TableBody>
            <TableRow><TableCell className="font-medium">إجمالي الإيرادات</TableCell>
              <TableCell className="text-center font-mono text-success font-bold">{data.revenue.total.toLocaleString()}</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">(−) قطع غيار ومشتريات</TableCell>
              <TableCell className="text-center font-mono text-destructive">({data.expenses.parts.toLocaleString()})</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">(−) مصروفات تشغيلية أخرى</TableCell>
              <TableCell className="text-center font-mono text-destructive">({data.expenses.other.toLocaleString()})</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">(−) رواتب الموظفين</TableCell>
              <TableCell className="text-center font-mono text-destructive">({data.expenses.salaries.toLocaleString()})</TableCell></TableRow>
            <TableRow><TableCell className="text-muted-foreground">(−) تكاليف ثابتة (إيجار وغيره)</TableCell>
              <TableCell className="text-center font-mono text-destructive">({data.expenses.fixed.toLocaleString()})</TableCell></TableRow>
            <TableRow><TableCell className="font-medium">إجمالي المصروفات</TableCell>
              <TableCell className="text-center font-mono text-destructive font-bold">{data.expenses.total.toLocaleString()}</TableCell></TableRow>
            <TableRow className={`font-bold text-lg ${data.netProfit >= 0 ? "bg-success/10" : "bg-destructive/10"}`}>
              <TableCell>{data.netProfit >= 0 ? "✅ صافي الربح" : "❌ صافي الخسارة"}</TableCell>
              <TableCell className={`text-center font-mono ${data.netProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {data.netProfit.toLocaleString()} <span className="text-xs">({data.margin.toFixed(1)}%)</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
