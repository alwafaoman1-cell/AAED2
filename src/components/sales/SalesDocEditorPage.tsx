import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Plus, Trash2, Save, ArrowLeft, FileSearch, Car, ClipboardList, X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label as ShadLabel } from "@/components/ui/label";
import { toast } from "sonner";
import { getTemplateSettings } from "@/lib/pdfGenerator";
import {
  salesStore,
  makeEmptyDoc,
  calculateTotals,
  cryptoRandom,
  SalesDoc,
  SalesDocType,
  SalesLineItem,
} from "@/lib/salesStore";
import { getWorkOrderById, type WorkOrder } from "@/lib/workOrdersStore";
import { getExpensesForWorkOrder } from "@/lib/expensesStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import { customersStore } from "@/lib/customersStore";
import CustomerAutocomplete from "@/components/customers/CustomerAutocomplete";
import PartAutocomplete from "./PartAutocomplete";
import TemplatePicker from "@/components/print/TemplatePicker";
import WorkOrderPickerDialog from "@/components/workorders/WorkOrderPickerDialog";
import VehiclePickerDialog from "./VehiclePickerDialog";
import ImportItemsFromExcelButton from "./ImportItemsFromExcelButton";

interface Props {
  type: SalesDocType;
  title: string;
  backRoute: string;
  detailRoute: (id: string) => string;
}

/** خيارات شروط الدفع المعتمدة */
const PAYMENT_TERMS_OPTIONS_AR = [
  "نقداً",
  "تحويل بنكي - حساب الشركة",
  "تحويل بنكي - حساب شخصي",
  "آجل / على الحساب",
];
const PAYMENT_TERMS_OPTIONS_EN: Record<string, string> = {
  "نقداً": "Cash",
  "تحويل بنكي - حساب الشركة": "Bank transfer - Company account",
  "تحويل بنكي - حساب شخصي": "Bank transfer - Personal account",
  "آجل / على الحساب": "On account / Credit",
};

function emptyItem(taxRate?: number): SalesLineItem {
  const settings = getTemplateSettings();
  const defaultRate = settings.taxEnabled === false ? 0 : (settings.vatRate ?? 5);
  return { id: cryptoRandom(), description: "", quantity: 1, unitPrice: 0, discount: 0, tax: taxRate ?? defaultRate };
}

export default function SalesDocEditorPage({ type, title, backRoute, detailRoute }: Props) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";

  const [doc, setDoc] = useState<SalesDoc>(() => {
    if (id) {
      const existing = salesStore.get(id);
      if (existing) {
        // ضمان وجود بند واحد على الأقل
        if (!existing.items || existing.items.length === 0) existing.items = [emptyItem()];
        return existing;
      }
      return makeEmptyDoc(type);
    }
    const base = makeEmptyDoc(type);
    base.items = [emptyItem()]; // بند ثابت أول
    base.paymentTerms = "نقداً"; // افتراضي

    // Pre-fill from a Work Order: ?fromWorkOrder=<id>
    const woId = params.get("fromWorkOrder");
    if (woId) {
      const wo = getWorkOrderById(woId);
      if (wo) return applyWorkOrderToDoc(base, wo);
    }
    return base;
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);

  // ===== Tax toggle (per invoice) =====
  const taxSettings = getTemplateSettings();
  const defaultTaxRate = taxSettings.vatRate ?? 5;
  const taxEnabled = (doc.items || []).some((it) => (it.tax || 0) > 0);
  function toggleTax(on: boolean) {
    setDoc((d) => ({
      ...d,
      items: (d.items || []).map((it) => ({ ...it, tax: on ? defaultTaxRate : 0 })),
    }));
    toast.success(on ? `تم تفعيل الضريبة (${defaultTaxRate}%)` : "تم إيقاف الضريبة لهذه الفاتورة");
  }

  function applyWorkOrderToDoc(d: SalesDoc, wo: WorkOrder): SalesDoc {
    const items: SalesLineItem[] = [];
    if ((wo.laborCost ?? 0) > 0) {
      items.push({
        id: cryptoRandom(),
        description: `أجرة عمل — ${wo.serviceType || ""}`.trim(),
        quantity: 1,
        unitPrice: wo.laborCost || 0,
        discount: 0,
        tax: 5,
      });
    }
    let partsAdded = 0;
    (wo.partsNeeded || []).forEach((p) => {
      partsAdded++;
      items.push({
        id: cryptoRandom(),
        description: p.name + (p.notes ? ` — ${p.notes}` : ""),
        quantity: p.quantity || 1,
        unitPrice: 0,
        discount: 0,
        tax: 5,
      });
    });
    // ⬇️ إضافة قطع الغيار من سندات المصروف المرتبطة بأمر العمل (بسعر البيع)
    const expenses = getExpensesForWorkOrder(wo.id).filter(
      (e) => e.partName && (e.unitSellPrice ?? 0) > 0,
    );
    expenses.forEach((e) => {
      partsAdded++;
      items.push({
        id: `EXP::${e.id}`,
        itemName: e.partNumber || e.partName || "قطعة غيار",
        description: `${e.partName ?? ""}${e.partNumber ? ` (#${e.partNumber})` : ""}`.trim() || "قطعة غيار",
        quantity: e.partQty ?? 1,
        unitPrice: e.unitSellPrice ?? 0,
        discount: 0,
        tax: 5,
      });
    });
    // ⬇️ إذا لم تُضَف أي قطعة بشكل تفصيلي ولكن أمر العمل فيه تكلفة قطع، أضِفها كبند إجمالي
    if (partsAdded === 0 && (wo.partsCost ?? 0) > 0) {
      items.push({
        id: cryptoRandom(),
        description: "قطع غيار",
        quantity: 1,
        unitPrice: wo.partsCost || 0,
        discount: 0,
        tax: 5,
      });
    }
    if (items.length === 0) items.push(emptyItem());
    return {
      ...d,
      customerName: wo.customer || d.customerName,
      fromDocId: `WO-${wo.id}`,
      notes: [
        `#WO:${wo.id}`,
        wo.description ? `الوصف: ${wo.description}` : "",
        wo.diagnosis ? `التشخيص: ${wo.diagnosis}` : "",
      ].filter(Boolean).join("\n") || d.notes,
      vehicle: {
        plate: wo.plate,
        make: wo.vehicleType,
        model: wo.model,
        year: wo.year,
        vin: wo.vin,
      },
      items,
    };
  }


  function applyWorkOrder(wo: WorkOrder) {
    setDoc((d) => applyWorkOrderToDoc(d, wo));
    toast.success(isAr ? `تم جلب بيانات أمر العمل ${wo.id}` : `Loaded work order ${wo.id}`);
  }

  function applyVehicle(v: any) {
    setDoc((d) => ({
      ...d,
      customerName: v.owner || d.customerName,
      vehicle: {
        plate: v.plate || "",
        make: (v.type || "").split(" ")[0] || v.type || "",
        model: (v.type || "").split(" ").slice(1).join(" ") || "",
        year: v.year || "",
        vin: v.vin || "",
      },
    }));
    toast.success(isAr ? `تم جلب بيانات السيارة ${v.plate}` : `Loaded vehicle ${v.plate}`);
  }

  function clearVehicle() {
    setDoc((d) => ({ ...d, vehicle: undefined }));
  }

  // إعادة احتساب الإجماليات عند تغير البنود
  useEffect(() => {
    const t = calculateTotals(doc.items);
    setDoc((d) => ({
      ...d,
      ...t,
      balanceDue: Math.max(0, t.total - d.paidTotal),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(doc.items)]);

  function addItem() {
    setDoc((d) => ({ ...d, items: [...d.items, emptyItem()] }));
  }
  function updateItem(idx: number, patch: Partial<SalesLineItem>) {
    setDoc((d) => ({
      ...d,
      items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function removeItem(idx: number) {
    // البند الأول ثابت — لا يُحذف
    if (idx === 0) {
      toast.info(isAr ? "البند الأول إجباري — لا يمكن حذفه" : "First item is required");
      return;
    }
    setDoc((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  }

  function updateVehicle(patch: Partial<NonNullable<SalesDoc["vehicle"]>>) {
    setDoc((d) => ({ ...d, vehicle: { ...(d.vehicle || {}), ...patch } }));
  }

  function save() {
    if (!doc.customerName.trim()) {
      toast.error(isAr ? "اكتب اسم العميل" : "Customer name required");
      return;
    }
    const validItems = doc.items.filter((it) => ((it.itemName || "").trim() || it.description.trim()) && (Number(it.quantity) || 0) > 0);
    if (validItems.length === 0) {
      toast.error(
        isAr
          ? "يجب إضافة بند واحد على الأقل (الوصف + الكمية مطلوبان)"
          : "At least one item required (description + qty)"
      );
      return;
    }
    customersStore.getOrCreateByName(doc.customerName);
    const saved = salesStore.upsert({ ...doc, items: validItems });
    toast.success(isAr ? "تم الحفظ" : "Saved");
    navigate(detailRoute(saved.id));
  }

  const docTypeForTemplate = type === "quote" ? "quote" : "tax_invoice";
  const totals = useMemo(() => calculateTotals(doc.items), [doc.items]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto" dir={isRtl ? "rtl" : "ltr"}>
      {/* ===== Header bar ===== */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(backRoute)}>
            <ArrowLeft className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} />
          </Button>
          <h1 className="text-xl font-bold">{title} — {doc.number}</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tax toggle */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card">
            <Switch
              id="tax-toggle"
              checked={taxEnabled}
              onCheckedChange={toggleTax}
              aria-label="تشغيل/إيقاف الضريبة"
            />
            <ShadLabel htmlFor="tax-toggle" className="text-xs cursor-pointer">
              {isAr ? `ضريبة ${defaultTaxRate}%` : `Tax ${defaultTaxRate}%`}
              <span className={`ms-1.5 text-[10px] font-semibold ${taxEnabled ? "text-success" : "text-muted-foreground"}`}>
                {taxEnabled ? (isAr ? "مفعّلة" : "ON") : (isAr ? "موقوفة" : "OFF")}
              </span>
            </ShadLabel>
          </div>
          <TemplatePicker docType={docTypeForTemplate as any} size="sm" />
          <Button onClick={save} className="gap-2">
            <Save className="h-4 w-4" /> {isAr ? "حفظ" : "Save"}
          </Button>
        </div>
      </div>

      {/* ===== Customer & dates ===== */}
      <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>{isAr ? "العميل" : "Customer"} *</Label>
          <CustomerAutocomplete
            value={doc.customerName}
            onChange={(name) => setDoc({ ...doc, customerName: name })}
            onSelect={(c) =>
              setDoc({
                ...doc,
                customerName: c.name,
                customerAddress: c.address || doc.customerAddress,
                customerTaxNo: (c as any).idNumber || doc.customerTaxNo,
              })
            }
          />
        </div>
        <div>
          <Label>{isAr ? "العنوان" : "Address"}</Label>
          <Input
            value={doc.customerAddress || ""}
            onChange={(e) => setDoc({ ...doc, customerAddress: e.target.value })}
          />
        </div>
        <div>
          <Label>{isAr ? "الرقم الضريبي" : "Tax No."}</Label>
          <Input
            value={doc.customerTaxNo || ""}
            onChange={(e) => setDoc({ ...doc, customerTaxNo: e.target.value })}
          />
        </div>
        <div>
          <Label>{isAr ? "التاريخ" : "Date"}</Label>
          <Input
            type="date"
            value={doc.date}
            onChange={(e) => setDoc({ ...doc, date: e.target.value })}
          />
        </div>
        {type === "invoice" && (
          <div>
            <Label>{isAr ? "تاريخ الاستحقاق" : "Due date"}</Label>
            <Input
              type="date"
              value={doc.dueDate || ""}
              onChange={(e) => setDoc({ ...doc, dueDate: e.target.value })}
            />
          </div>
        )}
        <div>
          <Label>{isAr ? "العملة" : "Currency"}</Label>
          <Select value={doc.currency} onValueChange={(v) => setDoc({ ...doc, currency: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OMR">OMR ر.ع</SelectItem>
              <SelectItem value="USD">USD $</SelectItem>
              <SelectItem value="AED">AED د.إ</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ===== Payment terms (dropdown) ===== */}
        <div className="md:col-span-3">
          <Label>{isAr ? "شروط الدفع" : "Payment terms"}</Label>
          <Select
            value={doc.paymentTerms || "نقداً"}
            onValueChange={(v) => setDoc({ ...doc, paymentTerms: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS_OPTIONS_AR.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {isAr ? opt : PAYMENT_TERMS_OPTIONS_EN[opt]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ===== Vehicle Information ===== */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            {isAr ? "بيانات السيارة" : "Vehicle Information"}
          </h3>
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              className="gap-1.5 text-xs"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              {isAr ? "من أمر عمل" : "From Work Order"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setVehiclePickerOpen(true)}
              className="gap-1.5 text-xs"
            >
              <Car className="h-3.5 w-3.5" />
              {isAr ? "من سيارة عميل" : "From Vehicle"}
            </Button>
            {doc.vehicle && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearVehicle}
                className="gap-1 text-xs text-destructive hover:text-destructive"
              >
                <X className="h-3 w-3" />
                {isAr ? "مسح" : "Clear"}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">
              {isAr ? "الماركة" : "Make"}
            </Label>
            <Input
              value={doc.vehicle?.make || ""}
              onChange={(e) => updateVehicle({ make: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              {isAr ? "الموديل" : "Model"}
            </Label>
            <Input
              value={doc.vehicle?.model || ""}
              onChange={(e) => updateVehicle({ model: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              {isAr ? "السنة" : "Year"}
            </Label>
            <Input
              value={doc.vehicle?.year || ""}
              onChange={(e) => updateVehicle({ year: e.target.value })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              {isAr ? "اللوحة" : "Plate"}
            </Label>
            <Input
              value={doc.vehicle?.plate || ""}
              onChange={(e) => updateVehicle({ plate: e.target.value })}
              className="h-9 font-mono"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">VIN</Label>
            <Input
              value={doc.vehicle?.vin || ""}
              onChange={(e) => updateVehicle({ vin: e.target.value })}
              className="h-9 font-mono"
            />
          </div>
        </div>
      </div>

      {/* ===== Header extra lines (تظهر تحت الهيدر مباشرة قبل البنود) ===== */}
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-primary" />
            {isAr ? "بنود إضافية تحت الهيدر" : "Additional header lines"}
            <span className="text-[10px] text-muted-foreground font-normal">
              {isAr ? "(تظهر فوق جدول الأصناف — مثال: مرجع الطلب، رقم العقد...)" : "(Shown above items)"}
            </span>
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() =>
              setDoc((d) => ({ ...d, headerLines: [...(d.headerLines || []), ""] }))
            }
          >
            <Plus className="h-3 w-3" /> {isAr ? "إضافة سطر" : "Add line"}
          </Button>
        </div>
        {(!doc.headerLines || doc.headerLines.length === 0) ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            {isAr ? "لا توجد بنود إضافية" : "No additional lines"}
          </p>
        ) : (
          <div className="space-y-2">
            {doc.headerLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={line}
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      headerLines: (d.headerLines || []).map((l, i) => (i === idx ? e.target.value : l)),
                    }))
                  }
                  placeholder={isAr ? `سطر ${idx + 1}` : `Line ${idx + 1}`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setDoc((d) => ({
                      ...d,
                      headerLines: (d.headerLines || []).filter((_, i) => i !== idx),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Items ===== */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            {isAr ? "البنود" : "Items"}
            <span className="text-[10px] text-destructive font-normal">
              {isAr ? "* البند الأول إجباري" : "* First item required"}
            </span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <ImportItemsFromExcelButton
              isAr={isAr}
              defaultTax={taxEnabled ? defaultTaxRate : 0}
              onImport={(imported) =>
                setDoc((d) => {
                  // إذا البند الأول فارغ تماماً نستبدله، وإلا نضيف بعده
                  const first = d.items[0];
                  const firstEmpty =
                    !first?.itemName?.trim() &&
                    !first?.description?.trim() &&
                    !(first?.quantity > 0) &&
                    !(first?.unitPrice > 0);
                  const rest = firstEmpty ? d.items.slice(1) : d.items;
                  return { ...d, items: [...imported, ...rest] };
                })
              }
            />
            <Button size="sm" variant="outline" onClick={addItem} className="gap-2">
              <Plus className="h-3 w-3" /> {isAr ? "إضافة بند" : "Add item"}
            </Button>
          </div>
        </div>
        <table className="w-full text-sm table-fixed">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="p-2 text-start w-[22%]">{isAr ? "الصنف / Item" : "Item"}</th>
              <th className="p-2 text-start w-[34%]">{isAr ? "الوصف" : "Description"}</th>
              <th className="p-2 w-[7%]">{isAr ? "الكمية" : "Qty"}</th>
              <th className="p-2 w-[10%]">{isAr ? "السعر" : "Price"}</th>
              <th className="p-2 w-[7%]">{isAr ? "خصم %" : "Disc %"}</th>
              <th className="p-2 w-[7%]">{isAr ? "ض %" : "Tax %"}</th>
              <th className="p-2 w-[10%] text-end">{isAr ? "الإجمالي" : "Total"}</th>
              <th className="p-2 w-[3%]"></th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, idx) => {
              const line = it.quantity * it.unitPrice;
              const disc = (line * (it.discount || 0)) / 100;
              const taxable = line - disc;
              // عمود "الإجمالي" يعرض السعر قبل الضريبة فقط — الضريبة تُجمع مرة واحدة بالأسفل
              const total = taxable;
              const isFirst = idx === 0;
              return (
                <tr key={it.id} className={`border-t align-top ${isFirst ? "bg-primary/5" : ""}`}>
                  <td className="p-2">
                    <PartAutocomplete
                      value={it.itemName || ""}
                      partId={(it as any).inventoryId}
                      onChange={(v) => updateItem(idx, { itemName: v })}
                      onSelect={(p) =>
                        updateItem(idx, {
                          itemName: `${p.name}${p.partNumber ? ` (${p.partNumber})` : ""}`,
                          description: it.description || p.name,
                          unitPrice: p.sellPrice,
                          inventoryId: p.id,
                        } as any)
                      }
                      placeholder={isAr ? "ابحث في المخزن أو اكتب اسم الصنف" : "Search inventory or item name"}
                    />
                  </td>
                  <td className="p-2">
                    <Textarea
                      value={it.description}
                      onChange={(e) => updateItem(idx, { description: e.target.value })}
                      placeholder={isAr ? (isFirst ? "وصف البند (إجباري)" : "وصف تفصيلي") : "Detailed description"}
                      rows={2}
                      className="min-h-[40px] resize-y"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={it.quantity}
                      onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      step="0.001"
                      value={it.unitPrice}
                      onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={it.discount}
                      onChange={(e) => updateItem(idx, { discount: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      value={it.tax}
                      onChange={(e) => updateItem(idx, { tax: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="p-2 text-end font-mono">{total.toFixed(3)}</td>
                  <td className="p-2">
                    {isFirst ? (
                      <span
                        className="inline-flex items-center justify-center h-8 w-8 text-[10px] text-muted-foreground"
                        title={isAr ? "إجباري" : "Required"}
                      >
                        🔒
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(idx)}
                        aria-label={isAr ? "حذف" : "Remove"}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ===== Notes + Totals ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <Label>{isAr ? "ملاحظات" : "Notes"}</Label>
          <Textarea
            value={doc.notes || ""}
            onChange={(e) => setDoc({ ...doc, notes: e.target.value })}
            rows={4}
          />
          <Label className="mt-3 block">{isAr ? "الشروط والأحكام" : "Terms"}</Label>
          <Textarea
            value={doc.terms || ""}
            onChange={(e) => setDoc({ ...doc, terms: e.target.value })}
            rows={3}
          />
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <Row k={isAr ? "الإجمالي قبل الضريبة" : "Subtotal"} v={totals.subtotal} c={doc.currency} />
          <Row k={isAr ? "الخصم" : "Discount"} v={-totals.discountTotal} c={doc.currency} />
          <Row k={isAr ? "الضريبة" : "Tax"} v={totals.taxTotal} c={doc.currency} />
          <div className="border-t pt-2 mt-2">
            <Row k={isAr ? "الإجمالي" : "Total"} v={totals.total} c={doc.currency} bold />
          </div>
          {(doc.paidTotal || 0) > 0 && (
            <>
              <Row k={isAr ? "المدفوع" : "Paid"} v={doc.paidTotal} c={doc.currency} />
              <Row k={isAr ? "المتبقي" : "Balance"} v={Math.max(0, totals.total - doc.paidTotal)} c={doc.currency} bold />
              {doc.payments && doc.payments.length > 0 && (
                <div className="mt-2 p-2 rounded bg-success/10 border border-success/30 text-xs text-center text-success font-semibold">
                  ✓ {isAr ? "تم الدفع عبر:" : "Paid via:"}{" "}
                  {Array.from(new Set(doc.payments.map((p) => p.method).filter(Boolean))).join(" + ")}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== Pickers ===== */}
      <WorkOrderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={applyWorkOrder}
        title={isAr ? "اختر أمر العمل لجلب بياناته" : "Pick a work order"}
        description={isAr ? "سيتم جلب العميل والمركبة والأجرة وقطع الغيار" : "Customer, vehicle, labor and parts will be loaded"}
      />
      <VehiclePickerDialog
        open={vehiclePickerOpen}
        onOpenChange={setVehiclePickerOpen}
        onPick={applyVehicle}
        ownerFilter={doc.customerName}
      />
    </div>
  );
}

function Row({
  k, v, c, bold,
}: { k: string; v: number; c: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold" : "text-sm"}`}>
      <span>{k}</span>
      <span className="font-mono">
        {v.toFixed(3)} {c === "OMR" ? "ر.ع" : c}
      </span>
    </div>
  );
}
