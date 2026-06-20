import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  supplierPaymentsStore,
  nextSupplierPaymentId,
  type SupplierPayment,
} from "@/lib/supplierPaymentsStore";
import { suppliersStore } from "@/lib/suppliersStore";
import { purchaseInvoicesStore, getPurchaseTotals } from "@/lib/purchaseInvoicesStore";
import { postSupplierPayment } from "@/lib/purchaseAccounting";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefillSupplierId?: string;
  prefillInvoiceId?: string;
}

export default function SupplierPaymentDialog({
  open, onOpenChange, prefillSupplierId, prefillInvoiceId,
}: Props) {
  const suppliers = suppliersStore.getAll();
  const invoices = purchaseInvoicesStore.getAll();

  const [supplierId, setSupplierId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<SupplierPayment["method"]>("نقدي");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setSupplierId(prefillSupplierId || suppliers[0]?.id || "");
      setInvoiceId(prefillInvoiceId || "");
      setAmount(0);
      setMethod("نقدي");
      setReference("");
      setDate(new Date().toISOString().slice(0, 10));
      setNotes("");
    }
  }, [open, prefillSupplierId, prefillInvoiceId]);

  const supplierInvoices = useMemo(
    () => invoices.filter((i) => i.supplierId === supplierId && !i.paid),
    [invoices, supplierId],
  );
  const selectedInv = invoices.find((i) => i.id === invoiceId);
  const remaining = selectedInv
    ? getPurchaseTotals(selectedInv).total - (selectedInv.paidAmount || 0)
    : 0;

  function handleSave() {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) { toast.error("اختر المورد"); return; }
    if (amount <= 0) { toast.error("أدخل مبلغ الدفعة"); return; }

    const id = nextSupplierPaymentId();
    const payment: SupplierPayment = {
      id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      invoiceId: invoiceId || undefined,
      amount,
      method,
      reference,
      date,
      notes,
      createdAt: new Date().toISOString(),
    };
    supplierPaymentsStore.add(payment);
    postSupplierPayment(payment);

    // تحديث الفاتورة المرتبطة
    if (invoiceId && selectedInv) {
      const newPaid = (selectedInv.paidAmount || 0) + amount;
      const total = getPurchaseTotals(selectedInv).total;
      purchaseInvoicesStore.update(invoiceId, {
        paidAmount: newPaid,
        paid: newPaid >= total - 0.001,
        status: newPaid >= total - 0.001 ? "paid" : "partial",
      });
    }
    toast.success(`تم تسجيل الدفعة ${id} وترحيلها لدفتر اليومية`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">دفعة جديدة لمورد</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <Field label="المورد *">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-10 w-full rounded-md bg-secondary border border-border px-3 text-sm text-foreground"
            >
              <option value="">اختر مورد...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="ربط بفاتورة (اختياري)">
            <select
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              className="h-10 w-full rounded-md bg-secondary border border-border px-3 text-sm text-foreground"
            >
              <option value="">— بدون ربط —</option>
              {supplierInvoices.map((i) => {
                const t = getPurchaseTotals(i);
                return (
                  <option key={i.id} value={i.id}>
                    {i.id} • متبقي {(t.total - (i.paidAmount || 0)).toFixed(3)}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label="المبلغ (ر.ع) *">
            <Input type="number" step="0.001" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="bg-secondary border-border" />
            {selectedInv && (
              <button type="button" onClick={() => setAmount(remaining)} className="text-[10px] text-primary hover:underline">
                دفع المتبقي ({remaining.toFixed(3)})
              </button>
            )}
          </Field>
          <Field label="طريقة الدفع">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as SupplierPayment["method"])}
              className="h-10 w-full rounded-md bg-secondary border border-border px-3 text-sm text-foreground"
            >
              <option>نقدي</option>
              <option>تحويل بنكي</option>
              <option>شيك</option>
              <option>بطاقة</option>
            </select>
          </Field>
          <Field label="التاريخ">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border" />
          </Field>
          <Field label="المرجع">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم الشيك / التحويل" className="bg-secondary border-border" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ملاحظات">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-secondary border-border" />
            </Field>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ الدفعة</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
