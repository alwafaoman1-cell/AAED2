// محرر فاتورة تأمين قابلة للتعديل. التحصيل يُسجّل حصراً كسند دفعة مستقل.
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
  useCorrectHistoricalInsuranceInvoiceNumber,
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
  const correctNumber = useCorrectHistoricalInsuranceInvoiceNumber();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [numberChangeReason, setNumberChangeReason] = useState("");
  const [otherFieldsEdited, setOtherFieldsEdited] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dateChangeReason, setDateChangeReason] = useState("");
  const [lpo, setLpo] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InsuranceInvoice["status"]>("issued");

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
    setNumberChangeReason("");
    setOtherFieldsEdited(false);
    setInvoiceDate(invoice.invoice_date || invoice.issued_at?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setDateChangeReason("");
    setLpo(invoice.lpo_number || "");
    setNotes(invoice.notes || "");
    setDueDate(invoice.due_date || "");
    setStatus(invoice.status);
  }, [invoice]);

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;
  const originalInvoiceDate = invoice?.invoice_date || invoice?.issued_at?.slice(0, 10) || "";
  const invoiceDateChanged = !!invoice && invoiceDate !== originalInvoiceDate;
  const canChangeIssuedDate = hasRole("admin");
  const canCorrectHistoricalNumber = hasRole("admin") && /^\d+$/.test(invoice?.invoice_number || "");
  const invoiceNumberChanged = !!invoice && invoiceNumber.trim() !== invoice.invoice_number;

  const addRow = () => {
    setOtherFieldsEdited(true);
    setItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0 }]);
  };
  const removeRow = (i: number) => {
    setOtherFieldsEdited(true);
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };
  const updateRow = (i: number, patch: Partial<ItemRow>) => {
    setOtherFieldsEdited(true);
    setItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    if (!invoice) return;
    if (invoiceNumberChanged) {
      if (!canCorrectHistoricalNumber) {
        toast.error("الرقم الرسمي لا يُعدّل من الفاتورة؛ التصحيح متاح للمدير للرقم التاريخي الرقمي فقط.");
        return;
      }
      if (otherFieldsEdited) {
        toast.error("صحح الرقم منفصلًا عن بقية التعديلات. احفظ بقية التعديلات أولًا ثم افتح الفاتورة مجددًا.");
        return;
      }
      if (numberChangeReason.trim().length < 4) {
        toast.error("أدخل سبب تصحيح رقم الفاتورة قبل الحفظ.");
        return;
      }
      try {
        await correctNumber.mutateAsync({
          id: invoice.id,
          oldNumber: invoice.invoice_number,
          newNumber: invoiceNumber.trim(),
          reason: numberChangeReason.trim(),
        });
        onOpenChange(false);
      } catch {
        // The mutation displays the database error; do not show a false success.
      }
      return;
    }
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
    try {
      await update.mutateAsync({
        id: invoice.id,
        updates: {
          invoice_date: invoiceDate,
          items: cleaned,
          subtotal,
          vat,
          total,
          lpo_number: lpo.trim() || null,
          notes: notes.trim() || null,
          due_date: dueDate || null,
          status,
        } as any,
      });
    } catch {
      return;
    }
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
                placeholder="INV-26-000073"
                dir="ltr"
                className="font-mono"
                readOnly={!canCorrectHistoricalNumber}
              />
              {canCorrectHistoricalNumber && (
                <p className="mt-1 text-xs text-muted-foreground">المدير: تصحيح الرقم التاريخي بنفس تسلسله فقط. احفظه منفصلًا عن باقي الحقول.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">تاريخ إصدار الفاتورة الضريبية</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => { setOtherFieldsEdited(true); setInvoiceDate(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs">رقم أمر الشراء (L.P.O)</Label>
              <Input value={lpo} onChange={(e) => { setOtherFieldsEdited(true); setLpo(e.target.value); }} placeholder="LPO-2025-0001" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">تاريخ الاستحقاق</Label>
              <Input type="date" value={dueDate} onChange={(e) => { setOtherFieldsEdited(true); setDueDate(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs">الحالة</Label>
              <Select value={status} onValueChange={(v) => { setOtherFieldsEdited(true); setStatus(v as any); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="issued">صادرة</SelectItem>
                  <SelectItem value="partial" disabled>جزئية — تُحسب من الدفعات</SelectItem>
                  <SelectItem value="paid" disabled>مدفوعة — تُحسب من الدفعات</SelectItem>
                  <SelectItem value="overdue">متأخرة</SelectItem>
                  <SelectItem value="cancelled">ملغاة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {invoiceNumberChanged && canCorrectHistoricalNumber && (
            <div>
              <Label className="text-xs">سبب تصحيح رقم الفاتورة (إلزامي لسجل التدقيق)</Label>
              <Textarea value={numberChangeReason} onChange={(e) => setNumberChangeReason(e.target.value)}
                placeholder="مثال: تحويل رقم الفاتورة التاريخي إلى التنسيق المعتمد دون تغيير قيمتها" rows={2} />
            </div>
          )}
          {invoiceDateChanged && canChangeIssuedDate && (
            <div>
              <Label className="text-xs">سبب تغيير تاريخ الفاتورة</Label>
              <Textarea
                value={dateChangeReason}
                onChange={(e) => { setOtherFieldsEdited(true); setDateChangeReason(e.target.value); }}
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

          {/* Collection is read-only here; claim_payments is the SSOT. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">المبلغ المحصل</Label>
              <Input
                value={Number(invoice?.paid_amount || 0).toFixed(3)}
                readOnly
                disabled
                dir="ltr"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                يُحدّث تلقائيًا من سندات الدفعات الفعلية ولا يُعدّل من الفاتورة.
              </p>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">ملاحظات (يدوية)</Label>
              <Textarea
                value={notes}
                onChange={(e) => { setOtherFieldsEdited(true); setNotes(e.target.value); }}
                placeholder="ملاحظات إضافية تظهر في الفاتورة..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={update.isPending || correctNumber.isPending}>
            {update.isPending || correctNumber.isPending ? "جارٍ الحفظ..." : invoiceNumberChanged ? "تصحيح رقم الفاتورة" : "حفظ التعديلات"}
          </Button>
        </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
