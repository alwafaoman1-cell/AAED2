import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { printCurrentPageAsPdf } from "@/lib/safePdfWindow";
import { ArrowRight, Printer, Download, Search, ClipboardList, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { getExpensesForWorkOrder, getExpensePartProfit } from "@/lib/expensesStore";
import { exportLandscapePdf } from "@/lib/landscapePdf";
import { toast } from "@/hooks/use-toast";
import { resolveWorkOrderType, workOrderTypeLabel } from "@/lib/workOrderType";

/** كشف حساب أوامر الشغل المفصل — يحاكي الجدول التقليدي:
 * رقم البطاقة | التاريخ | اسم العميل | الهاتف | رقم السيارة | نوع السيارة |
 * نوع الصيانة (ميكانيكا/كهرباء/سمكرة/صبغ) | تكلفة السيارة كامل | أجر العمل |
 * أجر الزبون | الربح/الخسارة | ملاحظات
 */
export default function WorkOrdersStatement() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const orders = getWorkOrders();

  const rows = useMemo(() => {
    return orders
      .filter((o) => (from ? o.entryDate >= from : true))
      .filter((o) => (to ? o.entryDate <= to : true))
      .filter((o) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return [o.id, o.customer, o.phone, o.plate, o.vehicleType, o.serviceType]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
      .map((o) => {
        const exps = getExpensesForWorkOrder(o.id);
        const partsCost = exps.filter((e) => e.partName).reduce((s, e) => s + e.amount, 0);
        const otherCost = exps.filter((e) => !e.partName).reduce((s, e) => s + e.amount, 0);
        const totalCost = partsCost + otherCost + (o.partsCost || 0); // كل التكاليف
        const labor = o.laborCost || 0;
        const customerCharge = o.totalCost || 0; // ما يدفعه الزبون
        // ربح القطع: من سعر البيع - الشراء
        const partsProfit = exps.reduce((s, e) => s + getExpensePartProfit(e), 0);
        const profit = customerCharge - totalCost + partsProfit;
        // تصنيف نوع الصيانة
        const svc = (o.serviceType || "").toLowerCase();
        const flags = {
          mech: /ميكان|mech/.test(svc),
          elec: /كهرب|elec/.test(svc),
          body: /سمكر|body/.test(svc),
          paint: /صبغ|دهان|paint/.test(svc),
        };
        return { o, totalCost, labor, customerCharge, profit, flags, partsCost };
      });
  }, [orders, from, to, search]);

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        cost: a.cost + r.totalCost,
        labor: a.labor + r.labor,
        charge: a.charge + r.customerCharge,
        profit: a.profit + r.profit,
        partsCost: a.partsCost + r.partsCost,
      }),
      { cost: 0, labor: 0, charge: 0, profit: 0, partsCost: 0 },
    );
  }, [rows]);

  const exportCsv = () => {
    const header = ["#", "رقم البطاقة", "نوع الأمر", "التاريخ", "العميل", "الهاتف", "رقم السيارة", "نوع السيارة", "نوع الصيانة", "تكلفة كاملة", "أجر العمل", "أجر الزبون", "الربح", "ملاحظات"];
    const lines = rows.map((r, i) => [
      i + 1, r.o.id, workOrderTypeLabel(resolveWorkOrderType(r.o), true), r.o.entryDate, r.o.customer, r.o.phone, r.o.plate, r.o.vehicleType,
      r.o.serviceType, r.totalCost, r.labor, r.customerCharge, r.profit,
      (r.o.description || "").replace(/[,\n]/g, " "),
    ].join(","));
    const csv = "\uFEFF" + [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `work-orders-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    try {
      toast({ title: "جاري إنشاء PDF…" });
      const svc = (s: string) => {
        const o = (s || "").toLowerCase();
        const tags: string[] = [];
        if (/ميكان|mech/.test(o)) tags.push("ميكا");
        if (/كهرب|elec/.test(o)) tags.push("كهرب");
        if (/سمكر|body/.test(o)) tags.push("سمكرة");
        if (/صبغ|دهان|paint/.test(o)) tags.push("صبغ");
        return tags.length ? tags.join("/") : (s || "—");
      };
      await exportLandscapePdf({
        title: "كشف حساب أوامر الشغل والصيانة",
        subtitle: `إجمالي ${rows.length} أمر شغل`,
        rangeLabel: from || to ? `${from || "البداية"} → ${to || "اليوم"}` : "كل الفترات",
        kpis: [
          { label: "عدد البطاقات", value: String(rows.length), color: "primary" },
          { label: "تكلفة كاملة", value: totals.cost.toLocaleString(), color: "danger" },
          { label: "إجمالي العمالة", value: totals.labor.toLocaleString(), color: "warning" },
          { label: "إجمالي أجر الزبون", value: totals.charge.toLocaleString(), color: "info" },
          { label: "صافي الربح", value: totals.profit.toLocaleString(), color: totals.profit >= 0 ? "success" : "danger" },
        ],
        sections: [{
          title: "تفاصيل أوامر الشغل",
          columns: [
            { key: "n", label: "م", align: "center", width: "3%" },
            { key: "id", label: "رقم البطاقة", align: "center", mono: true, color: "primary" },
            { key: "type", label: "نوع الأمر", align: "center" },
            { key: "date", label: "التاريخ", align: "center", mono: true },
            { key: "customer", label: "العميل" },
            { key: "phone", label: "الهاتف", align: "center", mono: true },
            { key: "plate", label: "اللوحة", align: "center", mono: true },
            { key: "vehicle", label: "السيارة" },
            { key: "service", label: "نوع الصيانة", align: "center" },
            { key: "cost", label: "تكلفة كاملة", align: "center", mono: true, color: "danger" },
            { key: "labor", label: "أجر العمل", align: "center", mono: true, color: "warning" },
            { key: "charge", label: "أجر الزبون", align: "center", mono: true, color: "info" },
            { key: "profit", label: "الربح/الخسارة", align: "center", mono: true,
              format: (v) => Number(v).toLocaleString(),
              color: "success" },
            { key: "notes", label: "ملاحظات" },
          ],
          rows: rows.map((r, i) => ({
            n: i + 1,
            id: r.o.id,
            type: workOrderTypeLabel(resolveWorkOrderType(r.o), true),
            date: r.o.entryDate,
            customer: r.o.customer,
            phone: r.o.phone || "—",
            plate: r.o.plate,
            vehicle: `${r.o.vehicleType || ""} ${r.o.model || ""}`.trim() || "—",
            service: svc(r.o.serviceType),
            cost: r.totalCost.toLocaleString(),
            labor: r.labor.toLocaleString(),
            charge: r.customerCharge.toLocaleString(),
            profit: r.profit,
            notes: (r.o.description || "—").slice(0, 60),
          })),
          totals: {
            n: "", id: "", type: "", date: "", customer: "الإجمالي", phone: "", plate: "", vehicle: "", service: "",
            cost: totals.cost.toLocaleString(),
            labor: totals.labor.toLocaleString(),
            charge: totals.charge.toLocaleString(),
            profit: totals.profit,
            notes: "",
          },
        }],
      }, `work-orders-statement-${new Date().toISOString().slice(0,10)}.pdf`);
      toast({ title: "تم التصدير بنجاح ✓" });
    } catch (e: any) {
      toast({ title: "فشل التصدير", description: e?.message || "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 print:space-y-2" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="text-primary" size={24} />
            كشف حساب أوامر الشغل والصيانة
          </h1>
          <p className="text-xs text-muted-foreground">سجل تفصيلي لكل أمر عمل: التكاليف، الأجور، الربح والملاحظات</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={exportPdf} className="gap-1 bg-destructive hover:bg-destructive/90"><FileDown size={14} /> PDF أفقي تفصيلي</Button>
          <Button variant="outline" onClick={() => void printCurrentPageAsPdf("work-orders-statement")} className="gap-1"><Printer size={14} /> طباعة PDF</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-1"><Download size={14} /> Excel</Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1"><ArrowRight size={14} /> رجوع</Button>
        </div>
      </div>

      {/* فلترة */}
      <Card className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3 print:hidden">
        <div>
          <label className="text-xs text-muted-foreground">من تاريخ</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">إلى تاريخ</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground">بحث</label>
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input className="pr-8" placeholder="بطاقة / عميل / لوحة / نوع" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><p className="text-[10px] text-muted-foreground">عدد البطاقات</p><p className="text-lg font-bold">{rows.length}</p></Card>
        <Card className="p-3 bg-destructive/5 border-destructive/30"><p className="text-[10px] text-muted-foreground">تكلفة كاملة</p><p className="text-lg font-bold text-destructive font-mono">{totals.cost.toLocaleString()}</p></Card>
        <Card className="p-3 bg-warning/5 border-warning/30"><p className="text-[10px] text-muted-foreground">إجمالي العمالة</p><p className="text-lg font-bold text-warning font-mono">{totals.labor.toLocaleString()}</p></Card>
        <Card className="p-3 bg-info/5 border-info/30"><p className="text-[10px] text-muted-foreground">إجمالي أجر الزبون</p><p className="text-lg font-bold text-info font-mono">{totals.charge.toLocaleString()}</p></Card>
        <Card className={`p-3 ${totals.profit >= 0 ? "bg-success/5 border-success/30" : "bg-destructive/10 border-destructive/40"}`}>
          <p className="text-[10px] text-muted-foreground">صافي الربح</p>
          <p className={`text-lg font-bold font-mono ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{totals.profit.toLocaleString()}</p>
        </Card>
      </div>

      {/* الجدول الرئيسي */}
      <Card className="overflow-x-auto">
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow className="bg-primary/10">
              <TableHead className="text-center">رقم البطاقة</TableHead>
              <TableHead className="text-center">نوع الأمر</TableHead>
              <TableHead className="text-center">التاريخ</TableHead>
              <TableHead className="text-right">اسم العميل</TableHead>
              <TableHead className="text-center">الهاتف</TableHead>
              <TableHead className="text-center">رقم السيارة</TableHead>
              <TableHead className="text-center">نوع السيارة</TableHead>
              <TableHead className="text-center">نوع الصيانة</TableHead>
              <TableHead className="text-center">تكلفة كاملة</TableHead>
              <TableHead className="text-center">أجر العمل</TableHead>
              <TableHead className="text-center">أجر الزبون</TableHead>
              <TableHead className="text-center">الربح/الخسارة</TableHead>
              <TableHead className="text-right">ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-10">لا توجد بيانات</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.o.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/work-orders/${r.o.id}`)}>
                <TableCell className="text-center font-mono font-bold text-primary text-xs">{r.o.id}</TableCell>
                <TableCell className="text-center text-[10px] font-semibold">{workOrderTypeLabel(resolveWorkOrderType(r.o), true)}</TableCell>
                <TableCell className="text-center font-mono text-xs">{r.o.entryDate}</TableCell>
                <TableCell className="text-xs font-medium">{r.o.customer}</TableCell>
                <TableCell className="text-center font-mono text-xs">{r.o.phone || "—"}</TableCell>
                <TableCell className="text-center font-mono text-xs font-bold">{r.o.plate}</TableCell>
                <TableCell className="text-center text-xs">{r.o.vehicleType} {r.o.model}</TableCell>
                <TableCell className="text-center text-xs">
                  <div className="flex flex-wrap gap-1 justify-center">
                    {r.flags.mech && <Badge variant="outline" className="text-[9px] py-0">ميكا</Badge>}
                    {r.flags.elec && <Badge variant="outline" className="text-[9px] py-0">كهرب</Badge>}
                    {r.flags.body && <Badge variant="outline" className="text-[9px] py-0">سمكرة</Badge>}
                    {r.flags.paint && <Badge variant="outline" className="text-[9px] py-0">صبغ</Badge>}
                    {!r.flags.mech && !r.flags.elec && !r.flags.body && !r.flags.paint && (
                      <span className="text-muted-foreground text-[10px]">{r.o.serviceType || "—"}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center font-mono text-xs text-destructive">{r.totalCost.toLocaleString()}</TableCell>
                <TableCell className="text-center font-mono text-xs text-warning">{r.labor.toLocaleString()}</TableCell>
                <TableCell className="text-center font-mono text-xs text-info font-bold">{r.customerCharge.toLocaleString()}</TableCell>
                <TableCell className={`text-center font-mono text-xs font-bold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>
                  {r.profit.toLocaleString()}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={r.o.description}>{r.o.description || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-primary/15 font-bold">
                <td colSpan={8} className="px-3 py-2 text-right">الإجمالي</td>
                <td className="text-center font-mono text-xs text-destructive">{totals.cost.toLocaleString()}</td>
                <td className="text-center font-mono text-xs text-warning">{totals.labor.toLocaleString()}</td>
                <td className="text-center font-mono text-xs text-info">{totals.charge.toLocaleString()}</td>
                <td className={`text-center font-mono text-xs ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{totals.profit.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center print:block hidden">
        كشف حساب أوامر الشغل والصيانة — تم الإصدار: {new Date().toLocaleString("en-GB")}
      </p>
    </div>
  );
}
