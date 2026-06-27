import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, X, Trash2, Pencil, Plus, Receipt, Package, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  expenseCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";
import { expensesStore, type ExpenseRecord, getExpensesForWorkOrder, getExpensePartProfit } from "@/lib/expensesStore";
import { canManageFinance } from "@/lib/permissions";
import { logActivity } from "@/lib/auditLogStore";
import type { WorkOrder } from "@/lib/workOrdersStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import ExpensePreviewDialog from "@/components/workorders/ExpensePreviewDialog";
import AiExtractButton from "@/components/ai/AiExtractButton";
import AiWriteButton from "@/components/ai/AiWriteButton";
import { writeOperationalAudit } from "@/lib/deletePolicy";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialRequiredPart?: {
    id: string;
    name: string;
    quantity: number;
    notes?: string;
    estimatedUnitPrice?: number;
  } | null;
  onExpenseSaved?: (expense: ExpenseRecord) => void;
}

/** التصنيفات المقترحة لمصروفات أوامر العمل (تطابق ما طلبه المستخدم) */
const SUGGESTED_LABELS = ["قطع غيار المركبات", "عمالة خارجية", "نقل وسحب", "صبغ خارجي", "أخرى"];

/** يضمن وجود التصنيفات المقترحة في expenseCategoriesStore، ويعيد التصنيف الافتراضي ("قطع غيار المركبات") */
function ensureWorkOrderCategories(): string {
  const all = expenseCategoriesStore.getAll();
  let defaultId = "";
  SUGGESTED_LABELS.forEach((name) => {
    const existing = all.find((c) => c.name === name);
    if (!existing) {
      const id = `EC-WO-${name.replace(/\s+/g, "-")}`;
      expenseCategoriesStore.add({
        id,
        name,
        description: "تصنيف مصروفات مرتبطة بأوامر العمل",
        color: "#f59e0b",
        active: true,
        createdAt: new Date().toISOString(),
      });
      if (name === "قطع غيار المركبات") defaultId = id;
    } else {
      if (name === "قطع غيار المركبات") defaultId = existing.id;
    }
  });
  return defaultId;
}

export default function WorkOrderExpenseDialog({ order, open, onOpenChange, initialRequiredPart, onExpenseSaved }: Props) {
  const [, force] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [cashboxId, setCashboxId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [beneficiary, setBeneficiary] = useState("");
  const [supplierTaxNumber, setSupplierTaxNumber] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewExpense, setPreviewExpense] = useState<ExpenseRecord | null>(null);

  // ===== حالة قطع الغيار (تظهر فقط عند تصنيف "قطع غيار المركبات") — إدخال يدوي مستقل عن المخزون =====
  const [partName, setPartName] = useState<string>("");
  const [partNumber, setPartNumber] = useState<string>("");
  const [partQty, setPartQty] = useState<string>("1");
  const [unitBuyPrice, setUnitBuyPrice] = useState<string>("");
  const [unitSellPrice, setUnitSellPrice] = useState<string>("");

  const allowManage = canManageFinance();

  useEffect(() => {
    const subs = [
      expenseCategoriesStore.subscribe(() => force((n) => n + 1)),
      employeeCashboxesStore.subscribe(() => force((n) => n + 1)),
      expensesStore.subscribe(() => force((n) => n + 1)),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // عند فتح الحوار: إنشاء التصنيفات إن لم توجد + تعيين الافتراضي
  useEffect(() => {
    if (open) {
      const def = ensureWorkOrderCategories();
      const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
      const defaultCb = cashboxes.find((c) => c.isDefault) ?? cashboxes[0];
      const settings = voucherSettingsStore.get();
      setCategoryId(def);
      setCashboxId(defaultCb?.id ?? "");
      setPaymentMethod(settings.defaultPaymentMethod);
      setDate(new Date().toISOString().slice(0, 10));
      setAmount("");
      setBeneficiary("");
      setSupplierTaxNumber("");
      setSupplierInvoiceNumber("");
      setDescription("");
      setPhoto(null);
      setEditingId(null);
      setPartName("");
      setPartNumber("");
      setPartQty("1");
      setUnitBuyPrice("");
      setUnitSellPrice("");
      if (initialRequiredPart) {
        const qty = Math.max(1, Number(initialRequiredPart.quantity) || 1);
        const unit = Number(initialRequiredPart.estimatedUnitPrice || 0);
        setPartName(initialRequiredPart.name || "");
        setPartQty(String(qty));
        setUnitBuyPrice(unit > 0 ? String(unit) : "");
        setAmount(unit > 0 ? (unit * qty).toFixed(3) : "");
        setDescription([initialRequiredPart.notes, "Converted from required spare part"].filter(Boolean).join(" — "));
      }
    }
  }, [open, initialRequiredPart]);

  const categories = expenseCategoriesStore.getAll().filter((c) => c.active);
  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);
  const linkedExpenses = useMemo(
    () => (order ? getExpensesForWorkOrder(order.id) : []),
    [order, expensesStore.getAll().length]
  );
  const linkedTotal = linkedExpenses.reduce((s, e) => s + e.amount, 0);
  const linkedProfit = linkedExpenses.reduce((s, e) => s + getExpensePartProfit(e), 0);

  // هل التصنيف الحالي = قطع غيار؟
  const currentCat = categories.find((c) => c.id === categoryId);
  const isPartsCategory = currentCat?.name === "قطع غيار المركبات";

  // مزامنة المبلغ تلقائياً عند تصنيف قطع غيار = سعر الشراء × الكمية (هذا هو المصروف الفعلي)
  useEffect(() => {
    if (isPartsCategory) {
      const qty = parseFloat(partQty) || 0;
      const cost = parseFloat(unitBuyPrice) || 0;
      const total = qty * cost;
      if (total > 0) setAmount(total.toFixed(3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitBuyPrice, partQty, isPartsCategory]);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    setPhoto(await fileToWebpDataUrl(file));
  };

  const startEdit = (rec: ExpenseRecord) => {
    setEditingId(rec.id);
    setDate(rec.date);
    setAmount(String(rec.amount));
    setCategoryId(rec.categoryId);
    setCashboxId(rec.cashboxId);
    setPaymentMethod(rec.paymentMethod);
    setBeneficiary(rec.beneficiary || "");
    setSupplierTaxNumber(rec.supplierTaxNumber || "");
    setSupplierInvoiceNumber(rec.supplierInvoiceNumber || "");
    setDescription(rec.description || "");
    setPhoto(rec.photo || null);
    setPartName(rec.partName || "");
    setPartNumber(rec.partNumber || "");
    setPartQty(rec.partQty ? String(rec.partQty) : "1");
    setUnitBuyPrice(rec.unitBuyPrice != null ? String(rec.unitBuyPrice) : "");
    setUnitSellPrice(rec.unitSellPrice != null ? String(rec.unitSellPrice) : "");
  };

  const resetForm = () => {
    setEditingId(null);
    setAmount("");
    setBeneficiary("");
    setSupplierTaxNumber("");
    setSupplierInvoiceNumber("");
    setDescription("");
    setPhoto(null);
    setPartName("");
    setPartNumber("");
    setPartQty("1");
    setUnitBuyPrice("");
    setUnitSellPrice("");
  };

  const handleSave = async () => {
    if (!order) return;
    const value = parseFloat(amount);
    if (!value || value <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    if (!categoryId) return toast.error("اختر التصنيف");
    if (!cashboxId) return toast.error("اختر الخزينة");

    const cat = categories.find((c) => c.id === categoryId);
    const cb = employeeCashboxesStore.getAll().find((c) => c.id === cashboxId);

    // ===== قطع الغيار (إدخال يدوي مستقل عن المخزون) — جميع الحقول اختيارية =====
    let partsFields: Partial<ExpenseRecord> = {};
    if (isPartsCategory) {
      const qty = partQty ? parseFloat(partQty) : 0;
      const buy = unitBuyPrice ? parseFloat(unitBuyPrice) : 0;
      const sell = unitSellPrice ? parseFloat(unitSellPrice) : 0;
      partsFields = {
        partName: partName.trim() || undefined,
        partNumber: partNumber.trim() || undefined,
        partQty: qty > 0 ? qty : undefined,
        unitBuyPrice: !isNaN(buy) && buy >= 0 ? buy : undefined,
        unitSellPrice: !isNaN(sell) && sell >= 0 ? sell : undefined,
      };
    }

    const supplierFields: Partial<ExpenseRecord> = {
      supplierTaxNumber: supplierTaxNumber.trim() || undefined,
      supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
    };

    if (editingId) {
      const old = expensesStore.getById(editingId);
      if (old) {
        const oldCb = employeeCashboxesStore.getAll().find((c) => c.id === old.cashboxId);
        if (oldCb) employeeCashboxesStore.update(oldCb.id, { currentBalance: oldCb.currentBalance + old.amount });
        if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });
        await expensesStore.update(editingId, {
          date, amount: value, categoryId, categoryName: cat?.name,
          cashboxId, cashboxName: cb?.cashboxName, paymentMethod, beneficiary, description, photo,
          ...supplierFields,
          ...partsFields,
          ...(isPartsCategory ? {} : { partId: undefined, partName: undefined, partNumber: undefined, partQty: undefined, unitBuyPrice: undefined, unitSellPrice: undefined }),
        });
        logActivity({
          action: "update", entity: "expense", entityId: old.voucherNumber,
          label: `${cat?.name || "مصروف"} لأمر العمل ${order.id}`,
          description: `تعديل المبلغ من ${old.amount.toLocaleString()} إلى ${value.toLocaleString()} ر.ع`,
          amount: value, metadata: { workOrderId: order.id },
        });
        onExpenseSaved?.(expensesStore.getById(editingId) || { ...old, amount: value });
        toast.success(`تم تحديث سند الصرف ${old.voucherNumber}`);
      }
      resetForm();
      onOpenChange(false);
      return;
    }

    const number = voucherSettingsStore.generateNextNumber("payment");
    if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance - value });

    const record: ExpenseRecord = {
      id: `EXP-${Date.now()}`,
      voucherNumber: number,
      date, amount: value,
      categoryId, categoryName: cat?.name,
      cashboxId, cashboxName: cb?.cashboxName,
      paymentMethod, beneficiary, description, photo,
      linkedWorkOrderId: order.id,
      // ربط تلقائي للسيارة (مهم لتتبع تكلفة كل سيارة من قطع الغيار)
      linkedVehiclePlate: order.plate,
      linkedVehicleName: `${order.vehicleType} ${order.model} — ${order.plate}`,
      requiredPartId: initialRequiredPart?.id,
      sourceWorkOrderId: order.cloudId || order.id,
      sourceClaimId: order.claimId,
      convertedFromRequiredPart: !!initialRequiredPart,
      ...supplierFields,
      ...partsFields,
      createdAt: new Date().toISOString(),
    };
    await expensesStore.add(record);
    if (initialRequiredPart) {
      void writeOperationalAudit({
        action: "spare_part_converted_to_expense",
        entityType: "required_spare_part",
        entityId: initialRequiredPart.id,
        relatedEntities: {
          expense_id: record.id,
          work_order_id: order.cloudId || order.id,
          claim_id: order.claimId || null,
        },
        reason: "Converted from required spare part",
        beforeSnapshot: initialRequiredPart,
        afterSnapshot: record,
      }).catch((error) => console.warn("[required part audit]", error));
    }

    logActivity({
      action: "create", entity: "expense", entityId: number,
      label: `${cat?.name || "مصروف"} لأمر العمل ${order.id}`,
      description: `إضافة مصروف بقيمة ${value.toLocaleString()} ر.ع — ${beneficiary || "بدون مستفيد"}`,
      amount: value,
      metadata: {
        workOrderId: order.id,
        categoryName: cat?.name,
        requiredPartId: initialRequiredPart?.id,
        convertedFromRequiredPart: !!initialRequiredPart,
      },
    });
    onExpenseSaved?.(record);

    const profitMsg = isPartsCategory && partsFields.unitSellPrice != null && partsFields.unitBuyPrice != null && partsFields.partQty
      ? ` • ربح متوقع: ${(((partsFields.unitSellPrice as number) - (partsFields.unitBuyPrice as number)) * (partsFields.partQty as number)).toFixed(3)} ر.ع`
      : "";
    toast.success(`✓ تم تسجيل المصروف ${number}${profitMsg}`);
    resetForm();
    onOpenChange(false);
  };

  const confirmDelete = () => {
    if (!deleteId || !order) return;
    const rec = expensesStore.getById(deleteId);
    if (rec) {
      const cb = employeeCashboxesStore.getAll().find((c) => c.id === rec.cashboxId);
      if (cb) employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + rec.amount });
      expensesStore.remove(deleteId);
      logActivity({
        action: "delete",
        entity: "expense",
        entityId: rec.voucherNumber,
        label: `${rec.categoryName || "مصروف"} لأمر العمل ${order.id}`,
        description: `حذف سند صرف بقيمة ${rec.amount.toLocaleString()} ر.ع`,
        amount: rec.amount,
        metadata: { workOrderId: order.id },
      });
      toast.success(`تم حذف ${rec.voucherNumber}`);
    }
    setDeleteId(null);
    if (editingId === deleteId) resetForm();
  };

  if (!order) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Receipt className="text-primary" size={20} />
              مصروفات أمر العمل <span className="font-mono text-primary text-sm">{order.id}</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              المركبة: {order.vehicleType} {order.model} — {order.plate} • العميل: {order.customer}
            </p>
          </DialogHeader>

          {/* ملخص */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-secondary/30 border border-border rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">عدد سندات الصرف</p>
              <p className="text-lg font-bold text-foreground">{linkedExpenses.length}</p>
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">إجمالي المصروفات</p>
              <p className="text-lg font-bold text-warning">{linkedTotal.toLocaleString()} ر.ع</p>
            </div>
            <div className="bg-success/10 border border-success/30 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground">ربح قطع الغيار</p>
              <p className={`text-lg font-bold ${linkedProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {linkedProfit.toLocaleString()} ر.ع
              </p>
            </div>
          </div>

          {/* النموذج */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1">
                {editingId ? <><Pencil size={14} /> تعديل سند صرف</> : <><Plus size={14} /> سند صرف جديد</>}
              </h3>
              {editingId && (
                <Button variant="ghost" size="sm" onClick={resetForm}>إلغاء التعديل</Button>
              )}
            </div>

            {/* استخراج بيانات الإيصال بالذكاء الاصطناعي */}
            <AiExtractButton
              schema="expense_receipt"
              label="استخراج بيانات الإيصال بالذكاء"
              hint="ارفع صورة فاتورة/إيصال أو PDF — سيتم تعبئة التاريخ والمبلغ والمورد ورقم الفاتورة والبيان تلقائياً"
              onExtracted={(d) => {
                if (d.date) setDate(d.date);
                if (d.total) setAmount(String(d.total).replace(/[^\d.]/g, ""));
                if (d.vendor) setBeneficiary(d.vendor);
                if (d.invoice_number) setSupplierInvoiceNumber(d.invoice_number);
                if (d.notes || d.category) {
                  setDescription([d.category, d.notes].filter(Boolean).join(" — "));
                }
              }}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">التاريخ</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المبلغ (ر.ع)</Label>
                <Input type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">التصنيف المحاسبي</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">الخزينة</Label>
                <Select value={cashboxId} onValueChange={setCashboxId}>
                  <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
                  <SelectContent>
                    {cashboxes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.cashboxName} — {c.currentBalance.toLocaleString()} ر.ع
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المستفيد / المورد</Label>
                <Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="اسم المستفيد" />
              </div>

              {/* بيانات المورد الضريبية */}
              <div className="space-y-1">
                <Label className="text-xs">الرقم الضريبي للمورد</Label>
                <Input value={supplierTaxNumber} onChange={(e) => setSupplierTaxNumber(e.target.value)} placeholder="OM..." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">رقم فاتورة المورد</Label>
                <Input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} placeholder="INV-..." />
              </div>

              <div className="space-y-1 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">البيان</Label>
                  <AiWriteButton
                    value={description}
                    onChange={setDescription}
                    context={`مصروف لأمر العمل ${order.id} — المركبة ${order.vehicleType} ${order.plate} — مستفيد ${beneficiary || "—"} — مبلغ ${amount || 0} ر.ع`}
                    label="ذكاء"
                    size="sm"
                  />
                </div>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="تفاصيل المصروف..." rows={2} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">صورة الإيصال (اختياري)</Label>
                <Input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
                {photo && <img src={photo} alt="إيصال" className="mt-2 max-h-24 rounded-lg border border-border" />}
              </div>
            </div>

            {/* قسم قطع الغيار — إدخال يدوي مستقل تماماً عن المخزون */}
            {isPartsCategory && (
              <div className="bg-info/5 border border-info/30 rounded-lg p-3 space-y-3">
                <h4 className="text-xs font-semibold text-info flex items-center gap-1">
                  <Package size={14} /> تفاصيل قطعة الغيار (إدخال يدوي)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">اسم القطعة (اختياري)</Label>
                    <Input
                      value={partName}
                      onChange={(e) => setPartName(e.target.value)}
                      placeholder="مثال: فلتر زيت"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">رقم القطعة (اختياري)</Label>
                    <Input
                      value={partNumber}
                      onChange={(e) => setPartNumber(e.target.value)}
                      placeholder="P/N..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">الكمية (اختياري)</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={partQty}
                      onChange={(e) => setPartQty(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">سعر الشراء للوحدة (اختياري)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={unitBuyPrice}
                      onChange={(e) => setUnitBuyPrice(e.target.value)}
                      placeholder="0.000"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">سعر البيع للوحدة (اختياري — يظهر في الفاتورة)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={unitSellPrice}
                      onChange={(e) => setUnitSellPrice(e.target.value)}
                      placeholder="0.000"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">الربح المتوقع</Label>
                    <div className="flex items-center h-9 px-3 rounded-md border border-border bg-success/10 text-success font-bold text-sm">
                      {(() => {
                        const sell = parseFloat(unitSellPrice) || 0;
                        const buy = parseFloat(unitBuyPrice) || 0;
                        const qty = parseFloat(partQty) || 0;
                        return ((sell - buy) * qty).toFixed(3);
                      })()} ر.ع
                      <span className="mr-3 text-[10px] text-muted-foreground font-normal">
                        = (بيع − شراء) × كمية
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ملاحظة: المبلغ أعلاه يُحسب تلقائياً (سعر الشراء × الكمية). سعر البيع يستخدم لحساب الربح في تقرير "ربح قطع الغيار". غير مرتبط بالمخزون.
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border">
              <Button onClick={handleSave} className="gap-2 gradient-gold text-primary-foreground">
                <Save size={14} /> {editingId ? "حفظ التعديلات" : "حفظ سند الصرف"}
              </Button>
            </div>
          </div>

          {/* قائمة المصروفات السابقة */}
          {linkedExpenses.length > 0 && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="bg-secondary/30 px-3 py-2 text-xs font-semibold text-foreground border-b border-border">
                المصروفات المرتبطة بهذا الأمر
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/20 text-muted-foreground">
                    <tr>
                      <th className="text-right p-2">رقم السند</th>
                      <th className="text-right p-2">التاريخ</th>
                      <th className="text-right p-2">اسم المصروف</th>
                      <th className="text-right p-2">التصنيف</th>
                      <th className="text-right p-2">المستفيد</th>
                      <th className="text-right p-2">المبلغ</th>
                      <th className="text-right p-2">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedExpenses.map((e) => {
                      const expenseName =
                        e.partName || e.description || e.beneficiary || e.categoryName || "—";
                      return (
                        <tr
                          key={e.id}
                          onClick={() => setPreviewExpense(e)}
                          className="border-t border-border/50 hover:bg-info/10 cursor-pointer transition-colors"
                          title="اضغط لمعاينة السند"
                        >
                          <td className="p-2 font-mono text-primary">{e.voucherNumber}</td>
                          <td className="p-2">{e.date}</td>
                          <td className="p-2 font-medium text-foreground max-w-[160px] truncate">{expenseName}</td>
                          <td className="p-2 text-muted-foreground">{e.categoryName || "-"}</td>
                          <td className="p-2 text-muted-foreground">{e.beneficiary || "-"}</td>
                          <td className="p-2 font-bold text-warning">{e.amount.toLocaleString()} ر.ع</td>
                          <td className="p-2" onClick={(ev) => ev.stopPropagation()}>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setPreviewExpense(e)}
                                className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info"
                                title="معاينة"
                              >
                                <Eye size={12} />
                              </button>
                              {allowManage && (
                                <>
                                  <button
                                    onClick={() => startEdit(e)}
                                    className="p-1.5 rounded hover:bg-info/10 text-muted-foreground hover:text-info"
                                    title="تعديل"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    onClick={() => setDeleteId(e.id)}
                                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    title="حذف"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X size={14} className="ml-1" /> إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={confirmDelete}
        title="حذف سند الصرف"
        description="سيتم حذف السند نهائياً وإعادة المبلغ للخزينة. لا يمكن التراجع."
      />

      <ExpensePreviewDialog
        expense={previewExpense}
        open={!!previewExpense}
        onOpenChange={(o) => !o && setPreviewExpense(null)}
      />
    </>
  );
}
