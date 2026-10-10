import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ClaimPayment, useClearClaimCheque, useUpdateClaimPayment } from "@/hooks/useClaimPayments";
import { formatDateLatin } from "@/lib/numberUtils";
import { chequeSettlementDiscount } from "@/lib/insuranceChequeSettlement";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type InvoiceBalance = {
  id: string;
  invoice_number: string;
  total: number;
  paid_amount: number;
  settlement_discount_amount: number | null;
  status: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: ClaimPayment | null;
}

const today = () => new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

export default function ChequeClearanceDialog({ open, onOpenChange, payment }: Props) {
  const { hasRole } = useAuth();
  const canApproveSettlement = hasRole("admin", "manager");
  const [clearedDate, setClearedDate] = useState(today);
  const [withDiscount, setWithDiscount] = useState(false);
  const [discountReason, setDiscountReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const clearCheque = useClearClaimCheque();
  const updatePayment = useUpdateClaimPayment();
  const pending = clearCheque.isPending || updatePayment.isPending;

  const invoiceQuery = useQuery({
    queryKey: ["cheque-clearance-invoice", payment?.id, payment?.tenant_id, payment?.claim_id],
    enabled: open && !!payment && canApproveSettlement,
    staleTime: 0,
    queryFn: async (): Promise<InvoiceBalance | null> => {
      if (!payment) return null;
      const { data, error } = await supabase
        .from("insurance_invoices" as any)
        .select("id,invoice_number,total,paid_amount,settlement_discount_amount,status")
        .eq("tenant_id", payment.tenant_id)
        .eq("claim_id", payment.claim_id);
      if (error) throw error;
      const active = ((data || []) as unknown as InvoiceBalance[]).filter(
        (invoice) => !["cancelled", "canceled", "void", "deleted"].includes(String(invoice.status || "").toLowerCase()),
      );
      if (payment.offset_against_invoice_id) {
        return active.find((invoice) => invoice.id === payment.offset_against_invoice_id) || null;
      }
      // Never assign a discount to an arbitrary invoice when a legacy cheque has no invoice link.
      return active.length === 1 ? active[0] : null;
    },
  });

  const discount = invoiceQuery.data ? chequeSettlementDiscount(invoiceQuery.data, Number(payment?.amount || 0)) : 0;

  useEffect(() => {
    if (open) {
      setClearedDate(today());
      setWithDiscount(false);
      setDiscountReason("");
      setErrorMessage("");
    }
  }, [open, payment?.id]);

  async function submit() {
    if (!payment) return;
    if (!clearedDate) return toast.error("أدخل تاريخ التحصيل الفعلي");
    if (clearedDate > today()) return toast.error("لا يمكن أن يكون تاريخ التحصيل في المستقبل");
    setErrorMessage("");
    try {
      if (withDiscount) {
        if (!canApproveSettlement) throw new Error("خصم التسوية يحتاج صلاحية المدير");
        if (payment.status !== "pending" || payment.payment_method !== "cheque") throw new Error("لا يمكن تحصيل هذا الشيك من حالته الحالية");
        if (payment.reference_number?.startsWith("LEGACY-PAID:")) throw new Error("هذا سجل تسوية قديم وليس شيكًا فعليًا قابلًا للتحصيل");
        if (!discountReason.trim()) throw new Error("اكتب سبب خصم التسوية قبل التحصيل");
        const freshInvoice = await invoiceQuery.refetch();
        if (freshInvoice.error) throw freshInvoice.error;
        if (!freshInvoice.data) throw new Error("تعذر تحديد فاتورة تأمين واحدة مرتبطة بهذا الشيك؛ لم يُحفظ أي تغيير");
        const freshDiscount = chequeSettlementDiscount(freshInvoice.data, Number(payment.amount));
        if (freshDiscount <= 0) throw new Error("لا يوجد رصيد قابل للخصم بعد قيمة الشيك؛ لم يُحفظ أي تغيير");
        await updatePayment.mutateAsync({
          payment,
          updates: {
            status: "cleared",
            payment_date: clearedDate,
            settlement_discount_amount: freshDiscount,
            settlement_discount_reason: discountReason.trim(),
          },
          editReason: `تحصيل الشيك مع خصم تسوية — ${discountReason.trim()}`,
          successMessage: "تم تحصيل الشيك وإغلاق الفاتورة بخصم التسوية",
        });
      } else {
        await clearCheque.mutateAsync({ id: payment.id, clearedDate });
      }
      onOpenChange(false);
    } catch (error: any) {
      setErrorMessage(error?.message || "تعذر تحصيل الشيك. لم يُحفظ أي تغيير");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
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
            {canApproveSettlement && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>إغلاق الفاتورة بخصم تسوية</Label>
                    <p className="text-xs text-muted-foreground">يُعتمد الخصم عند تحصيل هذا الشيك فقط؛ لن تُنشأ دفعة ثانية ولن يتغير إجمالي الفاتورة أو ضريبتها.</p>
                  </div>
                  <Switch checked={withDiscount} onCheckedChange={setWithDiscount} disabled={invoiceQuery.isPending || !invoiceQuery.data || discount <= 0} />
                </div>
                {invoiceQuery.isError && <p className="text-xs text-destructive">تعذر تحميل رصيد الفاتورة؛ لا يمكن اعتماد الخصم حتى إعادة المحاولة.</p>}
                {!invoiceQuery.isPending && !invoiceQuery.isError && !invoiceQuery.data && <p className="text-xs text-muted-foreground">لا توجد فاتورة واحدة واضحة مرتبطة بهذا الشيك؛ يمكن تحصيله دون خصم فقط.</p>}
                {withDiscount && invoiceQuery.data && (
                  <>
                    <div className="text-sm">الفاتورة <strong>{invoiceQuery.data.invoice_number}</strong> — الخصم المتوقع <strong>{discount.toFixed(3)} ر.ع</strong></div>
                    <p className="text-xs text-muted-foreground">سيُعاد فحص الرصيد عند التأكيد. أي تغيير متزامن سيمنع الحفظ ويظهر خطأ واضحًا.</p>
                    <Textarea value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder="سبب الخصم (إلزامي)" rows={2} />
                  </>
                )}
              </div>
            )}
            {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={!payment || pending}>تأكيد التحصيل</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
