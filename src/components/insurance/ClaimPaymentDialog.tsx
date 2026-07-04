import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useCreateClaimPayment,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/hooks/useClaimPayments";
import { previewInsurancePayment } from "@/lib/insuranceAccounting";
import JournalPreview from "@/components/accounting/JournalPreview";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  claimId: string;
  insuranceCompanyId: string | null;
  remainingAmount: number;
  /** اختياري — إذا مرر يُستخدم في معاينة القيد المحاسبي قبل الحفظ */
  claimNumber?: string;
  companyName?: string;
  onSaved?: () => void;
}

export default function ClaimPaymentDialog({
  open,
  onOpenChange,
  claimId,
  insuranceCompanyId,
  remainingAmount,
  claimNumber,
  companyName,
  onSaved,
}: Props) {
  const create = useCreateClaimPayment();
  const [showJournal, setShowJournal] = useState(true);

  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [bank, setBank] = useState("");
  const [chequeDue, setChequeDue] = useState<string>("");
  const [status, setStatus] = useState<PaymentStatus>("cleared");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(remainingAmount > 0 ? remainingAmount : 0);
      setMethod("bank_transfer");
      setDate(new Date().toISOString().slice(0, 10));
      setReference(""); setBank(""); setChequeDue("");
      setStatus("cleared"); setNotes("");
    }
  }, [open, remainingAmount]);

  // الشيك يبدأ معلقاً تلقائياً
  useEffect(() => {
    if (method === "cheque") setStatus("pending");
    else setStatus("cleared");
  }, [method]);

  const handleSubmit = async () => {
    if (!amount || amount <= 0) { toast.error("يرجى إدخال مبلغ صحيح"); return; }
    if (amount > remainingAmount + 0.01) {
      toast.error(`المبلغ يتجاوز المتبقي (${remainingAmount.toLocaleString()} ر.ع)`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("يرجى تسجيل الدخول"); return; }
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    let tenantId = profile?.tenant_id as string | undefined;
    if (!tenantId) {
      // محاولة احتياطية: جلب tenant_id من المطالبة نفسها
      const { data: claim } = await supabase
        .from("insurance_claims")
        .select("tenant_id")
        .eq("id", claimId)
        .maybeSingle();
      tenantId = (claim as any)?.tenant_id;
    }
    if (!tenantId) { toast.error("تعذّر تحديد المؤسسة"); return; }

    await create.mutateAsync({
      tenant_id: tenantId,
      claim_id: claimId,
      insurance_company_id: insuranceCompanyId,
      amount,
      payment_method: method,
      payment_date: date,
      reference_number: reference || null,
      bank_name: method === "cheque" || method === "bank_transfer" ? (bank || null) : null,
      cheque_due_date: method === "cheque" ? (chequeDue || null) : null,
      status,
      notes: notes || null,
    });

    onSaved?.();
    onOpenChange(false);
  };

  // معاينة القيد المحاسبي قبل الحفظ
  const previewLines = useMemo(() => {
    if (!amount || amount <= 0) return [];
    return previewInsurancePayment({
      paymentId: "PREVIEW",
      paymentNumber: "(جديد)",
      claimNumber: claimNumber ?? "—",
      date,
      amount,
      method,
      status,
      companyName: companyName ?? "شركة التأمين",
      reference: reference || null,
    }).map((l) => ({ ...l, pending: true as const }));
  }, [amount, method, status, date, reference, claimNumber, companyName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل دفعة جديدة</DialogTitle>
        </DialogHeader>

        <div className="bg-secondary/30 rounded-lg p-3 mb-2 text-sm">
          المتبقي على شركة التأمين: <strong className="text-primary">{remainingAmount.toLocaleString()} ر.ع</strong>
          <span className="text-xs text-muted-foreground mr-2">(شامل ضريبة القيمة المضافة 5%)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>المبلغ *</Label>
            <Input
              type="text" inputMode="decimal" min={0} step="0.01"
              value={amount}
              onChange={(e) => setAmount(parseMoneyInput(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>طريقة الاستلام</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>تاريخ الاستلام</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>
              {method === "cheque" ? "رقم الشيك" :
               method === "bank_transfer" ? "رقم التحويل" :
               method === "offset" ? "رقم سند المقاصة" : "رقم المرجع"}
            </Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          {(method === "cheque" || method === "bank_transfer") && (
            <div className="space-y-1.5">
              <Label>اسم البنك</Label>
              <Input value={bank} onChange={(e) => setBank(e.target.value)} />
            </div>
          )}

          {method === "offset" && (
            <div className="space-y-1.5 md:col-span-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
              <Label className="text-warning font-semibold">تفاصيل المقاصة</Label>
              <p className="text-xs text-muted-foreground mb-2">
                وضّح من أين تم الخصم (اسم المورد/الفاتورة المُسوّاة) — يظهر في كشف الحساب.
              </p>
              <Input
                placeholder="مثال: مقاصة فاتورة المورد PI-00125 — قطع غيار الخليج"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          )}

          {method === "cheque" && (
            <>
              <div className="space-y-1.5">
                <Label>تاريخ استحقاق الشيك</Label>
                <Input type="date" value={chequeDue} onChange={(e) => setChequeDue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>حالة الشيك</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as PaymentStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">معلق (لم يصرف بعد)</SelectItem>
                    <SelectItem value="cleared">محصل</SelectItem>
                    <SelectItem value="bounced">مرتجع</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {method !== "offset" && (
            <div className="space-y-1.5 md:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          )}
        </div>

        {/* معاينة القيد المحاسبي */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">عرض القيد المحاسبي قبل الحفظ</Label>
            <Switch checked={showJournal} onCheckedChange={setShowJournal} />
          </div>
          {showJournal && (
            <JournalPreview
              title="القيد المتوقع للترحيل"
              lines={previewLines}
              emptyMessage={
                status === "bounced"
                  ? "شيك مرتجع — لن يُرحَّل قيد فعّال"
                  : "أدخل المبلغ لعرض القيد المتوقع"
              }
            />
          )}
        </div>

        <DialogFooter className="flex-row-reverse gap-2">
          <Button onClick={handleSubmit} disabled={create.isPending}>تسجيل الدفعة</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
