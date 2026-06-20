import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  purchaseReturnsStore,
  nextPurchaseReturnId,
} from "@/lib/purchaseReturnsStore";
import { purchaseInvoicesStore, type PurchaseInvoiceItem } from "@/lib/purchaseInvoicesStore";
import { postPurchaseReturn } from "@/lib/purchaseAccounting";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoiceId: string;
}

export default function PurchaseReturnDialog({ open, onOpenChange, invoiceId }: Props) {
  const invoice = purchaseInvoicesStore.getById(invoiceId);
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (open) {
      setReturnQty({});
      setReason("");
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [open]);

  const items: PurchaseInvoiceItem[] = invoice?.items || [];
  const total = useMemo(() => {
    return items.reduce((sum, it, i) => {
      const q = returnQty[i] || 0;
      return sum + q * it.unitPrice;
    }, 0);
  }, [returnQty, items]);

  function handleSave() {
    if (!invoice) return;
    const returnedItems: PurchaseInvoiceItem[] = items
      .map((it, i) => ({ ...it, qty: returnQty[i] || 0 }))
      .filter((it) => it.qty > 0);
    if (!returnedItems.length) { toast.error("حدد كمية الإرجاع"); return; }

    const id = nextPurchaseReturnId();
    const newReturn = {
      id,
      invoiceId: invoice.id,
      supplierId: invoice.supplierId,
      supplierName: invoice.supplierName,
      date,
      items: returnedItems,
      reason,
      total,
      createdAt: new Date().toISOString(),
    };
    purchaseReturnsStore.add(newReturn);
    postPurchaseReturn(newReturn); // يخصم المخزون + يضيف قيد محاسبي
    toast.success(`تم تسجيل المرتجع ${id} وترحيله محاسبياً`);
    onOpenChange(false);
  }

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            مرتجع شراء — فاتورة {invoice.id}
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground pb-2">
          المورد: <span className="text-foreground font-medium">{invoice.supplierName}</span>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40">
              <tr className="text-xs text-muted-foreground">
                <th className="text-right p-2">البند</th>
                <th className="text-right p-2">كمية الفاتورة</th>
                <th className="text-right p-2">سعر الوحدة</th>
                <th className="text-right p-2">كمية الإرجاع</th>
                <th className="text-left p-2">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-2 text-foreground">{it.name}</td>
                  <td className="p-2 text-muted-foreground">{it.qty}</td>
                  <td className="p-2 text-muted-foreground">{it.unitPrice.toFixed(3)}</td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min={0}
                      max={it.qty}
                      value={returnQty[i] || 0}
                      onChange={(e) => setReturnQty((q) => ({ ...q, [i]: Math.min(it.qty, Number(e.target.value)) }))}
                      className="h-8 w-20 bg-secondary border-border"
                    />
                  </td>
                  <td className="p-2 text-left text-foreground font-mono">
                    {((returnQty[i] || 0) * it.unitPrice).toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="تاريخ الإرجاع">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border" />
          </Field>
          <div className="bg-secondary/40 border border-border rounded-lg p-3 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">إجمالي المرتجع</span>
            <span className="text-base font-bold text-primary font-mono">{total.toFixed(3)} ر.ع</span>
          </div>
        </div>

        <Field label="سبب الإرجاع">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="bg-secondary border-border" />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ المرتجع</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
