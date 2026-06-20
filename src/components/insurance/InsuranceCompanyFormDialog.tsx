import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fileToWebpDataUrl } from "@/lib/imageToWebp";
import { Upload, X, Building2 } from "lucide-react";
import {
  useCreateInsuranceCompany,
  useUpdateInsuranceCompany,
  type InsuranceCompany,
} from "@/hooks/useInsuranceCompanies";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  company?: InsuranceCompany | null;
  defaultName?: string;
  onCreated?: (company: InsuranceCompany) => void;
}

export default function InsuranceCompanyFormDialog({ open, onOpenChange, company, defaultName, onCreated }: Props) {
  const isEdit = !!company?.id;
  const create = useCreateInsuranceCompany();
  const update = useUpdateInsuranceCompany();

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [deductible, setDeductible] = useState<number>(0);
  const [terms, setTerms] = useState<number>(90);
  const [notes, setNotes] = useState("");
  // Official identifiers
  const [cr, setCr] = useState("");
  const [vat, setVat] = useState("");
  const [poBox, setPoBox] = useState("");
  const [branchCity, setBranchCity] = useState("");
  // Bank details
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // VAT format validators (warning-only — حقول اختيارية)
  // Oman: OMxxxxxxxxxxxxxxx (16 digits) — Saudi: 15 digits starting with 3.
  const vatTrim = vat.trim();
  const vatLooksValid =
    !vatTrim ||
    /^OM\d{12,16}$/i.test(vatTrim) ||
    /^\d{15}$/.test(vatTrim);
  const ibanTrim = iban.replace(/\s+/g, "");
  const ibanLooksValid =
    !ibanTrim || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(ibanTrim);

  useEffect(() => {
    if (company) {
      setName(company.name);
      setContact(company.contact_person ?? "");
      setPhone(company.phone ?? "");
      setEmail(company.email ?? "");
      setAddress(company.address ?? "");
      setDeductible(Number(company.default_deductible_percent ?? 0));
      setTerms(Number(company.payment_terms_days ?? 90));
      setNotes(company.notes ?? "");
      setCr(company.commercial_registration ?? "");
      setVat(company.tax_number ?? "");
      setPoBox(company.po_box ?? "");
      setBranchCity(company.branch_city ?? "");
      setBankName((company as any).bank_name ?? "");
      setIban((company as any).iban ?? "");
      setBankAccountName((company as any).bank_account_name ?? "");
      setLogoUrl((company as any).logo_url ?? "");
    } else {
      setName(defaultName ?? "");
      setContact(""); setPhone(""); setEmail(""); setAddress("");
      setDeductible(0); setTerms(90); setNotes("");
      setCr(""); setVat(""); setPoBox(""); setBranchCity("");
      setBankName(""); setIban(""); setBankAccountName("");
      setLogoUrl("");
    }
  }, [company, defaultName, open]);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("يرجى إدخال اسم الشركة"); return; }
    setSubmitting(true);
    try {
      // ✅ استخدام الدالة الآمنة بدل maybeSingle على profiles (التي تفشل عند تعدد الصفوف)
      const { data: tenantId, error: tErr } = await supabase.rpc("get_user_tenant_id");
      if (tErr) throw tErr;
      if (!tenantId) {
        toast.error("تعذّر تحديد المؤسسة. يرجى إعادة تسجيل الدخول.");
        return;
      }

      const payload = {
        tenant_id: tenantId as string,
        name: name.trim(),
        contact_person: contact || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        default_deductible_percent: deductible,
        payment_terms_days: terms,
        notes: notes || null,
        is_active: true,
        commercial_registration: cr.trim() || null,
        tax_number: vatTrim || null,
        po_box: poBox.trim() || null,
        branch_city: branchCity.trim() || null,
        bank_name: bankName.trim() || null,
        iban: ibanTrim ? ibanTrim.toUpperCase() : null,
        bank_account_name: bankAccountName.trim() || null,
        logo_url: logoUrl || null,
      };

      if (isEdit && company) {
        await update.mutateAsync({ id: company.id, updates: payload });
      } else {
        const created = await create.mutateAsync(payload);
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر حفظ الشركة");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل شركة التأمين" : "شركة تأمين جديدة"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground border-b border-border pb-1">بيانات الشركة</div>

            {/* Logo */}
            <div className="flex items-center gap-4 p-3 border border-border rounded-lg bg-muted/30">
              <div className="w-20 h-20 rounded-full bg-background border-2 border-border overflow-hidden flex items-center justify-center shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt="logo" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">شعار الشركة (يظهر في القائمة والفاتورة الضريبية)</Label>
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (ev) => {
                        const f = ev.target.files?.[0];
                        if (!f) return;
                        setUploadingLogo(true);
                        try {
                          const dataUrl = await fileToWebpDataUrl(f, { maxDimension: 256, quality: 0.85 });
                          setLogoUrl(dataUrl);
                        } catch (err: any) {
                          toast.error(err?.message || "تعذّر رفع الشعار");
                        } finally {
                          setUploadingLogo(false);
                          ev.target.value = "";
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" className="w-full gap-2 pointer-events-none" disabled={uploadingLogo}>
                      <Upload size={14} />
                      {uploadingLogo ? "جاري الرفع..." : logoUrl ? "تغيير الشعار" : "رفع شعار"}
                    </Button>
                  </label>
                  {logoUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl("")} className="gap-1 text-destructive">
                      <X size={14} /> إزالة
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">يفضل صورة مربعة بخلفية شفافة (PNG) — سيتم ضغطها تلقائياً.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label>اسم الشركة *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثل: التعاونية للتأمين" />
              </div>
              <div className="space-y-1.5">
                <Label>الفرع / المدينة</Label>
                <Input value={branchCity} onChange={(e) => setBranchCity(e.target.value)} placeholder="مسقط — الفرع الرئيسي" />
              </div>
              <div className="space-y-1.5">
                <Label>جهة الاتصال</Label>
                <Input value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Official IDs */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground border-b border-border pb-1">
              بيانات رسمية (تظهر في الفواتير وعروض الأسعار وكشوف الحسابات)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>السجل التجاري (CR)</Label>
                <Input value={cr} onChange={(e) => setCr(e.target.value)} placeholder="1234567" dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>الرقم الضريبي (VAT)</Label>
                <Input
                  value={vat}
                  onChange={(e) => setVat(e.target.value)}
                  placeholder="OM1100123456"
                  dir="ltr"
                  className={!vatLooksValid ? "border-warning focus-visible:ring-warning" : ""}
                />
                {!vatLooksValid && (
                  <p className="text-[11px] text-warning">
                    تنسيق غير معتاد — المتوقع: OM متبوعاً بـ12-16 رقم، أو 15 رقم.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground border-b border-border pb-1">معلومات التواصل</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>الهاتف</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>العنوان</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>صندوق البريد / الرمز البريدي</Label>
                <Input value={poBox} onChange={(e) => setPoBox(e.target.value)} placeholder="P.O. Box 1234, P.C. 100" dir="ltr" />
              </div>
            </div>
          </div>

          {/* Bank details */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground border-b border-border pb-1">
              بيانات الحساب البنكي (تظهر في الفاتورة الضريبية وكشف الحساب لتسهيل التحويلات)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>اسم البنك</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="بنك مسقط" />
              </div>
              <div className="space-y-1.5">
                <Label>اسم صاحب الحساب</Label>
                <Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>رقم الآيبان (IBAN)</Label>
                <Input
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  placeholder="OM81 0011 0000 0000 0000 0000"
                  dir="ltr"
                  className={!ibanLooksValid ? "border-warning focus-visible:ring-warning font-mono" : "font-mono"}
                />
                {!ibanLooksValid && (
                  <p className="text-[11px] text-warning">
                    تنسيق IBAN غير معتاد — يبدأ بحرفي الدولة (مثل OM) متبوعاً بأرقام.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Commercial terms */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground border-b border-border pb-1">شروط التعامل</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>نسبة التحمل الافتراضية (%)</Label>
                <Input
                  type="number" min={0} max={100} step="0.5"
                  value={deductible}
                  onChange={(e) => setDeductible(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>مدة السداد (أيام)</Label>
                <Input
                  type="number" min={1}
                  value={terms}
                  onChange={(e) => setTerms(Number(e.target.value) || 90)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2">
          <Button onClick={handleSubmit} disabled={submitting || create.isPending || update.isPending}>
            {isEdit ? "حفظ التعديلات" : "إضافة"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
