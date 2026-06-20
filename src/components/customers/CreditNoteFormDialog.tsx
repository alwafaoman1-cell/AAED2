import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { creditNotesStore, type CreditNote } from "@/lib/creditNotesStore";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: { name: string; phone?: string };
  initial?: CreditNote | null;
}

export default function CreditNoteFormDialog({ open, onOpenChange, customer, initial }: Props) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [linkedInvoiceId, setLinkedInvoiceId] = useState("");

  useEffect(() => {
    if (initial) {
      setAmount(initial.amount);
      setReason(initial.reason);
      setDate(initial.date);
      setNotes(initial.notes || "");
      setLinkedInvoiceId(initial.linkedInvoiceId || "");
    } else {
      setAmount(0); setReason(""); setDate(new Date().toISOString().split("T")[0]);
      setNotes(""); setLinkedInvoiceId("");
    }
  }, [initial, open]);

  function handleSave() {
    if (!amount || amount <= 0) { toast.error("أدخل مبلغاً صحيحاً"); return; }
    if (!reason.trim()) { toast.error("أدخل سبب الإشعار"); return; }

    if (initial) {
      creditNotesStore.update(initial.id, { amount, reason, date, notes, linkedInvoiceId });
      logActivity({
        action: "update", entity: "invoice", entityId: initial.number,
        label: `إشعار دائن ${initial.number} — ${customer.name}`,
        description: `تعديل المبلغ إلى ${amount} ر.ع`, amount,
      });
      toast.success("تم تعديل الإشعار الدائن");
    } else {
      const all = creditNotesStore.getAll();
      const number = `CN-${String(all.length + 1).padStart(5, "0")}`;
      const record: CreditNote = {
        id: `CN-${Date.now()}`,
        number, date, amount, reason, notes,
        linkedInvoiceId: linkedInvoiceId || undefined,
        customer: customer.name, customerPhone: customer.phone,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      creditNotesStore.add(record);
      logActivity({
        action: "create", entity: "invoice", entityId: number,
        label: `إشعار دائن ${number} — ${customer.name}`,
        description: reason, amount,
      });
      toast.success(`تم إنشاء إشعار دائن ${number}`);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل إشعار دائن" : "إنشاء إشعار دائن"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">المبلغ (ر.ع)</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">سبب الإشعار</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مرتجع قطعة، خصم تجاري، تسوية..." />
          </div>
          <div>
            <Label className="text-xs">رقم الفاتورة المرتبطة (اختياري)</Label>
            <Input value={linkedInvoiceId} onChange={(e) => setLinkedInvoiceId(e.target.value)} placeholder="INV-00001" />
          </div>
          <div>
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground">حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
