import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ReopenClaimTargetStatus } from "@/lib/claimReopen";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimNumber: string;
  approvedAmount: number;
  submitting?: boolean;
  onConfirm: (input: { reason: string; targetStatus: ReopenClaimTargetStatus }) => Promise<void>;
}
export default function ReopenClaimDialog({
  open,
  onOpenChange,
  claimNumber,
  approvedAmount,
  submitting = false,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [targetStatus, setTargetStatus] = useState<ReopenClaimTargetStatus>("pending");

  useEffect(() => {
    if (!open) {
      setReason("");
      setTargetStatus("pending");
    }
  }, [open]);

  const confirm = async () => {
    await onConfirm({ reason, targetStatus });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <RotateCcw size={19} /> إعادة المطالبة {claimNumber}
          </DialogTitle>
          <DialogDescription>
            ستعود المطالبة إلى الدورة التشغيلية، مع بقاء ورقة الإلغاء محفوظة في الأرشيف كسجل تاريخي.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                إعادة المطالبة لا تحذف تلقائيًا أي مصروف أو فاتورة عميل أو أمر عمل تم إنشاؤه أثناء الإلغاء.
                راجع هذه السجلات ماليًا إن كانت موجودة.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>الحالة بعد الإعادة</Label>
            <RadioGroup value={targetStatus} onValueChange={(value) => setTargetStatus(value as ReopenClaimTargetStatus)}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="pending" className="mt-1" />
                <span>
                  <strong className="block text-sm">بانتظار الموافقة</strong>
                  <span className="text-xs text-muted-foreground">الخيار الأكثر أمانًا للمراجعة قبل استكمال العمل.</span>
                </span>
              </label>
              <label className={`flex items-start gap-3 rounded-lg border p-3 ${approvedAmount > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
                <RadioGroupItem value="approved" className="mt-1" disabled={approvedAmount <= 0} />
                <span>
                  <strong className="block text-sm">معتمدة بالمبلغ الحالي</strong>
                  <span className="text-xs text-muted-foreground">
                    المبلغ المعتمد الحالي: {approvedAmount.toFixed(3)} ر.ع
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claim-reopen-reason">سبب إعادة المطالبة *</Label>
            <Textarea
              id="claim-reopen-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="مثلاً: وافقت شركة التأمين على متابعة المطالبة..."
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>تراجع</Button>
          <Button onClick={() => void confirm()} disabled={submitting || !reason.trim()} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
            تأكيد إعادة المطالبة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
