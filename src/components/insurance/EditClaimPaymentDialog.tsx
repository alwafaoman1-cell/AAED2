import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type ClaimPayment,
  type PaymentMethod,
  type PaymentStatus,
  useUpdateClaimPayment,
} from "@/hooks/useClaimPayments";

type Props = {
  payment: ClaimPayment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const money = (value: number | string | null | undefined) => Number(value || 0).toFixed(3);

export default function EditClaimPaymentDialog({ payment, open, onOpenChange }: Props) {
  const updatePayment = useUpdateClaimPayment();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [bank, setBank] = useState("");
  const [chequeDue, setChequeDue] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("cleared");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0.000");
  const [discountReason, setDiscountReason] = useState("");
  const [editReason, setEditReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!open || !payment) return;
    setAmount(money(payment.amount));
    setMethod(payment.payment_method);
    setDate(payment.payment_date);
    setReference(payment.reference_number || "");
    setBank(payment.bank_name || "");
    setChequeDue(payment.cheque_due_date || "");
    setStatus(payment.status);
    setNotes(payment.notes || "");
    setDiscount(money(payment.settlement_discount_amount));
    setDiscountReason(payment.settlement_discount_reason || "");
    setEditReason("");
    setReviewing(false);
    setErrorMessage("");
  }, [open, payment]);

  const changes = useMemo(() => {
    if (!payment) return [] as { label: string; before: string; after: string }[];
    const rows = [
      { label: "المبلغ", before: money(payment.amount), after: money(amount) },
      { label: "طريقة الدفع", before: PAYMENT_METHOD_LABELS[payment.payment_method], after: PAYMENT_METHOD_LABELS[method] },
      { label: "تاريخ الدفع", before: payment.payment_date, after: date },
      { label: "الحالة", before: PAYMENT_STATUS_LABELS[payment.status], after: PAYMENT_STATUS_LABELS[status] },
      { label: "رقم المرجع", before: payment.reference_number || "—", after: reference.trim() || "—" },
      { label: "البنك", before: payment.bank_name || "—", after: bank.trim() || "—" },
      { label: "تاريخ الشيك", before: payment.cheque_due_date || "—", after: method === "cheque" ? chequeDue || "—" : "—" },
      { label: "خصم التسوية", before: money(payment.settlement_discount_amount), after: money(discount) },
      { label: "سبب الخصم", before: payment.settlement_discount_reason || "—", after: Number(discount || 0) > 0 ? discountReason.trim() || "—" : "—" },
      { label: "الملاحظات", before: payment.notes || "—", after: notes.trim() || "—" },
    ];
    return rows.filter((row) => row.before !== row.after);
  }, [amount, bank, chequeDue, date, discount, discountReason, method, notes, payment, reference, status]);

  const validateForReview = () => {
    setErrorMessage("");
    if (!payment) return;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setErrorMessage("أدخل مبلغ دفعة صحيحًا أكبر من صفر");
      return;
    }
    if (Number(discount || 0) < 0) {
      setErrorMessage("خصم التسوية لا يمكن أن يكون سالبًا");
      return;
    }
    if (Number(discount || 0) > 0 && (method === "cheque" || status !== "cleared")) {
      setErrorMessage("خصم التسوية يتطلب دفعة محصلة وليست شيكًا");
      return;
    }
    if (Number(discount || 0) > 0 && !discountReason.trim()) {
      setErrorMessage("سبب خصم التسوية إلزامي");
      return;
    }
    if (!editReason.trim()) {
      setErrorMessage("اكتب سبب تعديل الدفعة قبل المتابعة");
      return;
    }
    if (changes.length === 0) {
      setErrorMessage("لم يتم تغيير أي قيمة في الدفعة");
      return;
    }
    setReviewing(true);
  };

  const save = async () => {
    if (!payment) return;
    setErrorMessage("");
    try {
      await updatePayment.mutateAsync({
        payment,
        editReason: editReason.trim(),
        updates: {
          amount: Number(amount),
          payment_method: method,
          payment_date: date,
          reference_number: reference.trim() || null,
          bank_name: bank.trim() || null,
          cheque_due_date: method === "cheque" ? chequeDue || null : null,
          status,
          notes: notes.trim() || null,
          settlement_discount_amount: Number(discount || 0),
          settlement_discount_reason: Number(discount || 0) > 0 ? discountReason.trim() : null,
        },
      });
      onOpenChange(false);
    } catch (error: any) {
      setErrorMessage(error?.message || "تعذر تعديل الدفعة. لم يتم حفظ أي تغيير");
      setReviewing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !updatePayment.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل الدفعة {payment?.payment_number}</DialogTitle>
        </DialogHeader>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {!reviewing ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>المبلغ المحصل</Label>
              <Input type="number" min="0.001" step="0.001" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الدفع</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>حالة الدفعة</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as PaymentStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>رقم المرجع</Label>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>اسم البنك</Label>
              <Input value={bank} onChange={(event) => setBank(event.target.value)} />
            </div>
            {method === "cheque" && (
              <div className="space-y-1.5">
                <Label>تاريخ استحقاق الشيك</Label>
                <Input type="date" value={chequeDue} onChange={(event) => setChequeDue(event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>خصم التسوية الداخلي</Label>
              <Input type="number" min="0" step="0.001" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            </div>
            {Number(discount || 0) > 0 && (
              <div className="space-y-1.5 md:col-span-2">
                <Label>سبب خصم التسوية *</Label>
                <Textarea value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} />
              </div>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <Label>ملاحظات الدفعة</Label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
              <Label>سبب التعديل *</Label>
              <Textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="مثال: تصحيح تاريخ التحصيل أو قيمة الدفعة" />
              <p className="text-xs text-muted-foreground">سيُحفظ السبب والقيم قبل وبعد في سجل التدقيق.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <div className="font-semibold">راجع التغييرات قبل الحفظ</div>
                <div className="text-muted-foreground">سيُعاد احتساب حالة الفاتورة والرصيد والتقارير والقيد المحاسبي.</div>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted px-3 py-2 text-xs font-semibold">
                <span>الحقل</span><span>قبل</span><span>بعد</span>
              </div>
              {changes.map((change) => (
                <div key={change.label} className="grid grid-cols-[1fr_1fr_1fr] border-t px-3 py-2 text-sm">
                  <span>{change.label}</span>
                  <span className="text-muted-foreground">{change.before}</span>
                  <span className="font-semibold">{change.after}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <span className="font-semibold">سبب التعديل: </span>{editReason}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!reviewing ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
              <Button onClick={validateForReview} className="gap-2"><ArrowLeftRight className="h-4 w-4" /> مراجعة التعديل</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setReviewing(false)} disabled={updatePayment.isPending}>رجوع للتعديل</Button>
              <Button onClick={save} disabled={updatePayment.isPending}>
                {updatePayment.isPending ? "جارٍ الحفظ..." : "تأكيد وحفظ التعديل"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
