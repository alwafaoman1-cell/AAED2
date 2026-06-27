import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { customersStore, type Customer, type CustomerTag, type CustomerType } from "@/lib/customersStore";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import { toast } from "sonner";
import { AlertTriangle, Car, Building2, User, Plus, X } from "lucide-react";
import { normalizePhone, toE164 } from "@/lib/phoneUtils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Customer | null;
}

type FormShape = Omit<Customer, "id" | "createdAt">;

const empty: FormShape = {
  name: "", phone: "", email: "", address: "", idNumber: "", notes: "", tag: "new",
  type: "individual", contactPerson: "", commercialRegistration: "", taxNumber: "",
};

interface VehicleDraft {
  plate: string; type: string; model: string; year: string; color: string; vin: string; mileage: string;
}
const emptyVehicle: VehicleDraft = { plate: "", type: "", model: "", year: "", color: "", vin: "", mileage: "" };

export default function CustomerFormDialog({ open, onOpenChange, initial }: Props) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormShape>(empty);
  const [dupWarn, setDupWarn] = useState<Customer | null>(null);
  const [addVehicle, setAddVehicle] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleDraft[]>([{ ...emptyVehicle }]);

  useEffect(() => {
    if (initial) {
      const { id, createdAt, ...rest } = initial;
      setForm({ ...empty, ...rest, type: rest.type || "individual" });
    } else {
      setForm(empty);
    }
    setAddVehicle(false);
    setVehicles([{ ...emptyVehicle }]);
  }, [initial, open]);

  const isCompany = (form.type || "individual") === "company";

  const set = <K extends keyof FormShape>(k: K, v: FormShape[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const setV = (idx: number, patch: Partial<VehicleDraft>) =>
    setVehicles((arr) => arr.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  const addVehicleRow = () => setVehicles((arr) => [...arr, { ...emptyVehicle }]);
  const removeVehicleRow = (idx: number) =>
    setVehicles((arr) => (arr.length <= 1 ? arr : arr.filter((_, i) => i !== idx)));

  async function performSave() {
    const normalizedPhone = toE164(form.phone);
    const saveForm = { ...form, phone: normalizedPhone };
    if (isEdit && initial) {
      customersStore.update(initial.id, saveForm);
      toast.success(`تم تحديث ${saveForm.name}`);
    } else {
      const savedCustomer = await customersStore.addAsync({
        ...saveForm,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
      toast.success(isCompany ? `تمت إضافة الشركة ${saveForm.name}` : `تم إضافة ${saveForm.name}`);
      if (addVehicle) {
        let added = 0;
        let skipped = 0;
        vehicles.forEach((vd) => {
          const plate = vd.plate.trim();
          if (!plate) return;
          const exists = vehiclesStore.getAll().find((v) => v.plate === plate);
          if (exists) { skipped++; return; }
          const v: Vehicle = {
            id: plate,
            plate,
            type: `${vd.type} ${vd.model}`.trim() || "-",
            vin: vd.vin.trim(),
            owner: savedCustomer.name,
            ownerPhone: saveForm.phone || "",
            year: vd.year, color: vd.color, mileage: vd.mileage,
            visits: 0,
            lastVisit: new Date().toISOString().slice(0, 10),
            totalSpent: 0,
            photoPairs: [],
          };
          vehiclesStore.add(v);
          added++;
        });
        if (added > 0) toast.success(`تمت إضافة ${added} ${added === 1 ? "سيارة" : "سيارات"}`);
        if (skipped > 0) toast.warning(`تم تخطي ${skipped} (لوحة مكررة)`);
      }
    }
    setDupWarn(null);
    onOpenChange(false);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error(isCompany ? "اسم الشركة مطلوب" : "اسم العميل مطلوب");
      return;
    }
    if (form.phone && form.phone.trim()) {
      const cleanPhone = normalizePhone(form.phone);
      const dup = customersStore.findByPhone(cleanPhone);
      if (dup && (!isEdit || dup.id !== initial?.id)) {
        setDupWarn(dup);
        return;
      }
    }
    void performSave().catch((error) => toast.error(error?.message || "تعذر حفظ العميل"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? (isCompany ? "تعديل بيانات الشركة" : "تعديل بيانات العميل")
              : "عميل / شركة جديدة"}
          </DialogTitle>
        </DialogHeader>

        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/30 rounded-lg">
          <button
            type="button"
            onClick={() => set("type", "individual")}
            className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition ${
              !isCompany ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <User size={14} /> فرد
          </button>
          <button
            type="button"
            onClick={() => set("type", "company")}
            className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition ${
              isCompany ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <Building2 size={14} /> شركة
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">
              {isCompany ? "اسم الشركة *" : "الاسم الكامل *"}
            </Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>

          {isCompany && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">الشخص المسؤول (مدير الأسطول / مسؤول الصيانة)</Label>
              <Input value={form.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">رقم الجوال</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={() => set("phone", toE164(form.phone))} dir="ltr" placeholder="+968" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">البريد الإلكتروني</Label>
            <Input value={form.email || ""} onChange={(e) => set("email", e.target.value)} dir="ltr" />
          </div>

          {isCompany && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">السجل التجاري</Label>
                <Input value={form.commercialRegistration || ""} dir="ltr"
                  onChange={(e) => set("commercialRegistration", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">الرقم الضريبي</Label>
                <Input value={form.taxNumber || ""} dir="ltr"
                  onChange={(e) => set("taxNumber", e.target.value)} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">التصنيف</Label>
            <Select value={form.tag} onValueChange={(v: CustomerTag) => set("tag", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">جديد</SelectItem>
                <SelectItem value="regular">عادي</SelectItem>
                <SelectItem value="vip">VIP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">العنوان</Label>
            <Input value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">ملاحظات</Label>
            <Textarea rows={2} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        {!isEdit && (
          <div className="mt-3 border border-border rounded-lg p-3 bg-secondary/20">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                <Car size={14} className="text-primary" />
                {isCompany ? "إضافة سيارات الأسطول" : "إضافة سيارة للعميل"}
              </Label>
              <Switch checked={addVehicle} onCheckedChange={setAddVehicle} />
            </div>

            {addVehicle && (
              <div className="space-y-3 mt-3">
                {vehicles.map((vd, idx) => (
                  <div key={idx} className="border border-border/60 rounded-md p-2.5 bg-card/40 relative">
                    {isCompany && vehicles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeVehicleRow(idx)}
                        className="absolute top-1.5 left-1.5 p-1 rounded hover:bg-destructive/10 text-destructive"
                        title="حذف"
                      >
                        <X size={13} />
                      </button>
                    )}
                    <div className="text-[11px] text-muted-foreground mb-2">
                      سيارة #{idx + 1}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs text-muted-foreground">رقم اللوحة *</Label>
                        <Input value={vd.plate} onChange={(e) => setV(idx, { plate: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">الماركة</Label>
                        <Input value={vd.type} onChange={(e) => setV(idx, { type: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">الموديل</Label>
                        <Input value={vd.model} onChange={(e) => setV(idx, { model: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">سنة الصنع</Label>
                        <Input value={vd.year} dir="ltr" onChange={(e) => setV(idx, { year: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">اللون</Label>
                        <Input value={vd.color} onChange={(e) => setV(idx, { color: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">رقم الهيكل (VIN)</Label>
                        <Input value={vd.vin} dir="ltr" onChange={(e) => setV(idx, { vin: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">الكيلومترات</Label>
                        <Input value={vd.mileage} dir="ltr" onChange={(e) => setV(idx, { mileage: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
                {isCompany && (
                  <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={addVehicleRow}>
                    <Plus size={14} /> إضافة سيارة أخرى للأسطول
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground hover:opacity-90">
            {isEdit ? "حفظ التعديلات" : (isCompany ? "إضافة الشركة" : "إضافة العميل")}
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={!!dupWarn} onOpenChange={(o) => !o && setDupWarn(null)}>
        <AlertDialogContent dir="rtl" className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle size={20} /> رقم جوال مكرر
            </AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/80 leading-relaxed">
              هذا الرقم مسجَّل مسبقاً للعميل:
              <span className="block mt-2 p-3 rounded-md bg-muted/50 border border-border">
                <span className="font-semibold text-foreground">{dupWarn?.name}</span>
                {dupWarn?.phone && <span className="block text-xs text-muted-foreground mt-1" dir="ltr">{dupWarn.phone}</span>}
              </span>
              <span className="block mt-3 text-sm">هل تريد المتابعة والحفظ بنفس الرقم؟</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={performSave} className="bg-warning text-warning-foreground hover:bg-warning/90">
              متابعة الحفظ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
