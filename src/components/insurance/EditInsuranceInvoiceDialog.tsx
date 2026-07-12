// محرر فاتورة تأمين قابلة للتعديل (بنود + L.P.O + ملاحظات يدوية + حالة + مدفوع)
import { useEffect, useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  useUpdateInsuranceInvoice,
  type InsuranceInvoice,
} from "@/hooks/useInsuranceInvoices";

const VAT_RATE = 0.05;

interface ItemRow {
  description: string;
  quantity: number;
  unit_price: number;
}

interface Props {
  invoice: InsuranceInvoice | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function EditInsuranceInvoiceDialog({ invoice, open, onOpenChange }: Props) {
  const { hasRole, user } = useAuth();
  const update = useUpdateInsuranceInvoice();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dateChangeReason, setDateChangeReason] = useState("");
  const [lpo, setLpo] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InsuranceInvoice["status"]>("issued");
  const [paid, setPaid] = useState(0);

  useEffect(() => {
    if (!invoice) return;
    const initial = (invoice.items as any[] | null);
    if (Array.isArray(initial) && initial.length) {
      setItems(initial.map((it) => ({
        description: String(it.description ?? ""),
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
      })));
    } else {
      // تهيئة بنود افتراضية من المجاميع المحفوظة
      setItems([{
        description: "خدمات إصلاح بموجب المطالبة",
        quantity: 1,
        unit_price: Number(invoice.subtotal) || 0,
      }]);
    }
    setInvoiceNumber(invoice.invoice_number || "");
    setInvoiceDate(invoice.invoice_date || invoice.issued_at?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setDateChangeReason("");
    setLpo(invoice.lpo_number || "");
    setNotes(invoice.notes || "");
    setDueDate(invoice.due_date || "");
    setStatus(invoice.status);
    setPaid(Number(invoice.paid_amount) || 0);
  }, [invoice]);

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;
  const originalInvoiceDate = invoice?.invoice_date || invoice?.issued_at?.slice(0, 10) || "";
  const invoiceDateChanged = !!invoice && invoiceDate !== originalInvoiceDate;
  const canChangeIssuedDate = hasRole("admin");

  const addRow = () => setItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0 }]);
  const removeRow = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    if (!invoice) return;
    const cleaned = items.filter((it) => it.description.trim() && (Number(it.quantity) || 0) > 0);
    if (!cleaned.length) {
      toast.error("أضف بنداً واحداً على الأقل");
      return;
    }
    const trimmedNumber = invoiceNumber.trim();
    if (!trimmedNumber) {
      toast.error("رقم الفاتورة مطلوب");
      return;
    }
    if (!invoiceDate) {
      toast.error("تاريخ إصدار الفاتورة الضريبية مطلوب");
      return;
    }
    const parsedDate = new Date(`${invoiceDate}T12:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      toast.error("تاريخ إصدار الفاتورة غير صالح");
      return;
    }
    const maxFutureDate = new Date();
    maxFutureDate.setDate(maxFutureDate.getDate() + 30);
    if (parsedDate > maxFutureDate) {
      toast.error("تاريخ إصدار الفاتورة بعيد جدًا في المستقبل");
      return;
    }
    if (invoiceDateChanged && !canChangeIssuedDate) {
      toast.error("لا يمكن تعديل تاريخ فاتورة صادرة إلا للمدير");
      return;
    }
    if (invoiceDateChanged && !dateChangeReason.trim()) {
      toast.error("أدخل سبب تغيير تاريخ إصدار الفاتورة");
      return;
    }
    await update.mutateAsync({
      id: invoice.id,
      updates: {
        invoice_number: trimmedNumber,
        invoice_date: invoiceDate,
        items: cleaned,
        subtotal,
        vat,
        total,
        lpo_number: lpo.trim() || null,
        notes: notes.trim() || null,
        due_date: dueDate || null,
        status,
        paid_amount: paid,
      } as any,
    });
    if (invoiceDateChanged) {
      await supabase.from("claim_audit_logs" as any).insert({
        tenant_id: invoice.tenant_id,
        claim_id: invoice.claim_id,
        user_id: user?.id || null,
        action: "insurance_invoice_date_changed",
        details: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          old_invoice_date: originalInvoiceDate,
          new_invoice_date: invoiceDate,
          changed_by: user?.id || null,
          changed_at: new Date().toISOString(),
          reason: dateChangeReason.trim(),
        },
      } as any);
    }
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-w-3xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            تعديل فاتورة {invoice?.invoice_number}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 p-1">
          {/* Invoice Number + Issue Date + L.P.O + Due + Status */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">رقم الفاتورة</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="00001"
                dir="ltr"
                className="font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">تاريخ إصدار الفاتورة الضريبية</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">رقم أمر الشراء (L.P.O)</Label>
              <Input value={lpo} onChange={(e) => setLpo(e.target.value)} placeholder="LPO-2025-0001" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">تاريخ الاستحقاق</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">الحالة</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="issued">صادرة</SelectItem>
                  <SelectItem value="partial">جزئية</SelectItem>
                  <SelectItem value="paid">مدفوعة</SelectItem>
                  <SelectItem value="overdue">متأخرة</SelectItem>
                  <SelectItem value="cancelled">ملغاة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {invoiceDateChanged && canChangeIssuedDate && (
            <div>
              <Label className="text-xs">سبب تغيير تاريخ الفاتورة</Label>
              <Textarea
                value={dateChangeReason}
                onChange={(e) => setDateChangeReason(e.target.value)}
                placeholder="سبب محاسبي/إداري واضح"
                rows={2}
              />
            </div>
          )}

          {/* Items */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between bg-secondary/40 px-3 py-2">
              <span className="text-sm font-medium">بنود الفاتورة</span>
              <Button size="sm" variant="outline" onClick={addRow} className="gap-1 h-7">
                <Plus size={14} /> إضافة بند
              </Button>
            </div>
            <div className="divide-y divide-border">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 p-2 items-center">
                  <Input
                    className="col-span-6"
                    placeholder="وصف البند"
                    value={it.description}
                    onChange={(e) => updateRow(i, { description: e.target.value })}
                  />
                  <Input
                    className="col-span-2"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="الكمية"
                    value={it.quantity}
                    onChange={(e) => updateRow(i, { quantity: Number(e.target.value) || 0 })}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    min={0}
                    step={0.001}
                    placeholder="سعر الوحدة"
                    value={it.unit_price}
                    onChange={(e) => updateRow(i, { unit_price: Number(e.target.value) || 0 })}
                    dir="ltr"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-span-1 h-8 w-8 text-destructive"
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">لا توجد بنود — اضغط "إضافة بند"</div>
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-secondary/30 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">المجموع قبل الضريبة</span>
              <span dir="ltr">{subtotal.toFixed(3)} OMR</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ضريبة 5%</span>
              <span dir="ltr">{vat.toFixed(3)} OMR</span>
            </div>
            <div className="flex justify-between font-bold border-t border-border pt-1">
              <span>الإجمالي</span>
              <span dir="ltr">{total.toFixed(3)} OMR</span>
            </div>
          </div>

          {/* Paid + Notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">المبلغ المدفوع</Label>
              <Input
                type="number"
                min={0}
                step={0.001}
                value={paid}
                onChange={(e) => setPaid(Number(e.target.value) || 0)}
                dir="ltr"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">ملاحظات (يدوية)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية تظهر في الفاتورة..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
        </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
