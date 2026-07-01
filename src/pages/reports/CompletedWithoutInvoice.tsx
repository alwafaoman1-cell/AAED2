import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Download, FileWarning, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildWorkOrderAccountingRows, formatOMR } from "@/lib/accounting/core";
import { getWorkOrderById } from "@/lib/workOrdersStore";
import { smartBack } from "@/lib/smartBack";
import { isInsuranceWorkOrder } from "@/lib/workOrderType";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function isCompletedStatus(status: string) {
  const value = String(status || "").toLowerCase();
  return [
    "ready",
    "completed",
    "delivered",
    "closed",
    "جاهز",
    "مكتمل",
    "تم التسليم",
    "مغلق",
  ].some((token) => value.includes(token));
}

export default function CompletedWithoutInvoice() {
  const navigate = useNavigate();

  const rows = useMemo(() => {
    return buildWorkOrderAccountingRows()
      .filter((row) => isCompletedStatus(row.status) && !row.hasInvoice)
      .map((row) => {
        const order = getWorkOrderById(row.workOrderNumber);
        const insuranceOrder = order ? isInsuranceWorkOrder(order) : String(row.orderType || "").toLowerCase().includes("insurance");
        return {
          ...row,
          order,
          insuranceOrder,
          financialWorkflow: insuranceOrder ? "Delivered - Waiting LPO / Insurance Invoice" : "Cash invoice required",
          skipReason: order?.closingReview?.skipInvoiceReason || "",
          closedByRole: order?.closingReview?.approvedByRole || "",
        };
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, []);

  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenueExVat || 0), 0);
  const totalProfit = rows.reduce((sum, row) => sum + Number(row.netProfit || 0), 0);

  const exportCsv = () => {
    const headers = ["Work Order", "Date", "Customer", "Vehicle", "Status", "Workflow", "Revenue", "Net Profit", "Skip Reason"];
    const lines = rows.map((row) => [
      row.workOrderNumber,
      row.date,
      row.customerName,
      row.vehiclePlate,
      row.status,
      row.financialWorkflow,
      row.revenueExVat,
      row.netProfit,
      row.skipReason,
    ].map(csvCell).join(","));
    const blob = new Blob(["\ufeff" + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "completed-work-orders-without-invoice.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="gap-1 mb-2" onClick={() => smartBack(navigate, "/reports")}>
            <ArrowRight size={16} /> رجوع
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileWarning className="text-warning" /> أوامر مكتملة بدون فاتورة
          </h1>
          <p className="text-sm text-muted-foreground">
            يوضح أوامر العمل التي وصلت إلى حالة إغلاق أو تسليم ولم يتم ربطها بفاتورة.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportCsv}>
          <Download size={16} /> تصدير CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">عدد الأوامر</p>
          <p className="text-2xl font-bold">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">إيرادات غير مفوترة</p>
          <p className="text-2xl font-bold">{formatOMR(totalRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">صافي ربح مرتبط</p>
          <p className="text-2xl font-bold">{formatOMR(totalProfit)}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>أمر العمل</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>المركبة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>المسار المالي</TableHead>
              <TableHead>الإيراد</TableHead>
              <TableHead>قرار التجاوز</TableHead>
              <TableHead>إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.workOrderNumber}>
                <TableCell className="font-mono">{row.workOrderNumber}</TableCell>
                <TableCell dir="ltr">{row.date}</TableCell>
                <TableCell>{row.customerName}</TableCell>
                <TableCell>{row.vehiclePlate || row.vehicleName}</TableCell>
                <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                <TableCell>
                  <Badge variant={row.insuranceOrder ? "secondary" : "outline"}>{row.financialWorkflow}</Badge>
                </TableCell>
                <TableCell>{formatOMR(row.revenueExVat)}</TableCell>
                <TableCell className="max-w-[220px] truncate">{row.skipReason || "لا يوجد"}</TableCell>
                <TableCell>
                  {row.insuranceOrder ? (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate(row.order?.claimId ? `/insurance/${row.order.claimId}` : "/insurance/claims")}>
                      <PlusCircle size={14} /> فتح المطالبة / LPO
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1" onClick={() => navigate(`/sales/invoices/new?fromWorkOrder=${encodeURIComponent(row.workOrderNumber)}`)}>
                      <PlusCircle size={14} /> إنشاء فاتورة
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  لا توجد أوامر مكتملة بدون فاتورة حالياً.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
