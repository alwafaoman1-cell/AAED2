import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, Search } from "lucide-react";
import {
  purchaseInvoicesStore,
  nextPurchaseInvoiceId,
  getPurchaseTotals,
  type PurchaseInvoice,
  type PurchaseInvoiceItem,
} from "@/lib/purchaseInvoicesStore";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { postPurchaseInvoice, unpostPurchaseInvoice } from "@/lib/purchaseAccounting";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: PurchaseInvoice | null;
}

const emptyItem: PurchaseInvoiceItem = {
  name: "",
  qty: 1,
  unitPrice: 0,
  taxRate: 5,
  discount: 0,
};

export default function PurchaseInvoiceFormDialog({ open, onOpenChange, editing }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(suppliersStore.getAll());
  const [parts, setParts] = useState<Part[]>(inventoryStore.getAll());
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentDays, setPaymentDays] = useState(0);
  const [items, setItems] = useState<PurchaseInvoiceItem[]>([{ ...emptyItem }]);
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [notes, setNotes] = useState("");
  const [paid, setPaid] = useState(false);

  useEffect(() => suppliersStore.subscribe(() => setSuppliers([...suppliersStore.getAll()])), []);
  useEffect(() => inventoryStore.subscribe(() => setParts([...inventoryStore.getAll()])), []);

  useEffect(() => {
    if (open) {
      if (editing) {
        setSupplierId(editing.supplierId);
        setInvoiceNumber(editing.invoiceNumber);
        setDate(editing.date);
        setPaymentDays(editing.paymentDays || 0);
        setItems(editing.items.length ? editing.items : [{ ...emptyItem }]);
        setDiscount(editing.discount);
        setShipping(editing.shipping);
        setNotes(editing.notes || "");
        setPaid(editing.paid);
      } else {
        setSupplierId(suppliers[0]?.id || "");
        setInvoiceNumber("");
        setDate(new Date().toISOString().slice(0, 10));
        setPaymentDays(0);
        setItems([{ ...emptyItem }]);
        setDiscount(0);
        setShipping(0);
        setNotes("");
        setPaid(false);
      }
    }
  }, [open, editing, suppliers]);

  const totals = useMemo(
    () => getPurchaseTotals({ items, discount, shipping }),
    [items, discount, shipping],
  );

  function updateItem(idx: number, patch: Partial<PurchaseInvoiceItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function pickPart(idx: number, partId: string) {
    const p = parts.find((x) => x.id === partId);
    if (!p) return;
    updateItem(idx, {
      partId: p.id,
      partNumber: p.partNumber,
      name: p.name,
      unitPrice: p.buyPrice,
    });
  }

  function addRow() {
    setItems((arr) => [...arr, { ...emptyItem }]);
  }
  function removeRow(idx: number) {
    setItems((arr) => (arr.length === 1 ? arr : arr.filter((_, i) => i !== idx)));
  }

  function handleSave() {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) {
      toast.error("اختر المورد");
      return;
    }
    const validItems = items.filter((i) => i.name && i.qty > 0);
    if (!validItems.length) {
      toast.error("أضف بنداً واحداً على الأقل");
      return;
    }

    const id = editing?.id || nextPurchaseInvoiceId();
    const inv: PurchaseInvoice = {
      id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      date,
      invoiceNumber,
      paymentDays,
      items: validItems,
      discount,
      shipping,
      notes,
      paid,
      paidAmount: paid ? totals.total : (editing?.paidAmount || 0),
      status: paid ? "paid" : editing?.status === "received" ? "received" : "received",
      createdAt: editing?.createdAt || new Date().toISOString(),
    };

    if (editing) {
      // عكس قيود وأرصدة الفاتورة القديمة قبل إعادة الترحيل
      unpostPurchaseInvoice(editing);
      purchaseInvoicesStore.update(editing.id, inv);
      postPurchaseInvoice(inv);
      toast.success("تم تحديث فاتورة الشراء وإعادة الترحيل المحاسبي");
    } else {
      purchaseInvoicesStore.add(inv);
      postPurchaseInvoice(inv);
      const linked = validItems.filter((i) => i.partId).length;
      toast.success(
        `تم إنشاء فاتورة الشراء ${id}${linked ? ` • تم تحديث ${linked} صنف بالمتوسط المرجّح` : ""}`,
      );
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {editing ? `تعديل فاتورة شراء — ${editing.id}` : "فاتورة شراء جديدة"}
          </DialogTitle>
        </DialogHeader>

        {/* الترويسة */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
          <Field label="المورد *">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-10 w-full rounded-md bg-secondary border border-border px-3 text-sm text-foreground"
            >
              <option value="">اختر مورد...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="رقم فاتورة المورد">
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="bg-secondary border-border" />
          </Field>
          <Field label="التاريخ">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border" />
          </Field>
          <Field label="شروط الدفع (أيام)">
            <Input type="number" value={paymentDays} onChange={(e) => setPaymentDays(Number(e.target.value))} className="bg-secondary border-border" />
          </Field>
        </div>

        {/* جدول البنود */}
        <div className="mt-4 border border-border rounded-lg overflow-hidden">
          <div className="bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground grid grid-cols-12 gap-2">
            <div className="col-span-4">البند</div>
            <div className="col-span-2">سعر الوحدة</div>
            <div className="col-span-1">الكمية</div>
            <div className="col-span-2">الخصم (ر.ع)</div>
            <div className="col-span-1">ضريبة %</div>
            <div className="col-span-1 text-left">المجموع</div>
            <div className="col-span-1"></div>
          </div>
          <div className="divide-y divide-border/40">
            {items.map((it, idx) => {
              const lineSub = it.qty * it.unitPrice - (it.discount || 0);
              const lineTotal = lineSub + (lineSub * (it.taxRate || 0)) / 100;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 p-2 items-center">
                  <div className="col-span-4">
                    <PartPicker
                      parts={parts}
                      value={it.name}
                      partId={it.partId}
                      onText={(v) => updateItem(idx, { name: v, partId: undefined })}
                      onPick={(p) => pickPart(idx, p.id)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.001" value={it.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })} className="h-9 bg-secondary border-border" />
                  </div>
                  <div className="col-span-1">
                    <Input type="number" value={it.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })} className="h-9 bg-secondary border-border" />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.001" value={it.discount} onChange={(e) => updateItem(idx, { discount: Number(e.target.value) })} className="h-9 bg-secondary border-border" />
                  </div>
                  <div className="col-span-1">
                    <Input type="number" value={it.taxRate} onChange={(e) => updateItem(idx, { taxRate: Number(e.target.value) })} className="h-9 bg-secondary border-border" />
                  </div>
                  <div className="col-span-1 text-left text-xs font-mono text-foreground">
                    {lineTotal.toFixed(3)}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => removeRow(idx)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border p-2">
            <Button onClick={addRow} variant="outline" size="sm" className="gap-1 border-border">
              <Plus size={14} /> إضافة بند
            </Button>
          </div>
        </div>

        {/* الإجماليات + الخصم/الشحن */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Field label="خصم على الإجمالي %">
            <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="bg-secondary border-border" />
          </Field>
          <Field label="مصاريف شحن (ر.ع)">
            <Input type="number" step="0.001" value={shipping} onChange={(e) => setShipping(Number(e.target.value))} className="bg-secondary border-border" />
          </Field>
          <div className="bg-secondary/40 border border-border rounded-lg p-3 text-xs space-y-1">
            <Row label="المجموع الفرعي" value={`${totals.subtotal.toFixed(3)} ر.ع`} />
            <Row label="الضريبة" value={`${totals.tax.toFixed(3)} ر.ع`} />
            <Row label="خصم" value={`-${totals.discountAmt.toFixed(3)} ر.ع`} />
            <Row label="شحن" value={`${shipping.toFixed(3)} ر.ع`} />
            <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold text-sm text-primary">
              <span>الإجمالي</span>
              <span>{totals.total.toFixed(3)} ر.ع</span>
            </div>
          </div>
        </div>

        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-secondary border-border" />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
          <span className="text-foreground">تم الدفع بالفعل إلى المورد</span>
        </label>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ الفاتورة</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}

function PartPicker({
  parts, value, partId, onText, onPick,
}: {
  parts: Part[]; value: string; partId?: string;
  onText: (v: string) => void; onPick: (p: Part) => void;
}) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return parts.slice(0, 6);
    return parts
      .filter((p) => p.name.toLowerCase().includes(q) || p.partNumber.toLowerCase().includes(q))
      .slice(0, 8);
  }, [value, parts]);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={value}
          onChange={(e) => { onText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="اسم القطعة أو رقمها..."
          className="h-9 pr-7 bg-secondary border-border"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-[min(28rem,90vw)] right-0 bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(p); setOpen(false); }}
              className="w-full text-right px-3 py-2 text-xs border-b border-border/50 last:border-0 hover:bg-secondary flex justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{p.partNumber}</div>
              </div>
              <div className="text-left">
                <div className="text-primary font-semibold">{p.buyPrice.toFixed(3)} ر.ع</div>
                <div className="text-[10px] text-muted-foreground">متوفر: {p.stock}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
