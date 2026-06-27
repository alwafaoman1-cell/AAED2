import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Eye, Save, FileText, AlertTriangle, Car, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import PartAutocomplete from "./PartAutocomplete";
import CustomerAutocomplete from "@/components/customers/CustomerAutocomplete";
import { inventoryStore } from "@/lib/inventoryStore";
import { customersStore } from "@/lib/customersStore";
import WorkOrderPickerDialog from "@/components/workorders/WorkOrderPickerDialog";
import VehiclePickerDialog from "./VehiclePickerDialog";
import { saveVehicleToCloud, vehiclesStore } from "@/lib/vehiclesStore";
import { getWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";
import { stockMovementsStore } from "@/lib/stockMovementsStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  inventoryId?: string;
}

export interface CustomField {
  id: string;
  label: string;
  value: string;
}

/** بيانات السيارة المهيكلة (تحلّ محل الـ customFields الجامدة) */
export interface VehicleInfo {
  make: string;          // الماركة
  model: string;         // الموديل
  year: string;          // السنة
  color: string;         // اللون
  plate: string;         // رقم اللوحة
  vin: string;           // رقم الهيكل
  mileage: string;       // العداد
  workOrderId: string;   // أمر العمل المرتبط
  technician: string;    // الفني
  insurance: string;     // شركة التأمين
  claimNumber: string;   // رقم المطالبة
  serviceDate: string;   // تاريخ الخدمة
}

const EMPTY_VEHICLE: VehicleInfo = {
  make: "", model: "", year: "", color: "", plate: "", vin: "",
  mileage: "", workOrderId: "", technician: "", insurance: "",
  claimNumber: "", serviceDate: "",
};

export interface InvoiceFormData {
  docType: "invoice" | "quote";
  template: "default" | "modern" | "classic";
  number: string;
  issueDate: string;
  dueDate: string;
  customer: string;
  paymentTerms: string;
  vehicle: VehicleInfo;
  /** للحقول الإضافية الحرة (تبقى للتوافق الخلفي + إضافات المستخدم) */
  customFields: CustomField[];
  items: InvoiceLineItem[];
  globalDiscount: number;
  notes: string;
  /** ID أمر العمل المرتبط (للكشف عن عدم التطابق) */
  linkedWorkOrderId?: string;
  /** ID/plate السيارة الأصلية في النظام (للسؤال عن تحديث البطاقة) */
  linkedVehiclePlate?: string;
}

interface Props {
  initial?: Partial<InvoiceFormData>;
  onSave: (data: InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number }) => void;
  onPreview: (data: InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number }) => void;
  onCancel?: () => void;
}

const newId = () => Math.random().toString(36).slice(2, 9);

/** يستخرج VehicleInfo من حقول initial.customFields القديمة (توافق خلفي مع الكود السابق). */
function extractVehicleFromCustomFields(fields?: CustomField[]): Partial<VehicleInfo> {
  if (!fields?.length) return {};
  const map: Record<string, keyof VehicleInfo> = {
    "vehicle make": "make", "الماركة": "make",
    "model": "model", "الموديل": "model",
    "year": "year", "السنة": "year",
    "color": "color", "اللون": "color",
    "reg. no": "plate", "plate": "plate", "رقم اللوحة": "plate",
    "vin": "vin", "رقم الهيكل": "vin",
    "mileage": "mileage", "العداد": "mileage",
    "work order": "workOrderId", "أمر العمل": "workOrderId",
    "technician": "technician", "الفني": "technician",
    "insurance": "insurance", "شركة التأمين": "insurance",
    "claim no": "claimNumber", "claim number": "claimNumber", "رقم المطالبة": "claimNumber",
  };
  const out: Partial<VehicleInfo> = {};
  for (const f of fields) {
    if (!f.value?.trim()) continue;
    const key = (f.label || "").toLowerCase();
    for (const k in map) {
      if (key.includes(k)) {
        out[map[k]] = f.value;
        break;
      }
    }
  }
  return out;
}

export default function InvoiceEditor({ initial, onSave, onPreview, onCancel }: Props) {
  const [showWoPicker, setShowWoPicker] = useState(false);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [pendingSave, setPendingSave] = useState<null | (InvoiceFormData & { subtotal: number; discountTotal: number; taxTotal: number; total: number })>(null);

  const [form, setForm] = useState<InvoiceFormData>(() => {
    const legacyVehicle = extractVehicleFromCustomFields(initial?.customFields);
    return {
      docType: initial?.docType || "invoice",
      template: initial?.template || "default",
      number: initial?.number || "",
      issueDate: initial?.issueDate || new Date().toISOString().split("T")[0],
      dueDate: initial?.dueDate || "",
      customer: initial?.customer || "",
      paymentTerms: initial?.paymentTerms || "نقداً عند الاستلام / Cash on delivery",
      vehicle: { ...EMPTY_VEHICLE, ...legacyVehicle, ...(initial?.vehicle || {}) },
      customFields: initial?.customFields?.filter((c) => {
        // نحتفظ فقط بالحقول الإضافية التي ليست بيانات سيارة معروفة
        const lbl = (c.label || "").toLowerCase();
        return !["vehicle make", "الماركة", "model", "الموديل", "year", "السنة",
          "color", "اللون", "reg. no", "plate", "رقم اللوحة", "vin", "رقم الهيكل",
          "mileage", "العداد", "work order", "أمر العمل", "technician", "الفني",
          "insurance", "شركة التأمين", "claim no", "claim number", "رقم المطالبة"].some((k) => lbl.includes(k));
      }) || [],
      items: initial?.items || [{ id: newId(), description: "", quantity: 1, unitPrice: 0, discount: 0, tax: 5 }],
      globalDiscount: initial?.globalDiscount ?? 0,
      notes: initial?.notes || "",
      linkedWorkOrderId: initial?.linkedWorkOrderId,
      linkedVehiclePlate: initial?.linkedVehiclePlate || initial?.vehicle?.plate || legacyVehicle.plate,
    };
  });

  // ===== كشف عدم التطابق مع أمر العمل المرتبط =====
  const mismatch = useMemo(() => {
    if (!form.linkedWorkOrderId) return null;
    const order = getWorkOrders().find((o) => o.id === form.linkedWorkOrderId);
    if (!order) return null;
    const diffs: string[] = [];
    const cmp = (a?: string, b?: string) => (a || "").trim() !== (b || "").trim();
    if (cmp(form.vehicle.plate, order.plate)) diffs.push("رقم اللوحة");
    if (cmp(form.vehicle.vin, order.vin)) diffs.push("رقم الهيكل (VIN)");
    if (cmp(form.vehicle.make, order.vehicleType)) diffs.push("الماركة");
    if (cmp(form.vehicle.model, order.model)) diffs.push("الموديل");
    if (cmp(form.vehicle.year, order.year)) diffs.push("السنة");
    if (cmp(form.vehicle.color, order.color)) diffs.push("اللون");
    if (cmp(form.vehicle.technician, order.technician)) diffs.push("الفني");
    if (cmp(form.vehicle.insurance, order.insurance)) diffs.push("شركة التأمين");
    if (cmp(form.vehicle.claimNumber, order.claimNumber)) diffs.push("رقم المطالبة");
    if (cmp(form.customer, order.customer)) diffs.push("اسم العميل");
    return diffs.length ? diffs : null;
  }, [form.linkedWorkOrderId, form.vehicle, form.customer]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    form.items.forEach((i) => {
      const line = i.quantity * i.unitPrice;
      const lineDiscount = (line * i.discount) / 100;
      const afterDiscount = line - lineDiscount;
      const lineTax = (afterDiscount * i.tax) / 100;
      subtotal += line;
      discountTotal += lineDiscount;
      taxTotal += lineTax;
    });
    const globalDisc = ((subtotal - discountTotal) * form.globalDiscount) / 100;
    discountTotal += globalDisc;
    const total = subtotal - discountTotal + taxTotal;
    return { subtotal, discountTotal, taxTotal, total };
  }, [form]);

  function updateItem(id: string, patch: Partial<InvoiceLineItem>) {
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }
  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { id: newId(), description: "", quantity: 1, unitPrice: 0, discount: 0, tax: 5 }] }));
  }
  function removeItem(id: string) {
    setForm((f) => ({ ...f, items: f.items.filter((i) => i.id !== id) }));
  }
  function addCustom() {
    setForm((f) => ({ ...f, customFields: [...f.customFields, { id: newId(), label: "حقل جديد / New Field", value: "" }] }));
  }
  function updateCustom(id: string, patch: Partial<CustomField>) {
    setForm((f) => ({ ...f, customFields: f.customFields.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }
  function removeCustom(id: string) {
    setForm((f) => ({ ...f, customFields: f.customFields.filter((c) => c.id !== id) }));
  }
  function updateVehicle<K extends keyof VehicleInfo>(key: K, value: VehicleInfo[K]) {
    setForm((f) => ({ ...f, vehicle: { ...f.vehicle, [key]: value } }));
  }
  function clearVehicle() {
    setForm((f) => ({
      ...f,
      vehicle: { ...EMPTY_VEHICLE, serviceDate: f.vehicle.serviceDate },
      linkedWorkOrderId: undefined,
      linkedVehiclePlate: undefined,
    }));
    toast.info("تم مسح بيانات السيارة");
  }

  // ===== جلب من أمر العمل =====
  function pickFromWorkOrder(o: WorkOrder) {
    // بنود تلقائية: قطع الغيار من حركات المخزن + سطر أجور
    const movements = stockMovementsStore.getAll().filter(
      (m) => m.type === "OUT" && (m.reference === o.id || (m.notes || "").includes(o.id))
    );
    const partsItems: InvoiceLineItem[] = [];
    const seen = new Map<string, InvoiceLineItem>();
    movements.forEach((mv) => {
      mv.items.forEach((it: any) => {
        const key = it.partNumber || it.name;
        const existing = seen.get(key);
        if (existing) {
          existing.quantity += it.qty || 0;
        } else {
          const li: InvoiceLineItem = {
            id: newId(),
            description: `${it.name}${it.partNumber ? ` (${it.partNumber})` : ""}`,
            quantity: it.qty || 0,
            unitPrice: it.unitPrice || 0,
            discount: 0,
            tax: 5,
            inventoryId: it.inventoryId,
          };
          seen.set(key, li);
          partsItems.push(li);
        }
      });
    });

    // إذا لم نجد قطعاً مفصلة → سطر مجمع
    const newItems: InvoiceLineItem[] = [];
    if (Number(o.laborCost) > 0) {
      newItems.push({
        id: newId(),
        description: `أجور عمالة — أمر العمل ${o.id}`,
        quantity: 1,
        unitPrice: Number(o.laborCost) || 0,
        discount: 0,
        tax: 5,
      });
    }
    if (partsItems.length > 0) {
      newItems.push(...partsItems);
    } else if (Number(o.partsCost) > 0) {
      newItems.push({
        id: newId(),
        description: `قطع غيار — أمر العمل ${o.id}`,
        quantity: 1,
        unitPrice: Number(o.partsCost) || 0,
        discount: 0,
        tax: 5,
      });
    }

    setForm((f) => ({
      ...f,
      customer: o.customer || f.customer,
      vehicle: {
        make: o.vehicleType || "",
        model: o.model || "",
        year: o.year || "",
        color: o.color || "",
        plate: o.plate || "",
        vin: o.vin || "",
        mileage: o.mileage || "",
        workOrderId: o.id,
        technician: o.technician || "",
        insurance: o.insurance || "",
        claimNumber: o.claimNumber || "",
        serviceDate: o.entryDate || f.vehicle.serviceDate,
      },
      items: newItems.length > 0 ? newItems : f.items,
      linkedWorkOrderId: o.id,
      linkedVehiclePlate: o.plate,
    }));
    toast.success(`تم جلب بيانات أمر العمل ${o.id}`);
  }

  // ===== جلب من سيارة عميل =====
  function pickFromVehicle(v: any) {
    setForm((f) => ({
      ...f,
      customer: v.owner || f.customer,
      vehicle: {
        ...f.vehicle,
        make: (v.type || "").split(" ")[0] || v.type || "",
        model: (v.type || "").split(" ").slice(1, -1).join(" ") || "",
        year: v.year || "",
        color: v.color || "",
        plate: v.plate || "",
        vin: v.vin || "",
        mileage: v.mileage || "",
      },
      linkedVehiclePlate: v.plate,
    }));
    toast.success(`تم جلب بيانات السيارة ${v.plate}`);
  }

  function fmt(n: number) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function validate(): boolean {
    if (!form.customer.trim()) { toast.error("اختر / أدخل اسم العميل"); return false; }
    if (form.items.length === 0 || form.items.every((i) => !i.description.trim())) {
      toast.error("أضف بنداً واحداً على الأقل"); return false;
    }
    return true;
  }

  /** يفحص هل تغيّرت بيانات السيارة عن البطاقة الأصلية في النظام؟ */
  function vehicleChangedVsStore(): boolean {
    if (!form.linkedVehiclePlate) return false;
    const orig = vehiclesStore.getAll().find((x) => x.plate === form.linkedVehiclePlate);
    if (!orig) return false;
    const cmp = (a?: string, b?: string) => (a || "").trim() !== (b || "").trim();
    return (
      cmp(form.vehicle.vin, orig.vin) ||
      cmp(form.vehicle.year, orig.year) ||
      cmp(form.vehicle.color, orig.color) ||
      cmp(form.vehicle.mileage, orig.mileage) ||
      cmp(`${form.vehicle.make} ${form.vehicle.model}`.trim(), (orig.type || "").trim())
    );
  }

  /** يبني قائمة customFields نهائية تشمل بيانات السيارة (لتظهر في الـ PDF). */
  function buildOutputCustomFields(): CustomField[] {
    const v = form.vehicle;
    const vehicleFields: CustomField[] = [];
    const push = (label: string, value: string) => {
      if (value && value.trim()) vehicleFields.push({ id: newId(), label, value });
    };
    const makeModel = [v.make, v.model, v.year].filter(Boolean).join(" ");
    push("Vehicle / المركبة", makeModel);
    push("Color / اللون", v.color);
    push("Reg. No / رقم اللوحة", v.plate);
    push("VIN / رقم الهيكل", v.vin);
    push("Mileage / العداد", v.mileage);
    push("Service Date / تاريخ الخدمة", v.serviceDate);
    push("Work Order / أمر العمل", v.workOrderId);
    push("Technician / الفني", v.technician);
    push("Insurance / شركة التأمين", v.insurance);
    push("Claim No / رقم المطالبة", v.claimNumber);
    return [...vehicleFields, ...form.customFields];
  }

  async function commitSave(updateVehicleCard: boolean) {
    const data = { ...form, customFields: buildOutputCustomFields(), ...totals };
    customersStore.getOrCreateByName(data.customer);
    if (updateVehicleCard && data.linkedVehiclePlate) {
      const orig = vehiclesStore.getAll().find((x) => x.plate === data.linkedVehiclePlate);
      if (orig) {
        await saveVehicleToCloud({
          ...orig,
          vin: data.vehicle.vin || orig.vin,
          year: data.vehicle.year || orig.year,
          color: data.vehicle.color || orig.color,
          mileage: data.vehicle.mileage || orig.mileage,
          type: `${data.vehicle.make} ${data.vehicle.model}`.trim() || orig.type,
        });
        toast.success("تم تحديث بطاقة السيارة في النظام");
      }
    }
    onSave(data);
    setPendingSave(null);
  }

  async function handleSave() {
    if (!validate()) return;
    if (vehicleChangedVsStore()) {
      setPendingSave({ ...form, customFields: buildOutputCustomFields(), ...totals });
      return;
    }
    try {
      await commitSave(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ الفاتورة");
    }
  }
  function handlePreview() {
    if (!validate()) return;
    onPreview({ ...form, customFields: buildOutputCustomFields(), ...totals });
  }

  // ===== Vehicle field renderer =====
  const isInsuranceDoc = form.docType === "quote" || !!form.vehicle.insurance;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="text-primary" size={20} />
          <h2 className="text-lg font-bold text-foreground">
            {form.docType === "invoice" ? "فاتورة جديدة / New Invoice" : "عرض سعر جديد / New Quote"}
          </h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePreview} className="gap-1.5">
            <Eye size={14} /> معاينة / Preview
          </Button>
          <Button size="sm" onClick={handleSave} className="gradient-gold text-primary-foreground gap-1.5 hover:opacity-90">
            <Save size={14} /> حفظ / Save
          </Button>
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>}
        </div>
      </div>

      {/* Top settings */}
      <div className="grid md:grid-cols-3 gap-3 bg-secondary/20 border border-border rounded-lg p-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">نوع المستند / Document Type</Label>
          <Select value={form.docType} onValueChange={(v: "invoice" | "quote") => setForm({ ...form, docType: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invoice">فاتورة / Invoice</SelectItem>
              <SelectItem value="quote">عرض سعر / Quote</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">قالب الطباعة / Template</Label>
          <Select value={form.template} onValueChange={(v: "default" | "modern" | "classic") => setForm({ ...form, template: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">افتراضي / Default</SelectItem>
              <SelectItem value="modern">حديث / Modern</SelectItem>
              <SelectItem value="classic">كلاسيكي / Classic</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">رقم المستند / Number</Label>
          <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="00095" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">العميل / Customer</Label>
          <CustomerAutocomplete
            value={form.customer}
            onChange={(v) => setForm({ ...form, customer: v })}
            onSelect={(c) => setForm({ ...form, customer: c.name })}
            placeholder="اسم العميل"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">تاريخ الإصدار / Issue Date</Label>
          <Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">تاريخ الاستحقاق / Due Date</Label>
          <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label className="text-xs text-muted-foreground">شروط الدفع / Payment Terms</Label>
          <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
        </div>
      </div>

      {/* ===== Vehicle Information ===== */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Car size={16} className="text-primary" /> بيانات السيارة / Vehicle Information
            {form.linkedWorkOrderId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono">
                {form.linkedWorkOrderId}
              </span>
            )}
          </h3>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowWoPicker(true)}
              className="gap-1.5 text-xs"
            >
              <ClipboardList size={13} /> من أمر عمل
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowVehiclePicker(true)}
              className="gap-1.5 text-xs"
            >
              <Car size={13} /> من سيارة عميل
            </Button>
            {(form.linkedWorkOrderId || form.linkedVehiclePlate) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearVehicle}
                className="gap-1 text-xs text-destructive hover:text-destructive"
              >
                <X size={13} /> مسح
              </Button>
            )}
          </div>
        </div>

        {/* Mismatch alert */}
        {mismatch && mismatch.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/40">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-foreground">
              <div className="font-semibold text-warning mb-0.5">
                تنبيه: البيانات لا تطابق أمر العمل {form.linkedWorkOrderId}
              </div>
              <div className="text-muted-foreground">
                الحقول المختلفة: <span className="text-warning font-medium">{mismatch.join("، ")}</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">الماركة / Make</Label>
            <Input value={form.vehicle.make} onChange={(e) => updateVehicle("make", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">الموديل / Model</Label>
            <Input value={form.vehicle.model} onChange={(e) => updateVehicle("model", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">السنة / Year</Label>
            <Input value={form.vehicle.year} onChange={(e) => updateVehicle("year", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">اللون / Color</Label>
            <Input value={form.vehicle.color} onChange={(e) => updateVehicle("color", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">رقم اللوحة / Plate</Label>
            <Input value={form.vehicle.plate} onChange={(e) => updateVehicle("plate", e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-[11px] text-muted-foreground">رقم الهيكل / VIN</Label>
            <Input value={form.vehicle.vin} onChange={(e) => updateVehicle("vin", e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">العداد / Mileage</Label>
            <Input value={form.vehicle.mileage} onChange={(e) => updateVehicle("mileage", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">الفني / Technician</Label>
            <Input value={form.vehicle.technician} onChange={(e) => updateVehicle("technician", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">تاريخ الخدمة / Service Date</Label>
            <Input type="date" value={form.vehicle.serviceDate} onChange={(e) => updateVehicle("serviceDate", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">أمر العمل / Work Order</Label>
            <Input value={form.vehicle.workOrderId} onChange={(e) => updateVehicle("workOrderId", e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">شركة التأمين / Insurance</Label>
            <Input value={form.vehicle.insurance} onChange={(e) => updateVehicle("insurance", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">رقم المطالبة / Claim No.</Label>
            <Input value={form.vehicle.claimNumber} onChange={(e) => updateVehicle("claimNumber", e.target.value)} className="h-9 font-mono" />
          </div>
        </div>
      </div>

      {/* Custom Fields (extras only) */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">حقول إضافية / Additional Fields</h3>
          <Button size="sm" variant="outline" onClick={addCustom} className="gap-1 text-xs"><Plus size={12} /> إضافة</Button>
        </div>
        {form.customFields.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">لا توجد حقول إضافية. استخدم زر "إضافة" لأي معلومات أخرى.</p>
        ) : (
          <div className="space-y-2">
            {form.customFields.map((c) => (
              <div key={c.id} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-5" value={c.label} onChange={(e) => updateCustom(c.id, { label: e.target.value })} placeholder="اسم الحقل" />
                <Input className="col-span-6" value={c.value} onChange={(e) => updateCustom(c.id, { value: e.target.value })} placeholder="القيمة" />
                <button onClick={() => removeCustom(c.id)} className="col-span-1 p-2 rounded-md hover:bg-destructive/10 text-destructive justify-self-center">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">البنود / Line Items</h3>
          <Button size="sm" variant="outline" onClick={addItem} className="gap-1 text-xs"><Plus size={12} /> إضافة بند</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-right py-2 px-2 font-medium min-w-[260px]">الوصف / Description</th>
                <th className="text-center py-2 px-2 font-medium w-20">الكمية / Qty</th>
                <th className="text-center py-2 px-2 font-medium w-28">السعر / Price</th>
                <th className="text-center py-2 px-2 font-medium w-20">خصم %</th>
                <th className="text-center py-2 px-2 font-medium w-20">ضريبة %</th>
                <th className="text-center py-2 px-2 font-medium w-28">الإجمالي / Total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((i) => {
                const line = i.quantity * i.unitPrice;
                const afterDisc = line - (line * i.discount) / 100;
                // إجمالي السطر قبل الضريبة فقط (الضريبة تُحتسب مرة واحدة في صندوق الإجماليات)
                const lineTotal = afterDisc;
                const linkedPart = i.inventoryId ? inventoryStore.getById(i.inventoryId) : undefined;
                const overStock = !!linkedPart && i.quantity > linkedPart.stock;
                return (
                  <tr key={i.id} className="border-b border-border/40 align-top">
                    <td className="py-1.5 px-2">
                      <PartAutocomplete
                        value={i.description}
                        partId={i.inventoryId}
                        onChange={(v) => updateItem(i.id, { description: v, inventoryId: undefined })}
                        onSelect={(p) =>
                          updateItem(i.id, {
                            description: `${p.name} (${p.partNumber})`,
                            unitPrice: p.sellPrice,
                            inventoryId: p.id,
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={i.quantity}
                        onChange={(e) => updateItem(i.id, { quantity: parseFloat(e.target.value) || 0 })}
                        className={`h-9 text-center ${overStock ? "border-warning" : ""}`}
                      />
                      {overStock && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-warning">
                          <AlertTriangle size={10} /> أكبر من المتوفر ({linkedPart?.stock})
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2"><Input type="number" min={0} step="0.001" value={i.unitPrice} onChange={(e) => updateItem(i.id, { unitPrice: parseFloat(e.target.value) || 0 })} className="h-9 text-center" /></td>
                    <td className="py-1.5 px-2"><Input type="number" min={0} max={100} value={i.discount} onChange={(e) => updateItem(i.id, { discount: parseFloat(e.target.value) || 0 })} className="h-9 text-center" /></td>
                    <td className="py-1.5 px-2"><Input type="number" min={0} max={100} value={i.tax} onChange={(e) => updateItem(i.id, { tax: parseFloat(e.target.value) || 0 })} className="h-9 text-center" /></td>
                    <td className="py-1.5 px-2 text-center text-xs font-medium text-foreground">{fmt(lineTotal)} ر.ع</td>
                    <td className="py-1.5 px-2 text-center"><button onClick={() => removeItem(i.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals + Notes */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <Label className="text-xs text-muted-foreground">ملاحظات / Notes</Label>
          <Textarea rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="شروط أو ملاحظات إضافية..." />
        </div>
        <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">المجموع الفرعي / Subtotal</span><span className="text-foreground font-medium">{fmt(totals.subtotal)} ر.ع</span></div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">خصم إجمالي %</span>
            <Input type="number" min={0} max={100} value={form.globalDiscount} onChange={(e) => setForm({ ...form, globalDiscount: parseFloat(e.target.value) || 0 })} className="h-8 w-24 text-center" />
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">إجمالي الخصم / Discount</span><span className="text-destructive font-medium">- {fmt(totals.discountTotal)} ر.ع</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">الضريبة / VAT</span><span className="text-foreground font-medium">{fmt(totals.taxTotal)} ر.ع</span></div>
          <div className="flex justify-between border-t border-border pt-2 mt-2">
            <span className="text-foreground font-bold">الإجمالي النهائي / Grand Total</span>
            <span className="text-primary font-bold text-lg">{fmt(totals.total)} ر.ع</span>
          </div>
        </div>
      </div>

      {/* Pickers */}
      <WorkOrderPickerDialog
        open={showWoPicker}
        onOpenChange={setShowWoPicker}
        onPick={pickFromWorkOrder}
        title="اختر أمر العمل لجلب بياناته"
        description="سيتم جلب السيارة + العميل + الخدمات + قطع الغيار تلقائياً"
      />
      <VehiclePickerDialog
        open={showVehiclePicker}
        onOpenChange={setShowVehiclePicker}
        onPick={pickFromVehicle}
        ownerFilter={form.customer}
      />

      {/* Vehicle update prompt on save */}
      <AlertDialog open={!!pendingSave} onOpenChange={(o) => !o && setPendingSave(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تحديث بطاقة السيارة الأصلية؟</AlertDialogTitle>
            <AlertDialogDescription>
              عدّلت بيانات السيارة <span className="font-mono text-foreground">{form.linkedVehiclePlate}</span> داخل الفاتورة.
              هل تريد حفظ التعديلات على بطاقة السيارة في النظام أيضاً؟
              <br />
              <span className="text-xs text-muted-foreground mt-2 block">
                إذا اخترت "لا"، التعديلات ستظهر فقط على هذه الفاتورة دون تغيير البيانات الأصلية.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void commitSave(false).catch((error: any) => toast.error(error?.message || "تعذر حفظ الفاتورة"))}>
              لا — احفظ على الفاتورة فقط
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void commitSave(true).catch((error: any) => toast.error(error?.message || "تعذر تحديث بطاقة المركبة في Supabase"))}>
              نعم — حدّث البطاقة الأصلية
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
