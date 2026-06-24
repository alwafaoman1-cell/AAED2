import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { customersStore, type Customer, type CustomerType } from "@/lib/customersStore";
import { User, Building2 } from "lucide-react";
import { toast } from "sonner";
import { toE164 } from "@/lib/phoneUtils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialPhone?: string;
  initialName?: string;
  onCreated?: (c: Customer) => void;
}

/**
 * حوار إنشاء عميل إلزامي. يستخدم في أي شاشة لا يجب الإكمال فيها بدون عميل.
 * يدعم نوعين: فرد (Individual) و شركة (Company) — حقول الشركة تظهر ديناميكياً.
 */
export default function NewCustomerDialog({ open, onOpenChange, initialPhone, initialName, onCreated }: Props) {
  const [type, setType] = useState<CustomerType>("individual");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [commercialRegistration, setCommercialRegistration] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType("individual");
      setName(initialName || "");
      setPhone(initialPhone || "");
      setEmail(""); setIdNumber("");
      setContactPerson(""); setCommercialRegistration(""); setTaxNumber("");
      setAddress(""); setNotes("");
    }
  }, [open, initialName, initialPhone]);

  function handleSave() {
    if (!name.trim()) { toast.error("اسم العميل مطلوب"); return; }
    if (!phone.trim()) { toast.error("رقم الهاتف مطلوب"); return; }
    if (type === "company" && !contactPerson.trim()) {
      toast.error("اسم الشخص المسؤول مطلوب للشركات");
      return;
    }
    setSaving(true);
    try {
      // منع تكرار بالاسم نفسه
      const existing = customersStore.findByName(name);
      if (existing) {
        toast.error("يوجد عميل بهذا الاسم مسبقاً");
        setSaving(false);
        return;
      }
      const normalizedPhone = toE164(phone);
      const c: Customer = {
        id: `CUST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim(),
        phone: normalizedPhone,
        email: email.trim() || undefined,
        idNumber: idNumber.trim() || undefined,
        type,
        contactPerson: type === "company" ? contactPerson.trim() : undefined,
        commercialRegistration: type === "company" ? commercialRegistration.trim() || undefined : undefined,
        taxNumber: type === "company" ? taxNumber.trim() || undefined : undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        tag: "new",
        createdAt: new Date().toISOString(),
      };
      customersStore.add(c);
      toast.success("تم إنشاء العميل");
      onCreated?.(c);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة عميل جديد</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* نوع العميل */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">نوع العميل *</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("individual")}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                  type === "individual" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                <User size={18} />
                <span className="text-sm font-medium">فرد</span>
              </button>
              <button
                type="button"
                onClick={() => setType("company")}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                  type === "company" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                <Building2 size={18} />
                <span className="text-sm font-medium">شركة</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">{type === "company" ? "اسم الشركة *" : "الاسم الكامل *"}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">رقم الهاتف *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(toE164(phone))} dir="ltr" placeholder="+968" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">البريد الإلكتروني</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            </div>

            {type === "individual" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">رقم البطاقة المدنية</Label>
                <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} dir="ltr" />
              </div>
            )}

            {type === "company" && (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">الشخص المسؤول *</Label>
                  <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">السجل التجاري</Label>
                  <Input value={commercialRegistration} onChange={(e) => setCommercialRegistration(e.target.value)} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">الرقم الضريبي</Label>
                  <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} dir="ltr" />
                </div>
              </>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">العنوان</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>حفظ العميل</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
