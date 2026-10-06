import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { depositsStore, type DepositRecord, type DepositScope } from "@/lib/depositsStore";
import { voucherSettingsStore, PAYMENT_METHOD_LABELS, type PaymentMethod, employeeCashboxesStore } from "@/lib/financeSettingsStore";
import { getDepositReceiptHtml } from "@/lib/pdfGenerator";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { createUuid } from "@/lib/uuid";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerName: string;
  customerPhone?: string;
  defaultPlate?: string;
  vehiclePlates?: string[];
  /** للتعديل: مرر السجل القائم */
  initial?: DepositRecord | null;
}

export default function DepositFormDialog({ open, onOpenChange, customerName, customerPhone, defaultPlate, vehiclePlates = [], initial }: Props) {
  const settings = voucherSettingsStore.get();
  const cashboxes = employeeCashboxesStore.getAll().filter(c => c.active);
  const defaultCashbox = cashboxes.find(c => c.isDefault) || cashboxes[0];
  const isEdit = !!initial;

  const [amount, setAmount] = useState<number>(0);
  const [scope, setScope] = useState<DepositScope>(defaultPlate ? "vehicle" : "customer");
  const [plate, setPlate] = useState<string>(defaultPlate || "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(settings.defaultPaymentMethod);
  const [cashboxId, setCashboxId] = useState<string>(defaultCashbox?.id || "");
  const [notes, setNotes] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && initial) {
      setAmount(initial.amount);
      setScope(initial.scope);
      setPlate(initial.plate || "");
      setPaymentMethod(initial.paymentMethod);
      setCashboxId(initial.cashboxId || defaultCashbox?.id || "");
      setNotes(initial.notes || "");
    } else if (open && !initial) {
      setAmount(0); setNotes("");
      setScope(defaultPlate ? "vehicle" : "customer");
      setPlate(defaultPlate || "");
    }
  }, [open, initial?.id]);

  async function handleSave(printAfter: boolean) {
    if (savingRef.current) return;
    if (!amount || amount <= 0) { toast.error("أدخل مبلغاً صحيحاً"); return; }
    if (scope === "vehicle" && !plate) { toast.error("اختر رقم اللوحة"); return; }
    const cashbox = cashboxes.find(c => c.id === cashboxId);

    savingRef.current = true;
    setSaving(true);
    try {
    let record: DepositRecord;
    if (isEdit && initial) {
      record = {
        ...initial,
        amount,
        scope,
        plate: scope === "vehicle" ? plate : undefined,
        paymentMethod,
        cashboxId: cashbox?.id,
        cashboxName: cashbox?.cashboxName,
        notes,
      };
      await depositsStore.updateConfirmed(initial.id, record);
      toast.success(`تم تحديث الدفعة ${record.receiptNumber}`);
    } else {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("تعذر تحديد المؤسسة؛ لم تُحفظ الدفعة");
      const { data: receiptNumber, error: numberError } = await (supabase.rpc as any)("reserve_receipt_number_rpc", {
        p_tenant_id: tenantId,
      });
      if (numberError || typeof receiptNumber !== "string" || !receiptNumber) {
        throw numberError || new Error("تعذر تخصيص رقم سند قبض من قاعدة البيانات");
      }
      record = {
        id: createUuid(),
        receiptNumber,
        date: new Date().toISOString().split("T")[0],
        amount,
        scope,
        customer: customerName,
        customerPhone,
        plate: scope === "vehicle" ? plate : undefined,
        paymentMethod,
        cashboxId: cashbox?.id,
        cashboxName: cashbox?.cashboxName,
        notes,
        consumed: 0,
        createdAt: new Date().toISOString(),
      };
      await depositsStore.addConfirmed(record);
      toast.success(`تم تسجيل الدفعة ${receiptNumber}`);
    }

    if (printAfter) {
      const html = getDepositReceiptHtml({
        receiptNumber: record.receiptNumber,
        date: record.date,
        customerName: record.customer,
        customerPhone: record.customerPhone,
        plateNumber: record.plate,
        amount: record.amount,
        paymentMethod: PAYMENT_METHOD_LABELS[record.paymentMethod],
        scope: record.scope,
        notes: record.notes,
      });
      setPreviewHtml(html);
      setShowPreview(true);
    } else {
      onOpenChange(false);
    }
    } catch (error: any) {
      toast.error(error?.message || "لم تؤكد السحابة حفظ الدفعة؛ تحقق قبل إعادة المحاولة");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg bg-card border-border" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isEdit ? `تعديل الدفعة ${initial!.receiptNumber}` : `تسجيل دفعة لـ ${customerName}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">المبلغ (ر.ع) *</label>
              <Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className="bg-secondary border-border text-foreground text-lg font-bold" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">نطاق الدفعة</label>
              <Select value={scope} onValueChange={(v) => setScope(v as DepositScope)}>
                <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="customer">دفعة عامة للعميل</SelectItem>
                  <SelectItem value="vehicle">دفعة مرتبطة بسيارة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "vehicle" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">رقم اللوحة *</label>
                {vehiclePlates.length > 0 ? (
                  <Select value={plate} onValueChange={setPlate}>
                    <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="اختر السيارة" /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {vehiclePlates.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={plate} onChange={e => setPlate(e.target.value)} className="bg-secondary border-border text-foreground" />
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">طريقة الدفع</label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">الخزينة</label>
                <Select value={cashboxId} onValueChange={setCashboxId}>
                  <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {cashboxes.map(c => <SelectItem key={c.id} value={c.id}>{c.cashboxName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">ملاحظات</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded-lg bg-secondary border border-border text-foreground p-2 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button disabled={saving} onClick={() => void handleSave(true)} className="gradient-gold text-primary-foreground flex-1">{saving ? "جارِ الحفظ…" : "حفظ وطباعة سند"}</Button>
              <Button disabled={saving} onClick={() => void handleSave(false)} variant="outline">حفظ فقط</Button>
              <Button onClick={() => onOpenChange(false)} variant="ghost">إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <PdfPreviewDialog
        open={showPreview}
        onOpenChange={(o) => { setShowPreview(o); if (!o) onOpenChange(false); }}
        htmlContent={previewHtml}
        title="سند قبض دفعة"
      />
    </>
  );
}
