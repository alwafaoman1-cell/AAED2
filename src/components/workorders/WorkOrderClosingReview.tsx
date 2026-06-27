import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FilePlus2, Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCurrentRole } from "@/lib/permissions";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { buildWorkOrderAccountingRows, formatOMR, type AccountingCostSource } from "@/lib/accounting/core";
import { logActivity } from "@/lib/auditLogStore";

export const CLOSING_STATUSES = ["جاهز للتسليم", "تم التسليم", "مغلق", "Ready", "Completed", "Delivered", "Closed"];

export function isClosingStatus(status?: string) {
  return CLOSING_STATUSES.some((item) => String(status || "").toLowerCase().includes(item.toLowerCase()));
}

interface Props {
  order: WorkOrder;
  targetStatus: string;
  onCancel: () => void;
  onConfirm: (review: NonNullable<WorkOrder["closingReview"]>) => void;
}

export default function WorkOrderClosingReview({ order, targetStatus, onCancel, onConfirm }: Props) {
  const navigate = useNavigate();
  const role = getCurrentRole();
  const canApproveSkip = ["admin", "owner"].includes(role);
  const row = useMemo(() => (
    buildWorkOrderAccountingRows().find((item) => item.workOrderNumber === order.id || item.workOrderId === order.cloudId || item.workOrderNumber === order.displayNumber)
  ), [order.id, order.cloudId, order.displayNumber]);

  const hasActualExpenses = !!row && (row.actualSparePartsCost > 0 || row.actualLabourCost > 0 || row.otherExpenses > 0);
  const [source, setSource] = useState<AccountingCostSource>(hasActualExpenses ? "Actual Expenses" : "Estimated Costs");
  const [manualSpare, setManualSpare] = useState(row?.sparePartsCost || 0);
  const [manualLabour, setManualLabour] = useState(row?.labourCost || 0);
  const [manualOther, setManualOther] = useState(row?.otherExpenses || 0);
  const [manualReason, setManualReason] = useState("");
  const [skipInvoice, setSkipInvoice] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const manualTotal = Number(manualSpare || 0) + Number(manualLabour || 0) + Number(manualOther || 0);
  const revenue = row?.revenueExVat || 0;
  const finalTotal = source === "Manual Final Cost" ? manualTotal : row?.totalCost || 0;
  const netProfit = revenue - finalTotal;
  const hasInvoice = !!row?.hasInvoice;
  const hasPayments = !!row && row.paidAmount > 0;

  const confirm = () => {
    if (!row) return;
    if (!source) return;
    if (source === "Manual Final Cost" && !manualReason.trim()) return;
    if (!hasInvoice && !skipInvoice) return;
    if (!hasInvoice && skipInvoice && (!canApproveSkip || !skipReason.trim())) return;

    const snapshot = {
      workOrderNumber: row.workOrderNumber,
      targetStatus,
      revenueExVat: revenue,
      vatOutput: row.vatOutput,
      invoiceTotal: row.invoiceTotal,
      paidAmount: row.paidAmount,
      outstandingAmount: row.outstandingAmount,
      estimatedSparePartsCost: row.estimatedSparePartsCost,
      actualSparePartsCost: row.actualSparePartsCost,
      estimatedLabourCost: row.estimatedLabourCost,
      actualLabourCost: row.actualLabourCost,
      otherExpenses: row.otherExpenses,
      finalSparePartsCost: source === "Manual Final Cost" ? Number(manualSpare || 0) : row.sparePartsCost,
      finalLabourCost: source === "Manual Final Cost" ? Number(manualLabour || 0) : row.labourCost,
      finalOtherCost: source === "Manual Final Cost" ? Number(manualOther || 0) : row.otherExpenses,
      totalCost: finalTotal,
      netProfit,
      hasInvoice,
      hasPayments,
    };

    logActivity({
      action: "status_change",
      entity: "work_order",
      entityId: order.id,
      label: order.id,
      description: `Work Order Closing Review: ${targetStatus}`,
      amount: finalTotal,
      metadata: {
        finalCostSource: source,
        invoiceSkipped: !hasInvoice && skipInvoice,
        skipInvoiceReason: skipReason || undefined,
        manualReason: manualReason || undefined,
        snapshot,
      },
    });

    onConfirm({
      status: targetStatus,
      finalCostSource: source,
      snapshot,
      invoiceSkipped: !hasInvoice && skipInvoice,
      skipInvoiceReason: skipInvoice ? skipReason.trim() : undefined,
      manualReason: source === "Manual Final Cost" ? manualReason.trim() : undefined,
      approvedByRole: role,
      approvedAt: new Date().toISOString(),
    });
  };

  if (!row) {
    return (
      <Card className="space-y-3 border-destructive/40 bg-destructive/5 p-4">
        <p className="font-semibold text-destructive">Permission Denied / تعذر فتح المراجعة</p>
        <p className="text-sm text-muted-foreground">لم يتم العثور على أرقام Accounting Core لهذا الأمر.</p>
        <Button variant="outline" onClick={onCancel}>رجوع</Button>
      </Card>
    );
  }

  const canConfirm =
    !!source &&
    (source !== "Manual Final Cost" || !!manualReason.trim()) &&
    (hasInvoice || (skipInvoice && canApproveSkip && !!skipReason.trim()));

  return (
    <Card className="space-y-4 border-primary/30 bg-primary/5 p-4">
      <div>
        <h3 className="text-base font-bold">Work Order Closing Review</h3>
        <p className="text-xs text-muted-foreground">مراجعة مالية إلزامية قبل حفظ الحالة النهائية: {targetStatus}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Info label="رقم أمر العمل" value={row.workOrderNumber} />
        <Info label="العميل" value={row.customerName} />
        <Info label="المركبة" value={`${row.vehiclePlate} — ${row.vehicleName}`} />
        <Info label="نوع الأمر" value={row.orderType} />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="الإيرادات" value={formatOMR(row.revenueExVat)} />
        <Metric label="قطع غيار تقديرية" value={formatOMR(row.estimatedSparePartsCost)} />
        <Metric label="قطع غيار فعلية" value={formatOMR(row.actualSparePartsCost)} />
        <Metric label="عمالة تقديرية" value={formatOMR(row.estimatedLabourCost)} />
        <Metric label="عمالة فعلية" value={formatOMR(row.actualLabourCost)} />
        <Metric label="مصروفات أخرى" value={formatOMR(row.otherExpenses)} />
        <Metric label="إجمالي التكلفة النهائي" value={formatOMR(finalTotal)} />
        <Metric label="صافي الربح / الخسارة" value={formatOMR(netProfit)} danger={netProfit < 0} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-muted-foreground">الفاتورة المرتبطة</p>
          <p className={hasInvoice ? "font-bold text-success" : "font-bold text-destructive"}>{hasInvoice ? "موجودة" : "غير موجودة"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-muted-foreground">الدفعات</p>
          <p className={hasPayments ? "font-bold text-success" : "font-bold text-muted-foreground"}>{hasPayments ? formatOMR(row.paidAmount) : "لا توجد دفعات"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-muted-foreground">مصدر التكلفة المقترح</p>
          <p className="font-bold">{hasActualExpenses ? "Use Actual Expenses" : "Use Estimated Costs"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">مصدر التكلفة النهائي</label>
        <Select value={source} onValueChange={(value) => setSource(value as AccountingCostSource)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Actual Expenses">Use Actual Expenses</SelectItem>
            <SelectItem value="Estimated Costs">Use Estimated Costs</SelectItem>
            <SelectItem value="Manual Final Cost">Manual Final Cost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === "Manual Final Cost" && (
        <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input type="number" value={manualSpare} onChange={(e) => setManualSpare(Number(e.target.value))} placeholder="manual_spare_parts_cost" />
            <Input type="number" value={manualLabour} onChange={(e) => setManualLabour(Number(e.target.value))} placeholder="manual_labour_cost" />
            <Input type="number" value={manualOther} onChange={(e) => setManualOther(Number(e.target.value))} placeholder="manual_other_cost" />
          </div>
          <Textarea value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="سبب اعتماد تكلفة يدوية — إلزامي" />
        </div>
      )}

      {!hasInvoice && (
        <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 text-destructive" size={16} />
            <div>
              <p className="font-semibold text-destructive">هذا أمر العمل مكتمل ولا توجد فاتورة مرتبطة به.</p>
              <p className="text-xs text-muted-foreground">لا يمكن الإغلاق النهائي بدون إنشاء فاتورة أو تخطي معتمد بسبب واضح.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="gap-2" onClick={() => navigate(`/sales/invoices/new?fromWorkOrder=${encodeURIComponent(order.id)}&returnToClosing=1`)}>
              <FilePlus2 size={14} /> Create Invoice Now
            </Button>
            <Button
              type="button"
              variant={skipInvoice ? "default" : "outline"}
              disabled={!canApproveSkip}
              onClick={() => setSkipInvoice((value) => !value)}
              className="gap-2"
            >
              <Lock size={14} /> Skip Invoice with Manager Approval
            </Button>
          </div>
          {!canApproveSkip && <p className="text-xs text-destructive">Permission Denied: تخطي الفاتورة متاح للمالك أو المدير فقط.</p>}
          {skipInvoice && (
            <Textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="سبب تخطي الفاتورة — إلزامي" />
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>رجوع</Button>
        <Button onClick={confirm} disabled={!canConfirm} className="gap-2">
          <Save size={14} /> اعتماد الإغلاق
        </Button>
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><span className="text-muted-foreground">{label}: </span><span className="font-semibold">{value}</span></div>;
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${danger ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`font-mono font-bold ${danger ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
