import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: Supplier | null;
}

const empty: Supplier = {
  id: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  taxNumber: "",
  notes: "",
  category: "",
  vehicleBrands: [],
  createdAt: "",
};

const COMMON_BRANDS = [
  "تويوتا","لكزس","نيسان","إنفينيتي","هوندا","أكورا","ميتسوبيشي","مازدا","سوزوكي",
  "هيونداي","كيا","شيفروليه","جي إم سي","فورد","كرايسلر","جيب","دودج","كاديلاك",
  "مرسيدس","بي إم دبليو","أودي","فولكس واجن","بورش","لاند روفر","رنج روفر",
  "جميع الماركات",
];

export default function SupplierFormDialog({ open, onOpenChange, editing }: Props) {
  const [form, setForm] = useState<Supplier>(empty);

  useEffect(() => {
    if (open) {
      if (editing) setForm(editing);
      else {
        const list = suppliersStore.getAll();
        const id = `SUP-${String(list.length + 1).padStart(3, "0")}`;
        setForm({ ...empty, id, createdAt: new Date().toISOString() });
      }
    }
  }, [open, editing]);

  function handleSave() {
    if (!form.name.trim()) { toast.error("اسم المورد مطلوب"); return; }
    if (editing) {
      suppliersStore.update(editing.id, form);
      toast.success("تم تحديث المورد");
    } else {
      suppliersStore.add(form);
      toast.success("تمت إضافة المورد");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {editing ? `تعديل ${editing.name}` : "مورد جديد"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <Field label="اسم المورد *">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border" />
          </Field>
          <Field label="الهاتف">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-secondary border-border" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-secondary border-border" />
          </Field>
          <Field label="الرقم الضريبي">
            <Input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} className="bg-secondary border-border font-mono" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="العنوان">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-secondary border-border" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="الفئة / التصنيف">
              <Input
                value={form.category || ""}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="مثال: وكيل أصلي، تجاري، زيوت، كهرباء..."
                className="bg-secondary border-border"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="ماركات السيارات التي يبيع لها">
              <Input
                value={(form.vehicleBrands || []).join(", ")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    vehicleBrands: e.target.value
                      .split(/[,،؛;|]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="افصل الماركات بفاصلة — مثال: تويوتا, لكزس, نيسان"
                className="bg-secondary border-border"
              />
              <div className="flex flex-wrap gap-1 mt-2">
                {COMMON_BRANDS.map((b) => {
                  const active = (form.vehicleBrands || []).includes(b);
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        const cur = form.vehicleBrands || [];
                        setForm({
                          ...form,
                          vehicleBrands: active ? cur.filter((x) => x !== b) : [...cur, b],
                        });
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="ملاحظات">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-secondary border-border" />
            </Field>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1">حفظ</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>;
}
