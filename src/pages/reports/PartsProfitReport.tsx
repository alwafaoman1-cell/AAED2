import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Printer, Download, Search, TrendingUp, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  expensesStore,
  getExpensePartProfit,
  getExpensePartRevenue,
} from "@/lib/expensesStore";
import { exportLandscapePdf } from "@/lib/landscapePdf";
import { toast } from "@/hooks/use-toast";

export default function PartsProfitReport() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [, force] = useState(0);

  const all = expensesStore.getAll();

  const rows = useMemo(() => {
    return all
      .filter((e) => !!e.partName)
      .filter((e) => (from ? e.date >= from : true))
      .filter((e) => (to ? e.date <= to : true))
      .filter((e) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return [e.partName, e.partNumber, e.linkedVehiclePlate, e.linkedVehicleName, e.beneficiary]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [all, from, to, search]);

  const totals = useMemo(() => {
    let cost = 0, rev = 0, profit = 0, qty = 0;
    rows.forEach((r) => {
      cost += (r.unitBuyPrice ?? 0) * (r.partQty ?? 0);
      rev += getExpensePartRevenue(r);
      profit += getExpensePartProfit(r);
      qty += r.partQty ?? 0;
    });
    return { cost, rev, profit, qty };
  }, [rows]);

  const exportCsv = () => {
    const header = ["التاريخ", "السند", "السيارة", "اسم القطعة", "رقم القطعة", "كمية", "سعر شراء", "سعر بيع", "إجمالي شراء", "إجمالي بيع", "الربح"];
    const lines = rows.map((r) => {
      const buy = r.unitBuyPrice ?? 0, sell = r.unitSellPrice ?? 0, q = r.partQty ?? 0;
      return [
        r.date, r.voucherNumber,
        r.linkedVehiclePlate || r.linkedVehicleName || "",
        r.partName || "", r.partNumber || "",
        q, buy, sell, buy * q, sell * q, getExpensePartProfit(r),
      ].join(",");
    });
    const csv = "\uFEFF" + [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `parts-profit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    try {
      toast({ title: "جاري إنشاء PDF…" });
      await exportLandscapePdf({
        title: "تقرير ربح قطع الغيار التفصيلي",
        subtitle: `إجمالي ${rows.length} حركة قطعة غيار`,
        rangeLabel: from || to ? `${from || "البداية"} → ${to || "اليوم"}` : "كل الفترات",
        kpis: [
          { label: "عدد القطع", value: String(rows.length), color: "primary" },
          { label: "إجمالي الكميات", value: String(totals.qty), color: "info" },
          { label: "إجمالي الشراء", value: `${totals.cost.toLocaleString()} ر.ع`, color: "danger" },
          { label: "إجمالي البيع", value: `${totals.rev.toLocaleString()} ر.ع`, color: "success" },
          { label: "صافي الربح", value: `${totals.profit.toLocaleString()} ر.ع`, color: totals.profit >= 0 ? "primary" : "danger" },
        ],
        sections: [{
          title: "تفاصيل قطع الغيار — سعر الشراء، سعر البيع، الربح",
          columns: [
            { key: "date", label: "التاريخ", align: "center", mono: true, width: "8%" },
            { key: "voucher", label: "السند", align: "center", mono: true, width: "9%" },
            { key: "vehicle", label: "السيارة / العميل", width: "12%" },
            { key: "partName", label: "اسم القطعة", width: "16%" },
            { key: "partNumber", label: "رقم القطعة", mono: true, width: "10%" },
            { key: "qty", label: "كمية", align: "center", width: "5%" },
            { key: "buy", label: "سعر الشراء", align: "center", mono: true, color: "danger" },
            { key: "sell", label: "سعر البيع", align: "center", mono: true, color: "success" },
            { key: "totalBuy", label: "إجمالي شراء", align: "center", mono: true, color: "danger" },
            { key: "totalSell", label: "إجمالي بيع", align: "center", mono: true, color: "success" },
            { key: "profit", label: "الربح", align: "center", mono: true, color: "primary" },
          ],
          rows: rows.map((r) => {
            const buy = r.unitBuyPrice ?? 0, sell = r.unitSellPrice ?? 0, q = r.partQty ?? 0;
            return {
              date: r.date,
              voucher: r.voucherNumber,
              vehicle: r.linkedVehiclePlate || r.linkedVehicleName || "—",
              partName: r.partName || "—",
              partNumber: r.partNumber || "—",
              qty: q,
              buy: buy.toLocaleString(),
              sell: sell ? sell.toLocaleString() : "—",
              totalBuy: (buy * q).toLocaleString(),
              totalSell: sell ? (sell * q).toLocaleString() : "—",
              profit: sell ? getExpensePartProfit(r).toLocaleString() : "—",
            };
          }),
          totals: {
            date: "", voucher: "", vehicle: "", partName: "الإجمالي", partNumber: "",
            qty: totals.qty,
            buy: "", sell: "",
            totalBuy: totals.cost.toLocaleString(),
            totalSell: totals.rev.toLocaleString(),
            profit: totals.profit.toLocaleString(),
          },
        }],
        footerNote: "ملاحظة: سعر الشراء يُجلب تلقائياً من فاتورة المورد، وسعر البيع يُسجَّل عند إنشاء أمر الشغل.",
      }, `parts-profit-${new Date().toISOString().slice(0,10)}.pdf`);
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
            <TrendingUp className="text-success" size={24} />
            تقرير ربح قطع الغيار
          </h1>
          <p className="text-xs text-muted-foreground">سعر الشراء والبيع والربح لكل قطعة</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={exportPdf} className="gap-1 bg-destructive hover:bg-destructive/90"><FileDown size={14} /> PDF أفقي تفصيلي</Button>
          <Button variant="outline" onClick={() => window.print()} className="gap-1"><Printer size={14} /> طباعة</Button>
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
            <Input className="pr-8" placeholder="اسم القطعة / رقم القطعة / لوحة السيارة" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><p className="text-[10px] text-muted-foreground">عدد القطع</p><p className="text-lg font-bold">{rows.length}</p></Card>
        <Card className="p-3 bg-destructive/5 border-destructive/30"><p className="text-[10px] text-muted-foreground">إجمالي الشراء</p><p className="text-lg font-bold text-destructive font-mono">{totals.cost.toLocaleString()} ر.ع</p></Card>
        <Card className="p-3 bg-success/5 border-success/30"><p className="text-[10px] text-muted-foreground">إجمالي البيع</p><p className="text-lg font-bold text-success font-mono">{totals.rev.toLocaleString()} ر.ع</p></Card>
        <Card className={`p-3 ${totals.profit >= 0 ? "bg-primary/5 border-primary/30" : "bg-destructive/10 border-destructive/40"}`}>
          <p className="text-[10px] text-muted-foreground">صافي الربح</p>
          <p className={`text-lg font-bold font-mono ${totals.profit >= 0 ? "text-primary" : "text-destructive"}`}>{totals.profit.toLocaleString()} ر.ع</p>
        </Card>
      </div>

      {/* الجدول */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-right">التاريخ</TableHead>
              <TableHead className="text-right">السند</TableHead>
              <TableHead className="text-right">السيارة / العميل</TableHead>
              <TableHead className="text-right">اسم القطعة</TableHead>
              <TableHead className="text-right">رقم القطعة</TableHead>
              <TableHead className="text-center">كمية</TableHead>
              <TableHead className="text-center">سعر الشراء</TableHead>
              <TableHead className="text-center">سعر البيع</TableHead>
              <TableHead className="text-center">إجمالي الشراء</TableHead>
              <TableHead className="text-center">إجمالي البيع</TableHead>
              <TableHead className="text-center">الربح</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">لا توجد بيانات</TableCell></TableRow>
            ) : rows.map((r) => {
              const buy = r.unitBuyPrice ?? 0, sell = r.unitSellPrice ?? 0, q = r.partQty ?? 0;
              const lineCost = buy * q, lineRev = sell * q, lineProfit = lineRev - lineCost;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.date}</TableCell>
                  <TableCell className="font-mono text-xs">{r.voucherNumber}</TableCell>
                  <TableCell className="text-xs">{r.linkedVehiclePlate || "—"}<br /><span className="text-muted-foreground">{r.linkedVehicleName?.split("—")[0]}</span></TableCell>
                  <TableCell className="text-xs font-medium">{r.partName}</TableCell>
                  <TableCell className="text-xs font-mono">{r.partNumber || "—"}</TableCell>
                  <TableCell className="text-center text-xs">{q}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-destructive">{buy.toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-success">{sell ? sell.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-destructive">{lineCost.toLocaleString()}</TableCell>
                  <TableCell className="text-center font-mono text-xs text-success">{sell ? lineRev.toLocaleString() : "—"}</TableCell>
                  <TableCell className={`text-center font-mono text-xs font-bold ${lineProfit >= 0 ? "text-success" : "text-destructive"}`}>
                    {sell ? lineProfit.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/60 font-bold">
                <td colSpan={5} className="px-3 py-2 text-right">الإجمالي</td>
                <td className="text-center text-xs">{totals.qty}</td>
                <td colSpan={2}></td>
                <td className="text-center font-mono text-xs text-destructive">{totals.cost.toLocaleString()}</td>
                <td className="text-center font-mono text-xs text-success">{totals.rev.toLocaleString()}</td>
                <td className={`text-center font-mono text-xs ${totals.profit >= 0 ? "text-success" : "text-destructive"}`}>{totals.profit.toLocaleString()}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  );
}
