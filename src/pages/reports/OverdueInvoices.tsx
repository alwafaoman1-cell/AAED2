import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BellRing, Download, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { smartBack } from "@/lib/smartBack";
import {
  buildOverdueInvoices,
  buildPaymentReminderMessage,
  DEFAULT_ACCOUNTING_REMINDER_SETTINGS,
  queuePaymentReminder,
  type OverdueInvoiceRow,
} from "@/lib/accounting/reminders";
import { formatOMR } from "@/lib/accounting/core";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function OverdueInvoices() {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => buildOverdueInvoices(DEFAULT_ACCOUNTING_REMINDER_SETTINGS), []);
  const totalDue = rows.reduce((sum, row) => sum + row.balanceDue, 0);
  const oldest = rows.reduce((max, row) => Math.max(max, row.daysOverdue), 0);

  const exportCsv = () => {
    const headers = ["Invoice", "Customer", "Phone", "Due Date", "Days Overdue", "Balance Due", "Status"];
    const lines = rows.map((row) => [
      row.invoice.number || row.invoice.id,
      row.customerName,
      row.customerPhone,
      row.dueDate,
      row.daysOverdue,
      row.balanceDue,
      row.invoice.status,
    ].map(csvCell).join(","));
    const blob = new Blob(["\ufeff" + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "overdue-invoices.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openReminderCenter = (row: OverdueInvoiceRow) => {
    const message = buildPaymentReminderMessage(row);
    navigate(`/messages?compose=payment_reminder&invoiceId=${encodeURIComponent(row.invoice.id)}&message=${encodeURIComponent(message)}`);
  };

  const logReminder = async (row: OverdueInvoiceRow) => {
    setBusyId(row.invoice.id);
    try {
      const result = await queuePaymentReminder(row, DEFAULT_ACCOUNTING_REMINDER_SETTINGS);
      if (result.blocked) {
        toast.error(result.message);
        return;
      }
      if (!result.ok) {
        toast.error(result.message || "تعذر تسجيل التذكير، سيتم فتح مركز الرسائل للمراجعة.");
      } else {
        toast.success(result.message);
      }
      openReminderCenter(row);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="gap-1 mb-2" onClick={() => smartBack(navigate, "/reports")}>
            <ArrowRight size={16} /> رجوع
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BellRing className="text-warning" /> الفواتير المتأخرة
          </h1>
          <p className="text-sm text-muted-foreground">
            يعتمد التقرير على إعدادات تذكير المحاسبة، ويمنع تكرار تذكير الدفع خلال 24 ساعة.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportCsv}>
          <Download size={16} /> تصدير CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">عدد الفواتير المتأخرة</p>
          <p className="text-2xl font-bold">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">إجمالي المتبقي</p>
          <p className="text-2xl font-bold">{formatOMR(totalDue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">أقدم تأخير</p>
          <p className="text-2xl font-bold">{oldest} يوم</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الفاتورة</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الهاتف</TableHead>
              <TableHead>تاريخ الاستحقاق</TableHead>
              <TableHead>التأخير</TableHead>
              <TableHead>المتبقي</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.invoice.id}>
                <TableCell className="font-mono">{row.invoice.number || row.invoice.id}</TableCell>
                <TableCell>{row.customerName}</TableCell>
                <TableCell dir="ltr">{row.customerPhone || "—"}</TableCell>
                <TableCell dir="ltr">{row.dueDate}</TableCell>
                <TableCell><Badge variant="destructive">{row.daysOverdue} يوم</Badge></TableCell>
                <TableCell>{formatOMR(row.balanceDue)}</TableCell>
                <TableCell><Badge variant="outline">{row.invoice.status}</Badge></TableCell>
                <TableCell>
                  <Button size="sm" className="gap-1" disabled={busyId === row.invoice.id} onClick={() => logReminder(row)}>
                    <MessageCircle size={14} /> تذكير دفع
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  لا توجد فواتير متأخرة حالياً.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
