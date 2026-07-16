import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Download, FileDown, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportLandscapePdf } from "@/lib/landscapePdf";
import { printCurrentPageAsPdf } from "@/lib/safePdfWindow";
import { toast } from "@/hooks/use-toast";
import {
  buildWorkOrderAccountingRows,
  formatOMR,
  summarizeAccounting,
  type WorkOrderAccountingRow,
} from "@/lib/accounting/core";

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function costSourceLabel(source: string) {
  if (source === "Actual Expenses") return "مصروفات فعلية";
  if (source === "Manual Final Cost") return "تكلفة نهائية يدوية";
  return "تقديري فقط - غير مكتمل محاسبيًا";
}

export default function WorkOrdersStatement() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buildWorkOrderAccountingRows({ from, to })
      .filter((row) => {
        if (!q) return true;
        return [
          row.workOrderNumber,
          row.customerName,
          row.customerPhone,
          row.vehiclePlate,
          row.vehicleName,
          row.serviceType,
          row.status,
        ].some((value) => String(value || "").toLowerCase().includes(q));
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [from, to, search]);

  const totals = useMemo(() => summarizeAccounting(rows), [rows]);

  const exportCsv = () => {
    const headers = [
      "رقم أمر العمل",
      "نوع الأمر",
      "التاريخ",
      "اسم العميل",
      "الهاتف",
      "رقم السيارة",
      "نوع السيارة",
      "نوع الصيانة",
      "الإيرادات",
      "تقديري قطع الغيار",
      "تقديري العمالة",
      "تكلفة قطع الغيار",
      "تكلفة العمالة",
      "مصروفات أخرى",
      "إجمالي التكلفة",
      "صافي الربح / الخسارة",
      "هامش الربح %",
      "مصدر التكلفة النهائي",
      "الحالة",
      "ملاحظات",
    ];
    const lines = rows.map((row) => [
      row.workOrderNumber,
      row.orderType,
      row.date,
      row.customerName,
      row.customerPhone,
      row.vehiclePlate,
      row.vehicleName,
      row.serviceType,
      row.revenueExVat.toFixed(3),
      row.estimatedSparePartsCost.toFixed(3),
      row.estimatedLabourCost.toFixed(3),
      row.sparePartsCost.toFixed(3),
      row.labourCost.toFixed(3),
      row.otherExpenses.toFixed(3),
      row.totalCost.toFixed(3),
      row.netProfit.toFixed(3),
      row.profitMargin == null ? "N/A" : row.profitMargin.toFixed(2),
      costSourceLabel(row.finalCostSource),
      row.status,
      row.notes,
    ].map(csvCell).join(","));
    const csv = "\uFEFF" + [headers.map(csvCell).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-orders-cost-profit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    try {
      toast({ title: "جاري إنشاء PDF..." });
      await exportLandscapePdf({
        title: "تقرير تكلفة وربحية أوامر العمل",
        subtitle: "Work Orders Cost & Profit Statement",
        rangeLabel: from || to ? `${from || "البداية"} → ${to || "اليوم"}` : "كل الفترات",
        kpis: [
          { label: "عدد أوامر العمل", value: String(totals.workOrdersCount), color: "primary" },
          { label: "إجمالي الإيرادات", value: formatOMR(totals.totalRevenueExVat), color: "success" },
          { label: "إجمالي التكلفة", value: formatOMR(totals.totalExpenses), color: "danger" },
          { label: "صافي الربح / الخسارة", value: formatOMR(totals.netProfit), color: totals.netProfit >= 0 ? "success" : "danger" },
        ],
        sections: [{
          title: "تفاصيل أوامر العمل",
          columns: [
            { key: "number", label: "رقم أمر العمل", align: "center", mono: true },
            { key: "date", label: "التاريخ", align: "center", mono: true },
            { key: "customer", label: "اسم العميل" },
            { key: "plate", label: "رقم السيارة", align: "center", mono: true },
            { key: "revenue", label: "الإيرادات", align: "center", mono: true },
            { key: "estimatedParts", label: "تقديري قطع", align: "center", mono: true },
            { key: "estimatedLabour", label: "تقديري عمالة", align: "center", mono: true },
            { key: "parts", label: "تكلفة قطع الغيار", align: "center", mono: true },
            { key: "labour", label: "تكلفة العمالة", align: "center", mono: true },
            { key: "other", label: "مصروفات أخرى", align: "center", mono: true },
            { key: "total", label: "إجمالي التكلفة", align: "center", mono: true },
            { key: "profit", label: "صافي الربح / الخسارة", align: "center", mono: true },
            { key: "margin", label: "هامش الربح %", align: "center", mono: true },
            { key: "source", label: "مصدر التكلفة النهائي", align: "center" },
          ],
          rows: rows.map((row) => ({
            number: row.workOrderNumber,
            date: row.date,
            customer: row.customerName,
            plate: row.vehiclePlate,
            revenue: row.revenueExVat.toFixed(3),
            estimatedParts: row.estimatedSparePartsCost.toFixed(3),
            estimatedLabour: row.estimatedLabourCost.toFixed(3),
            parts: row.sparePartsCost.toFixed(3),
            labour: row.labourCost.toFixed(3),
            other: row.otherExpenses.toFixed(3),
            total: row.totalCost.toFixed(3),
            profit: row.netProfit.toFixed(3),
            margin: row.profitMargin == null ? "N/A" : row.profitMargin.toFixed(2),
            source: costSourceLabel(row.finalCostSource),
          })),
        }],
      }, `work-orders-cost-profit-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: "تم تصدير PDF" });
    } catch (error: any) {
      toast({ title: "تعذر إنشاء PDF", description: error?.message || "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 print:space-y-2" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="text-primary" size={24} />
            تقرير تكلفة وربحية أوامر العمل
          </h1>
          <p className="text-xs text-muted-foreground">
            الأرقام من Accounting Core: الإيرادات من الفواتير المعتمدة، والتكلفة الفعلية من المصروفات/المشتريات/أجور العمل المسجلة فقط. التقديرات تظهر كمعلومة ولا تدخل في الربح.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportPdf} className="gap-1"><FileDown size={14} /> PDF</Button>
          <Button variant="outline" onClick={() => void printCurrentPageAsPdf("work-orders-statement")} className="gap-1"><Printer size={14} /> طباعة</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-1"><Download size={14} /> Excel / CSV</Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1"><ArrowRight size={14} /> رجوع</Button>
        </div>
      </div>

      <Card className="grid grid-cols-1 gap-3 p-3 md:grid-cols-4 print:hidden">
        <div>
          <label className="text-xs text-muted-foreground">من تاريخ</label>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">إلى تاريخ</label>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground">بحث</label>
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input className="pr-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="أمر عمل / عميل / لوحة / حالة" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi title="عدد أوامر العمل" value={String(totals.workOrdersCount)} />
        <Kpi title="إجمالي الإيرادات" value={formatOMR(totals.totalRevenueExVat)} tone="success" />
        <Kpi title="تكلفة قطع الغيار" value={formatOMR(totals.totalSparePartsCost)} tone="warning" />
        <Kpi title="تكلفة العمالة" value={formatOMR(totals.totalLabourCost)} tone="warning" />
        <Kpi title="مصروفات أخرى" value={formatOMR(totals.totalOtherExpenses)} tone="danger" />
        <Kpi title="إجمالي التكلفة" value={formatOMR(totals.totalExpenses)} tone="danger" />
        <Kpi title="صافي الربح / الخسارة" value={formatOMR(totals.netProfit)} tone={totals.netProfit >= 0 ? "success" : "danger"} />
        <Kpi title="متوسط هامش الربح" value={totals.averageProfitMargin == null ? "N/A" : `${totals.averageProfitMargin.toFixed(2)}%`} />
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1500px]">
          <TableHeader>
            <TableRow className="bg-primary/10">
              <TableHead className="text-center">رقم أمر العمل</TableHead>
              <TableHead className="text-center">نوع الأمر</TableHead>
              <TableHead className="text-center">التاريخ</TableHead>
              <TableHead className="text-right">اسم العميل</TableHead>
              <TableHead className="text-center">الهاتف</TableHead>
              <TableHead className="text-center">رقم السيارة</TableHead>
              <TableHead className="text-center">نوع السيارة</TableHead>
              <TableHead className="text-center">نوع الصيانة</TableHead>
              <TableHead className="text-center">الإيرادات</TableHead>
              <TableHead className="text-center">تقديري قطع</TableHead>
              <TableHead className="text-center">تقديري عمالة</TableHead>
              <TableHead className="text-center">تكلفة قطع الغيار</TableHead>
              <TableHead className="text-center">تكلفة العمالة</TableHead>
              <TableHead className="text-center">مصروفات أخرى</TableHead>
              <TableHead className="text-center">إجمالي التكلفة</TableHead>
              <TableHead className="text-center">صافي الربح / الخسارة</TableHead>
              <TableHead className="text-center">هامش الربح %</TableHead>
              <TableHead className="text-center">مصدر التكلفة النهائي</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="text-right">ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={20} className="py-10 text-center text-muted-foreground">لا توجد بيانات</TableCell>
              </TableRow>
            ) : rows.map((row) => (
              <ReportRow key={row.workOrderId} row={row} onOpen={() => navigate(`/work-orders/${row.workOrderNumber}`)} />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Kpi({ title, value, tone = "default" }: { title: string; value: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClass = {
    default: "",
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning",
    danger: "border-destructive/30 bg-destructive/5 text-destructive",
  }[tone];
  return (
    <Card className={`p-3 ${toneClass}`}>
      <p className="text-[10px] text-muted-foreground">{title}</p>
      <p className="mt-1 font-mono text-base font-bold">{value}</p>
    </Card>
  );
}

function ReportRow({ row, onOpen }: { row: WorkOrderAccountingRow; onOpen: () => void }) {
  return (
    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onOpen}>
      <TableCell className="text-center font-mono text-xs font-bold text-primary">{row.workOrderNumber}</TableCell>
      <TableCell className="text-center text-xs">{row.orderType}</TableCell>
      <TableCell className="text-center font-mono text-xs">{row.date}</TableCell>
      <TableCell className="text-xs font-medium">{row.customerName}</TableCell>
      <TableCell className="text-center font-mono text-xs">{row.customerPhone}</TableCell>
      <TableCell className="text-center font-mono text-xs font-bold">{row.vehiclePlate}</TableCell>
      <TableCell className="text-center text-xs">{row.vehicleName}</TableCell>
      <TableCell className="text-center text-xs">{row.serviceType}</TableCell>
      <MoneyCell value={row.revenueExVat} tone="success" />
      <MoneyCell value={row.estimatedSparePartsCost} />
      <MoneyCell value={row.estimatedLabourCost} />
      <MoneyCell value={row.sparePartsCost} />
      <MoneyCell value={row.labourCost} />
      <MoneyCell value={row.otherExpenses} />
      <MoneyCell value={row.totalCost} tone="danger" />
      <MoneyCell value={row.netProfit} tone={row.netProfit >= 0 ? "success" : "danger"} />
      <TableCell className="text-center font-mono text-xs">{row.profitMargin == null ? "N/A" : `${row.profitMargin.toFixed(2)}%`}</TableCell>
      <TableCell className="text-center text-xs">{costSourceLabel(row.finalCostSource)}</TableCell>
      <TableCell className="text-center text-xs">{row.status}</TableCell>
      <TableCell className="max-w-[220px] truncate text-xs">{row.notes || "—"}</TableCell>
    </TableRow>
  );
}

function MoneyCell({ value, tone = "default" }: { value: number; tone?: "default" | "success" | "danger" }) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : "text-foreground";
  return <TableCell className={`text-center font-mono text-xs ${color}`}>{value.toFixed(3)}</TableCell>;
}
