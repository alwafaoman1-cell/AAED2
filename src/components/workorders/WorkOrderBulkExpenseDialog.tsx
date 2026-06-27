import { useState, useEffect } from "react";
import { Plus, Trash2, Save, Package, X, Receipt, FileText } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  expenseCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { expensesStore, type ExpenseRecord } from "@/lib/expensesStore";
import { logActivity } from "@/lib/auditLogStore";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { syncWorkOrderInvoiceFromExpenses } from "@/lib/workOrderInvoiceSync";

interface PartLine {
  id: string;
  name: string;
  partNumber: string;
  quantity: string;
  unitBuyPrice: string;
  unitSellPrice: string;
}

interface ExpenseItem {
  id: string;
  date: string;
  categoryId: string;
  cashboxId: string;
  paymentMethod: PaymentMethod;
  beneficiary: string;
  description: string;
  amount: string;
  parts: PartLine[];
}

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

const PARTS_CAT_NAME = "قطع غيار المركبات";

const SUGGESTED_LABELS = [PARTS_CAT_NAME, "عمالة خارجية", "نقل وسحب", "صبغ خارجي", "أخرى"];
function ensureCategories(): string {
  const all = expenseCategoriesStore.getAll();
  let defaultId = "";
  SUGGESTED_LABELS.forEach((name) => {
    const ex = all.find((c) => c.name === name);
    if (!ex) {
      const id = `EC-WO-${name.replace(/\s+/g, "-")}`;
      expenseCategoriesStore.add({
        id, name, description: "تصنيف مصروفات أوامر العمل",
        color: "#f59e0b", active: true, createdAt: new Date().toISOString(),
      });
      if (name === PARTS_CAT_NAME) defaultId = id;
    } else if (name === PARTS_CAT_NAME) defaultId = ex.id;
  });
  return defaultId;
}

const newPart = (): PartLine => ({
  id: `p-${Date.now()}-${Math.random()}`,
  name: "", partNumber: "", quantity: "1", unitBuyPrice: "", unitSellPrice: "",
});

export default function WorkOrderBulkExpenseDialog({ order, open, onOpenChange, onSaved }: Props) {
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [autoInvoice, setAutoInvoice] = useState(true);

  const categories = expenseCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const settings = voucherSettingsStore.get();
  const defaultCb = cashboxes.find((c) => c.isDefault) ?? cashboxes[0];

  const blank = (): ExpenseItem => {
    const partsCatId = categories.find((c) => c.name === PARTS_CAT_NAME)?.id ?? categories[0]?.id ?? "";
    return {
      id: `e-${Date.now()}-${Math.random()}`,
      date: new Date().toISOString().slice(0, 10),
      categoryId: partsCatId,
      cashboxId: defaultCb?.id ?? "",
      paymentMethod: settings.defaultPaymentMethod,
      beneficiary: "",
      description: "",
      amount: "",
      parts: [newPart()],
    };
  };

  useEffect(() => {
    if (open) {
      ensureCategories();
      setItems([blank()]);
    } else {
      setItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addItem = () => setItems((p) => [...p, blank()]);
  const removeItem = (id: string) => setItems((p) => p.filter((i) => i.id !== id));
  const updateItem = (id: string, patch: Partial<ExpenseItem>) =>
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addPart = (itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return;
    updateItem(itemId, { parts: [...it.parts, newPart()] });
  };
  const removePart = (itemId: string, partId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return;
    updateItem(itemId, { parts: it.parts.filter((p) => p.id !== partId) });
  };
  const updatePart = (itemId: string, partId: string, patch: Partial<PartLine>) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return;
    updateItem(itemId, {
      parts: it.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)),
    });
  };

  const isPartsCat = (item: ExpenseItem) => {
    const cat = categories.find((c) => c.id === item.categoryId);
    return cat?.name === PARTS_CAT_NAME;
  };

  const computeAmount = (item: ExpenseItem) => {
    if (isPartsCat(item) && item.parts.length > 0) {
      // المصروف = مجموع سعر الشراء × الكمية
      return item.parts.reduce(
        (s, p) => s + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitBuyPrice) || 0),
        0,
      );
    }
    return parseFloat(item.amount) || 0;
  };

  const computeRevenue = (item: ExpenseItem) => {
    if (!isPartsCat(item)) return 0;
    return item.parts.reduce(
      (s, p) => s + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitSellPrice) || 0),
      0,
    );
  };

  const grandExpense = items.reduce((s, it) => s + computeAmount(it), 0);
  const grandRevenue = items.reduce((s, it) => s + computeRevenue(it), 0);
  const grandProfit = grandRevenue - items.reduce((s, it) => {
    if (!isPartsCat(it)) return s;
    return s + it.parts.reduce(
      (a, p) => a + (parseFloat(p.quantity) || 0) * (parseFloat(p.unitBuyPrice) || 0),
      0,
    );
  }, 0);

  const saveAll = async () => {
    if (!order) return;
    const errors: string[] = [];
    items.forEach((it, idx) => {
      const amt = computeAmount(it);
      if (!it.categoryId) errors.push(`البند ${idx + 1}: لم يُحدّد التصنيف`);
      else if (!it.cashboxId) errors.push(`البند ${idx + 1}: لم تُحدّد الخزينة`);
      else if (amt <= 0) errors.push(`البند ${idx + 1}: المبلغ صفر`);
    });
    if (errors.length) return toast.error(errors[0]);

    let savedCount = 0;
    const createdRecords: ExpenseRecord[] = [];

    try {
    for (const it of items) {
      const cat = categories.find((c) => c.id === it.categoryId);
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === it.cashboxId);
      const partsCat = isPartsCat(it);
      const totalAmt = computeAmount(it);
      const number = voucherSettingsStore.generateNextNumber("payment");
      let savedAmountForItem = 0;

      if (partsCat && it.parts.length > 0) {
        // كل قطعة = سجل منفصل (ربح دقيق + يظهر في الفاتورة)
        for (const [pi, p] of it.parts.entries()) {
          const qty = parseFloat(p.quantity) || 0;
          const buy = parseFloat(p.unitBuyPrice) || 0;
          const sell = parseFloat(p.unitSellPrice) || 0;
          const lineAmt = qty * buy;
          if (qty <= 0 || !p.name.trim()) continue;
          const rec: ExpenseRecord = {
            id: `EXP-${Date.now()}-${pi}-${Math.random().toString(36).slice(2, 6)}`,
            voucherNumber: it.parts.length > 1 ? `${number}-${pi + 1}` : number,
            date: it.date,
            amount: lineAmt,
            categoryId: it.categoryId, categoryName: cat?.name,
            cashboxId: it.cashboxId, cashboxName: cb?.cashboxName,
            paymentMethod: it.paymentMethod,
            beneficiary: it.beneficiary,
            description: `${it.description ? it.description + " — " : ""}${p.name}${p.partNumber ? ` (#${p.partNumber})` : ""}`,
            photo: null,
            linkedWorkOrderId: order.id,
            linkedVehiclePlate: order.plate,
            linkedVehicleName: `${order.vehicleType} ${order.model} — ${order.plate}`,
            partName: p.name,
            partNumber: p.partNumber || undefined,
            partQty: qty,
            unitBuyPrice: buy,
            unitSellPrice: sell > 0 ? sell : undefined,
            createdAt: new Date().toISOString(),
          };
          const saved = await expensesStore.add(rec);
          createdRecords.push(saved || rec);
          savedAmountForItem += lineAmt;
          savedCount++;
        }
      } else {
        const rec: ExpenseRecord = {
          id: `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          voucherNumber: number,
          date: it.date, amount: totalAmt,
          categoryId: it.categoryId, categoryName: cat?.name,
          cashboxId: it.cashboxId, cashboxName: cb?.cashboxName,
          paymentMethod: it.paymentMethod,
          beneficiary: it.beneficiary, description: it.description, photo: null,
          linkedWorkOrderId: order.id,
          linkedVehiclePlate: order.plate,
          linkedVehicleName: `${order.vehicleType} ${order.model} — ${order.plate}`,
          createdAt: new Date().toISOString(),
        };
        const saved = await expensesStore.add(rec);
        createdRecords.push(saved || rec);
        savedAmountForItem += totalAmt;
        savedCount++;
      }
      if (cb && savedAmountForItem > 0) {
        const latest = employeeCashboxesStore.getAll().find((c) => c.id === cb.id) || cb;
        employeeCashboxesStore.update(cb.id, { currentBalance: latest.currentBalance - savedAmountForItem });
      }
      logActivity({
        action: "create", entity: "expense", entityId: number,
        label: `${cat?.name || "مصروف"} لأمر ${order.id}`,
        description: `سند صرف ${totalAmt.toLocaleString()} ر.ع`,
        amount: totalAmt, metadata: { workOrderId: order.id },
      });
    }
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ المصروفات في Supabase");
      return;
    }

    // مزامنة الفاتورة
    let invMsg = "";
    if (autoInvoice) {
      try {
        const result = syncWorkOrderInvoiceFromExpenses(order);
        if (result?.invoice) {
          invMsg = ` • فاتورة ${result.invoice.number} ${result.created ? "أُنشئت" : "حُدّثت"}`;
        }
      } catch (e: any) {
        console.error("invoice sync failed", e);
        if (e?.message?.includes("تأمين")) {
          invMsg = " • (لم تُنشأ فاتورة مبيعات — هذا أمر تأميني، أصدرها من المطالبة)";
        }
      }
    }

    toast.success(`✓ حُفظ ${savedCount} سند بإجمالي ${grandExpense.toLocaleString()} ر.ع${invMsg}`);
    onSaved?.();
    onOpenChange(false);
  };

  if (!order) return null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-w-5xl">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle className="flex items-center gap-2">
          <Receipt size={18} className="text-primary" />
          مصروفات أمر العمل <span className="font-mono text-primary text-sm">{order.id}</span>
        </ResponsiveDialogTitle>
        <p className="text-xs text-muted-foreground">
          {order.vehicleType} {order.model} — {order.plate} • {order.customer}
        </p>
      </ResponsiveDialogHeader>

      <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
        {/* Auto-invoice toggle */}
        <Card className="p-3 bg-success/5 border-success/30">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <Checkbox checked={autoInvoice} onCheckedChange={(v) => setAutoInvoice(!!v)} />
            <FileText size={14} className="text-success" />
            <span className="font-medium">إنشاء/تحديث فاتورة تلقائياً لقطع الغيار (سعر البيع)</span>
          </label>
        </Card>

        {items.map((item, idx) => {
          const partsCat = isPartsCat(item);
          const itemTotal = computeAmount(item);
          const itemRev = computeRevenue(item);
          const itemProfit = itemRev - (partsCat ? itemTotal : 0);

          return (
            <Card key={item.id} className="p-4 border-2 border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="font-semibold text-sm">بند مصروف</span>
                  <span className="text-destructive font-mono font-bold text-sm">
                    شراء: {itemTotal.toLocaleString()} ر.ع
                  </span>
                  {partsCat && itemRev > 0 && (
                    <>
                      <span className="text-success font-mono font-bold text-sm">
                        بيع: {itemRev.toLocaleString()} ر.ع
                      </span>
                      <span className={`font-mono font-bold text-sm ${itemProfit >= 0 ? "text-success" : "text-destructive"}`}>
                        ربح: {itemProfit.toLocaleString()} ر.ع
                      </span>
                    </>
                  )}
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
                  <Label className="text-xs">المستفيد / المورد</Label>
                  <Input value={item.beneficiary} onChange={(e) => updateItem(item.id, { beneficiary: e.target.value })} />
                </div>
                {!partsCat && (
                  <div>
                    <Label className="text-xs">المبلغ (ر.ع)</Label>
                    <Input type="number" step="0.001" value={item.amount}
                      onChange={(e) => updateItem(item.id, { amount: e.target.value })} placeholder="0.000" />
                  </div>
                )}
                <div className="md:col-span-3">
                  <Label className="text-xs">البيان</Label>
                  <Textarea rows={2} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </div>
              </div>

              {partsCat && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Package size={12} /> قطع الغيار ({item.parts.length}) — سعر الشراء = مصروف، سعر البيع = إيراد الفاتورة
                    </Label>
                    <Button type="button" size="sm" variant="outline" onClick={() => addPart(item.id)} className="h-7 gap-1">
                      <Plus size={12} /> إضافة قطعة
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {item.parts.map((p, pi) => {
                      const qty = parseFloat(p.quantity) || 0;
                      const buy = parseFloat(p.unitBuyPrice) || 0;
                      const sell = parseFloat(p.unitSellPrice) || 0;
                      const lineCost = qty * buy;
                      const lineRev = qty * sell;
                      const lineProfit = lineRev - lineCost;
                      return (
                        <div key={p.id} className="grid grid-cols-12 gap-2 items-end bg-muted/30 p-2 rounded-md">
                          <div className="col-span-12 md:col-span-3">
                            <Label className="text-[10px]">اسم القطعة #{pi + 1}</Label>
                            <Input value={p.name} onChange={(e) => updatePart(item.id, p.id, { name: e.target.value })} className="h-8" />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <Label className="text-[10px]">رقم القطعة</Label>
                            <Input value={p.partNumber} onChange={(e) => updatePart(item.id, p.id, { partNumber: e.target.value })} className="h-8" />
                          </div>
                          <div className="col-span-3 md:col-span-1">
                            <Label className="text-[10px]">كمية</Label>
                            <Input type="number" min="1" value={p.quantity} onChange={(e) => updatePart(item.id, p.id, { quantity: e.target.value })} className="h-8" />
                          </div>
                          <div className="col-span-3 md:col-span-2">
                            <Label className="text-[10px]">سعر الشراء</Label>
                            <Input type="number" step="0.001" value={p.unitBuyPrice} onChange={(e) => updatePart(item.id, p.id, { unitBuyPrice: e.target.value })} className="h-8" />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <Label className="text-[10px]">سعر البيع</Label>
                            <Input type="number" step="0.001" value={p.unitSellPrice} onChange={(e) => updatePart(item.id, p.id, { unitSellPrice: e.target.value })} className="h-8 border-success/40" />
                          </div>
                          <div className="col-span-5 md:col-span-1 text-[11px] font-mono text-right">
                            <div className="text-destructive">{lineCost.toLocaleString()}</div>
                            {sell > 0 && <div className={lineProfit >= 0 ? "text-success" : "text-destructive"}>{lineProfit.toLocaleString()}</div>}
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removePart(item.id, p.id)}>
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
        <div className="flex-1 flex flex-wrap gap-3 text-xs">
          <span><span className="text-muted-foreground">شراء: </span><span className="font-bold text-destructive font-mono">{grandExpense.toLocaleString()}</span></span>
          {grandRevenue > 0 && <span><span className="text-muted-foreground">بيع: </span><span className="font-bold text-success font-mono">{grandRevenue.toLocaleString()}</span></span>}
          {grandRevenue > 0 && <span><span className="text-muted-foreground">ربح: </span><span className={`font-bold font-mono ${grandProfit >= 0 ? "text-success" : "text-destructive"}`}>{grandProfit.toLocaleString()}</span></span>}
          <span className="text-muted-foreground">({items.length} بند)</span>
        </div>
        <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
        <Button onClick={saveAll} className="gap-2">
          <Save size={16} /> حفظ الكل
        </Button>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  );
}
