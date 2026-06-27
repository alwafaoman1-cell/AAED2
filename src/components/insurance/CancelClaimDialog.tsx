import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { AlertCircle, XCircle, Receipt, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createExpenseFromCancelledClaim,
  createCustomerInvoiceFromCancelledClaim,
} from "@/lib/insuranceCancellation";
import { removeInsuranceClaimJournal } from "@/lib/insuranceAccounting";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";

type Action = "cancel_only" | "expense" | "customer_invoice";

interface Props {
  open: boolean;
  onClose: () => void;
  claim: InsuranceClaim;
  approvedAmount: number;
  estimatedAmount: number;
  onConfirm: (params: { reason: string; action: Action }) => Promise<void> | void;
  isSubmitting?: boolean;
}

export default function CancelClaimDialog({
  open, onClose, claim, approvedAmount, estimatedAmount, onConfirm, isSubmitting,
}: Props) {
  const baseAmount = approvedAmount > 0 ? approvedAmount : estimatedAmount;
  const [action, setAction] = useState<Action>("cancel_only");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(String(baseAmount.toFixed(3)));
  const [working, setWorking] = useState(false);

  const numericAmount = parseFloat(amount) || 0;

  const journalImpact = useMemo(() => {
    if (action === "cancel_only") {
      return [
        { label: "إلغاء قيد الاعتماد السابق", debit: "—", credit: "—", note: "سيتم حذف قيد ذمم/إيرادات شركة التأمين" },
      ];
    }
    if (action === "expense") {
      return [
        { label: "إلغاء قيد الاعتماد", debit: "—", credit: "—", note: "حذف قيد ذمم شركة التأمين" },
        { label: "تسجيل مصروف", debit: "مصروفات تشغيلية", credit: "الصندوق الرئيسي", note: `${numericAmount.toFixed(3)} ر.ع` },
      ];
    }
    return [
      { label: "إلغاء قيد الاعتماد", debit: "—", credit: "—", note: "حذف قيد ذمم شركة التأمين" },
      { label: "تحويل إلى فاتورة عميل", debit: "ذمم العملاء", credit: "إيرادات الورشة", note: `${numericAmount.toFixed(3)} ر.ع — على مالك السيارة` },
    ];
  }, [action, numericAmount]);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error("يرجى إدخال سبب الإلغاء");
      return;
    }
    setWorking(true);
    try {
      // 1) reverse the approval journal entry
      removeInsuranceClaimJournal(claim.id);

      // 2) optional side effects
      if (action === "expense") {
        const exp = await createExpenseFromCancelledClaim(claim, numericAmount);
        toast.success(`تم إنشاء سند مصروف ${exp.voucherNumber}`);
      } else if (action === "customer_invoice") {
        const wo = await createCustomerInvoiceFromCancelledClaim(claim, numericAmount);
        toast.success(`تم إنشاء أمر عمل/فاتورة على مالك السيارة ${wo.id}`);
      }

      // 3) update DB status
      await onConfirm({ reason, action });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر تنفيذ الإلغاء");
    } finally {
      setWorking(false);
    }
  };

  const submitting = working || !!isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle size={20} /> إغلاق / إلغاء المطالبة {claim.claim_number}
          </DialogTitle>
          <DialogDescription>
            سيتم تغيير حالة المطالبة إلى «ملغاة» وعكس القيد المحاسبي للاعتماد. اختر الإجراء التالي:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>سبب الإلغاء *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="مثلاً: العميل سحب المطالبة، شركة التأمين رفضت التغطية، السيارة لم تُسلَّم للورشة..."
            />
          </div>

          <RadioGroup value={action} onValueChange={(v) => setAction(v as Action)} className="space-y-2">
            <Card className={`p-3 cursor-pointer ${action === "cancel_only" ? "border-primary" : ""}`}
              onClick={() => setAction("cancel_only")}>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="cancel_only" id="r1" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="r1" className="flex items-center gap-2 font-semibold cursor-pointer">
                    <XCircle size={16} className="text-muted-foreground" /> إلغاء فقط (بدون أثر مالي)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    يتم تغيير الحالة فقط مع عكس قيد الاعتماد إن وجد. مناسب عند الإلغاء قبل بدء العمل.
                  </p>
                </div>
              </div>
            </Card>

            <Card className={`p-3 cursor-pointer ${action === "expense" ? "border-primary" : ""}`}
              onClick={() => setAction("expense")}>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="expense" id="r2" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="r2" className="flex items-center gap-2 font-semibold cursor-pointer">
                    <Receipt size={16} className="text-warning" /> تحويل التكاليف إلى مصروف داخلي
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    تُسجَّل تكاليف الإصلاح كمصروف على الورشة (لن يتم تحصيلها من أحد).
                  </p>
                </div>
              </div>
            </Card>

            <Card className={`p-3 cursor-pointer ${action === "customer_invoice" ? "border-primary" : ""}`}
              onClick={() => setAction("customer_invoice")}>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="customer_invoice" id="r3" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="r3" className="flex items-center gap-2 font-semibold cursor-pointer">
                    <FileText size={16} className="text-info" /> تحويل إلى فاتورة على مالك السيارة
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    يُنشأ أمر عمل جديد باسم {claim.vehicle_owner_name ?? claim.customer?.name ?? "مالك السيارة"} لتحصيل المبلغ منه مباشرة.
                  </p>
                </div>
              </div>
            </Card>
          </RadioGroup>

          {action !== "cancel_only" && (
            <div className="space-y-1.5">
              <Label>المبلغ (ر.ع) *</Label>
              <Input
                type="number"
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-lg font-semibold"
              />
            </div>
          )}

          <Card className="p-3 bg-muted/30 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground">
              <AlertCircle size={14} className="text-primary" /> الأثر المحاسبي المتوقع
            </div>
            <div className="text-xs space-y-1.5">
              {journalImpact.map((row, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 py-1 border-t border-border first:border-t-0">
                  <div className="col-span-4 font-medium">{row.label}</div>
                  <div className="col-span-2 text-success">مدين: {row.debit}</div>
                  <div className="col-span-2 text-destructive">دائن: {row.credit}</div>
                  <div className="col-span-4 text-muted-foreground">{row.note}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>تراجع</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
