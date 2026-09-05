import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClaimPayment, useClearClaimCheque } from "@/hooks/useClaimPayments";
import { formatDateLatin } from "@/lib/numberUtils";
import { toast } from "sonner";

type ChequePayment = Pick<ClaimPayment, "id" | "payment_number" | "amount" | "payment_date" | "created_at">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: ChequePayment | null;
}

const today = () => new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

export default function ChequeClearanceDialog({ open, onOpenChange, payment }: Props) {
  const [clearedDate, setClearedDate] = useState(today);
  const clearCheque = useClearClaimCheque();

  useEffect(() => {
    if (open) setClearedDate(today());
  }, [open, payment?.id]);

  async function submit() {
    if (!payment) return;
    if (!clearedDate) return toast.error("أدخل تاريخ التحصيل الفعلي");
    if (clearedDate > today()) return toast.error("لا يمكن أن يكون تاريخ التحصيل في المستقبل");
    await clearCheque.mutateAsync({ id: payment.id, clearedDate });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !clearCheque.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>تحصيل الشيك</DialogTitle></DialogHeader>
        {payment && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><span>رقم السند</span><strong className="font-mono">{payment.payment_number}</strong></div>
              <div className="mt-2 flex justify-between gap-3"><span>قيمة الشيك</span><strong>{Number(payment.amount).toFixed(3)} ر.ع</strong></div>
              <div className="mt-2 flex justify-between gap-3"><span>تاريخ تسجيل الشيك</span><strong>{formatDateLatin(payment.created_at || payment.payment_date)}</strong></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cheque-cleared-date">تاريخ التحصيل الفعلي</Label>
              <Input id="cheque-cleared-date" type="date" value={clearedDate} max={today()} onChange={(event) => setClearedDate(event.target.value)} />
              <p className="text-xs text-muted-foreground">سيظهر التحصيل في تقرير الشهر المطابق لهذا التاريخ، وستُحدّث حالة الفاتورة تلقائيًا.</p>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={!payment || clearCheque.isPending}>تأكيد التحصيل</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={clearCheque.isPending}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
