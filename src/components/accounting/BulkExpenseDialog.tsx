import { useState, useEffect } from "react";
import { Plus, Trash2, Save, Package, X } from "lucide-react";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  expenseCategoriesStore, employeeCashboxesStore, voucherSettingsStore,
  PAYMENT_METHOD_LABELS, type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import { logActivity } from "@/lib/auditLogStore";
import SupplierPicker from "@/components/suppliers/SupplierPicker";

interface PartLine {
  id: string;
  name: string;
  partNumber: string;
  quantity: string;
  unitPrice: string;
}

interface ExpenseItem {
  id: string;
  date: string;
  categoryId: string;
  cashboxId: string;
  paymentMethod: PaymentMethod;
  beneficiary: string;
  supplierId?: string;
  supplierTaxNumber?: string;
  description: string;
  amount: string;
  linkedVehiclePlate: string;
  parts: PartLine[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

const newPart = (): PartLine => ({ id: `p-${Date.now()}-${Math.random()}`, name: "", partNumber: "", quantity: "1", unitPrice: "" });

export default function BulkExpenseDialog({ open, onOpenChange, onSaved }: Props) {
  const settings = voucherSettingsStore.get();
  const categories = expenseCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const defaultCb = cashboxes.find((c) => c.isDefault) ?? cashboxes[0];
  const allVehicles = vehiclesStore.getAll();

  const blank = (): ExpenseItem => ({
    id: `e-${Date.now()}-${Math.random()}`,
    date: new Date().toISOString().slice(0, 10),
    categoryId: categories[0]?.id ?? "",
    cashboxId: defaultCb?.id ?? "",
    paymentMethod: settings.defaultPaymentMethod,
    beneficiary: "",
    supplierId: "",
    supplierTaxNumber: "",
    description: "",
    amount: "",
    linkedVehiclePlate: "",
    parts: [],
  });

  const [items, setItems] = useState<ExpenseItem[]>([]);

  useEffect(() => {
    if (open && items.length === 0) setItems([blank()]);
    if (!open) setItems([]);
  }, [open]); // eslint-disable-line

  const addItem = () => setItems((prev) => [...prev, blank()]);
  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const updateItem = (id: string, patch: Partial<ExpenseItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addPart = (itemId: string) =>
    updateItem(itemId, { parts: [...(items.find((i) => i.id === itemId)?.parts || []), newPart()] });
  const removePart = (itemId: string, partId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    updateItem(itemId, { parts: item.parts.filter((p) => p.id !== partId) });
  };
  const updatePart = (itemId: string, partId: string, patch: Partial<PartLine>) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    updateItem(itemId, { parts: item.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) });
  };

  const computeAmount = (item: ExpenseItem) => {
    if (item.parts.length === 0) return parseFloat(item.amount) || 0;
    return item.parts.reduce((s, p) => s + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0), 0);
  };

  const grandTotal = items.reduce((s, it) => s + computeAmount(it), 0);

  const saveAll = async () => {
    const errors: string[] = [];
    items.forEach((it, idx) => {
      const amt = computeAmount(it);
      if (!amt || amt <= 0) errors.push(`البند ${idx + 1}: المبلغ صفر`);
      if (!it.categoryId) errors.push(`البند ${idx + 1}: لم يتم اختيار التصنيف`);
      if (!it.cashboxId) errors.push(`البند ${idx + 1}: لم يتم اختيار الخزينة`);
      if (it.beneficiary.trim() && !it.supplierId) errors.push(`البند ${idx + 1}: اختر المورد من القائمة أو أضف موردًا جديدًا`);
    });
    if (errors.length) return toast.error(errors[0]);

    let saved = 0;
    try {
    for (const it of items) {
      const amt = computeAmount(it);
      const cat = categories.find((c) => c.id === it.categoryId);
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === it.cashboxId);
      const isParts = !!cat && /قطع غيار/.test(cat.name);
      const linkedVehicle = it.linkedVehiclePlate ? allVehicles.find((v) => v.plate === it.linkedVehiclePlate) : undefined;
      const number = voucherSettingsStore.generateNextNumber("payment");
      let savedAmountForItem = 0;

      // إذا فيه قطع → نسجّل كل قطعة كسجل منفصل لتتبع كل قطعة محاسبياً
      if (it.parts.length > 0 && isParts) {
        for (const [pi, p] of it.parts.entries()) {
          const pAmt = (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0);
          if (pAmt <= 0) continue;
          const partNumber = it.parts.length > 1 ? `${number}-${pi + 1}` : number;
          const rec: ExpenseRecord = {
            id: `EXP-${Date.now()}-${pi}-${Math.random()}`,
            voucherNumber: partNumber,
            date: it.date,
            amount: pAmt,
            categoryId: it.categoryId, categoryName: cat?.name,
            cashboxId: it.cashboxId, cashboxName: cb?.cashboxName,
            paymentMethod: it.paymentMethod,
            beneficiary: it.beneficiary,
            supplierId: it.supplierId || undefined,
            supplierName: it.beneficiary || undefined,
            supplierTaxNumber: it.supplierTaxNumber || undefined,
            description: `${it.description ? it.description + " — " : ""}${p.name}${p.partNumber ? ` (#${p.partNumber})` : ""}`,
            photo: null,
            linkedVehiclePlate: it.linkedVehiclePlate || undefined,
            linkedVehicleName: linkedVehicle ? `${linkedVehicle.type} — ${linkedVehicle.plate}` : undefined,
            partName: p.name,
            partNumber: p.partNumber || undefined,
            partQty: parseFloat(p.quantity) || 1,
            unitBuyPrice: parseFloat(p.unitPrice) || 0,
            createdAt: new Date().toISOString(),
          };
          await expensesStore.add(rec);
          savedAmountForItem += pAmt;
          saved++;
        }
      } else {
        const rec: ExpenseRecord = {
          id: `EXP-${Date.now()}-${Math.random()}`,
          voucherNumber: number,
          date: it.date, amount: amt,
          categoryId: it.categoryId, categoryName: cat?.name,
          cashboxId: it.cashboxId, cashboxName: cb?.cashboxName,
          paymentMethod: it.paymentMethod,
          beneficiary: it.beneficiary,
          supplierId: it.supplierId || undefined,
          supplierName: it.beneficiary || undefined,
          supplierTaxNumber: it.supplierTaxNumber || undefined,
          description: it.description, photo: null,
          linkedVehiclePlate: isParts && it.linkedVehiclePlate ? it.linkedVehiclePlate : undefined,
          linkedVehicleName: isParts && linkedVehicle ? `${linkedVehicle.type} — ${linkedVehicle.plate}` : undefined,
          createdAt: new Date().toISOString(),
        };
        await expensesStore.add(rec);
        savedAmountForItem += amt;
        saved++;
      }
      if (cb && savedAmountForItem > 0) {
        const latest = employeeCashboxesStore.getAll().find((c) => c.id === cb.id) || cb;
        employeeCashboxesStore.update(cb.id, { currentBalance: latest.currentBalance - savedAmountForItem });
      }
      logActivity({
        action: "create", entity: "expense", entityId: number,
        label: `${cat?.name || "مصروف"} — ${it.beneficiary || "بدون"}`,
        description: `إضافة سند صرف بقيمة ${amt.toLocaleString()} ر.ع`,
        amount: amt,
      });
    }
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المصروفات في Supabase");
      return;
    }

    toast.success(`تم حفظ ${saved} سند صرف بإجمالي ${grandTotal.toLocaleString()} ر.ع`);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-w-5xl">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle className="flex items-center gap-2">
          <Plus size={18} className="text-primary" /> إضافة عدة بنود مصروف دفعة واحدة
        </ResponsiveDialogTitle>
      </ResponsiveDialogHeader>

      <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
        {items.map((item, idx) => {
          const cat = categories.find((c) => c.id === item.categoryId);
          const isParts = !!cat && /قطع غيار/.test(cat.name);
          const itemTotal = computeAmount(item);

          return (
            <Card key={item.id} className="p-4 border-2 border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="font-semibold text-sm">بند مصروف</span>
                  <span className="text-destructive font-mono font-bold text-sm">
                    {itemTotal.toLocaleString()} ر.ع
                  </span>
                </div>
                {items.length > 1 && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(item.id)}>
                    <X size={14} />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">التاريخ</Label>
                  <Input type="date" value={item.date} onChange={(e) => updateItem(item.id, { date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">التصنيف</Label>
                  <Select value={item.categoryId} onValueChange={(v) => updateItem(item.id, { categoryId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">الخزينة</Label>
                  <Select value={item.cashboxId} onValueChange={(v) => updateItem(item.id, { cashboxId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cashboxes.map((c) => <SelectItem key={c.id} value={c.id}>{c.cashboxName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">طريقة الدفع</Label>
                  <Select value={item.paymentMethod} onValueChange={(v) => updateItem(item.id, { paymentMethod: v as PaymentMethod })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <SupplierPicker
                    supplierId={item.supplierId || ""}
                    supplierName={item.beneficiary}
                    taxNumber={item.supplierTaxNumber}
                    label="المورد"
                    onChange={(supplier) => updateItem(item.id, {
                      supplierId: supplier.id,
                      beneficiary: supplier.name,
                      supplierTaxNumber: supplier.taxNumber || item.supplierTaxNumber,
                    })}
                    onClear={() => updateItem(item.id, { supplierId: "" })}
                  />
                </div>
                {item.parts.length === 0 && (
                  <div>
                    <Label className="text-xs">المبلغ (ر.ع)</Label>
                    <Input type="number" step="0.001" value={item.amount} onChange={(e) => updateItem(item.id, { amount: e.target.value })} placeholder="0.000" />
                  </div>
                )}

                {isParts && (
                  <div className="md:col-span-3">
                    <Label className="text-xs">🚗 السيارة المرتبطة</Label>
                    <Select value={item.linkedVehiclePlate || "__none__"} onValueChange={(v) => updateItem(item.id, { linkedVehiclePlate: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— بدون ربط —</SelectItem>
                        {allVehicles.map((v) => (
                          <SelectItem key={v.id} value={v.plate}>{v.plate} — {v.type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="md:col-span-3">
                  <Label className="text-xs">البيان</Label>
                  <Textarea rows={2} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </div>
              </div>

              {/* Parts sub-list */}
              {isParts && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Package size={12} /> قطع الغيار في هذا السند ({item.parts.length})
                    </Label>
                    <Button type="button" size="sm" variant="outline" onClick={() => addPart(item.id)} className="h-7 gap-1">
                      <Plus size={12} /> إضافة قطعة
                    </Button>
                  </div>
                  {item.parts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">لا توجد قطع — أضف قطعاً أو استخدم المبلغ الإجمالي أعلاه</p>
                  ) : (
                    <div className="space-y-2">
                      {item.parts.map((p, pi) => {
                        const lineTotal = (parseFloat(p.quantity) || 0) * (parseFloat(p.unitPrice) || 0);
                        return (
                          <div key={p.id} className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-2 rounded-md">
                            <div className="col-span-12 md:col-span-4">
                              <Label className="text-[10px]">اسم القطعة #{pi + 1}</Label>
                              <Input value={p.name} onChange={(e) => updatePart(item.id, p.id, { name: e.target.value })} className="h-8" />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <Label className="text-[10px]">رقم القطعة</Label>
                              <Input value={p.partNumber} onChange={(e) => updatePart(item.id, p.id, { partNumber: e.target.value })} className="h-8" />
                            </div>
                            <div className="col-span-3 md:col-span-2">
                              <Label className="text-[10px]">الكمية</Label>
                              <Input type="number" min="1" value={p.quantity} onChange={(e) => updatePart(item.id, p.id, { quantity: e.target.value })} className="h-8" />
                            </div>
                            <div className="col-span-3 md:col-span-2">
                              <Label className="text-[10px]">السعر</Label>
                              <Input type="number" step="0.001" value={p.unitPrice} onChange={(e) => updatePart(item.id, p.id, { unitPrice: e.target.value })} className="h-8" />
                            </div>
                            <div className="col-span-9 md:col-span-1 text-xs font-mono font-bold text-destructive">
                              {lineTotal.toLocaleString()} ر.ع
                            </div>
                            <div className="col-span-3 md:col-span-1 flex justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removePart(item.id, p.id)}>
                                <Trash2 size={12} />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })}

        <Button type="button" variant="outline" onClick={addItem} className="w-full gap-2 border-dashed border-2 h-12">
          <Plus size={16} /> إضافة بند جديد
        </Button>
      </div>

      <ResponsiveDialogFooter className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 text-sm">
          <span className="text-muted-foreground">الإجمالي الكلي: </span>
          <span className="font-bold text-destructive font-mono text-lg">{grandTotal.toLocaleString()} ر.ع</span>
          <span className="text-xs text-muted-foreground mr-2">({items.length} بند)</span>
        </div>
        <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button onClick={saveAll} className="gap-2">
          <Save size={16} /> حفظ كل البنود
        </Button>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
