import { useEffect, useRef, useState } from "react";
import { Settings, User, Percent, FileText, Palette, Eye, RotateCcw, Image as ImageIcon, X, Plus, Edit, Trash2, Shield, Stamp, PenTool, Cloud } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getTemplateSettings, saveTemplateSettings, subscribeTemplateSettings, type PdfTemplateSettings, getInvoiceHtml } from "@/lib/pdfGenerator";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { usersStore, ROLE_LABELS, ROLE_DESCRIPTIONS, type AppUser } from "@/lib/usersStore";
import { canEdit, canDelete, getCurrentRole, type Role } from "@/lib/permissions";
import { COUNTRY_DIALS } from "@/lib/countries";
import { useSystemPreferences, type SystemThemePreset } from "@/lib/systemPreferences";

const colorPresets = [
  { label: "ذهبي", value: "#d4a537" },
  { label: "أزرق", value: "#2563eb" },
  { label: "أخضر", value: "#16a34a" },
  { label: "أحمر", value: "#dc2626" },
  { label: "بنفسجي", value: "#7c3aed" },
  { label: "رمادي", value: "#6b7280" },
];

const emptyUser: AppUser = {
  id: "",
  name: "",
  email: "",
  phone: "",
  role: "technician",
  status: "active",
  createdAt: new Date().toISOString(),
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<PdfTemplateSettings>(getTemplateSettings());
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);

  // Users state
  const [users, setUsers] = useState<AppUser[]>(usersStore.getAll());
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [userForm, setUserForm] = useState<AppUser>(emptyUser);
  const [deletingUser, setDeletingUser] = useState<AppUser | null>(null);
  const currentRole: Role = getCurrentRole();
  const allowEdit = canEdit();
  const allowDelete = canDelete();
  const { preferences: systemPreferences, save: saveSystemPreferences } = useSystemPreferences();
  const [savingSystemPreferences, setSavingSystemPreferences] = useState(false);

  useEffect(() => usersStore.subscribe(() => setUsers([...usersStore.getAll()])), []);
  // عند وصول نسخة من قاعدة البيانات (بعد تسجيل الدخول أو على جهاز جديد) حدّث النموذج
  useEffect(() => subscribeTemplateSettings(() => setSettings(getTemplateSettings())), []);

  const update = (key: keyof PdfTemplateSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveTemplateSettings(settings);
    toast.success("تم حفظ الإعدادات بنجاح");
  };

  const handleReset = () => {
    localStorage.removeItem("pdf_template_settings");
    setSettings(getTemplateSettings());
    toast.success("تم إعادة الإعدادات الافتراضية");
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يجب أن يكون الملف صورة");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الصورة يجب أن يكون أقل من 5 ميجابايت");
      return;
    }
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const dataUrl = await fileToWebpDataUrl(file, { maxDimension: 800, quality: 0.9 });
    setSettings(prev => ({ ...prev, logoUrl: dataUrl }));
    toast.success("تم رفع الشعار — اضغط حفظ لتثبيته");
  };

  const handleRemoveLogo = () => {
    setSettings(prev => ({ ...prev, logoUrl: undefined }));
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "stampUrl" | "signatureUrl",
    label: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يجب أن يكون الملف صورة");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الصورة يجب أن يكون أقل من 5 ميجابايت");
      return;
    }
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const dataUrl = await fileToWebpDataUrl(file, { maxDimension: 800, quality: 0.9 });
    setSettings(prev => ({ ...prev, [field]: dataUrl }));
    toast.success(`تم رفع ${label} — اضغط حفظ لتثبيته`);
  };

  const handlePreview = () => {
    const backup = localStorage.getItem("pdf_template_settings");
    saveTemplateSettings(settings);
    setPreviewHtml(getInvoiceHtml({
      invoiceNumber: "INV-PREVIEW",
      date: new Date().toLocaleDateString("ar-SA"),
      customerName: "عميل تجريبي",
      customerPhone: "0551234567",
      vehicleInfo: "تويوتا كامري 2024",
      plateNumber: "أ ب ج 1234",
      items: [
        { description: "إصلاح الصدام الأمامي", quantity: 1, unitPrice: 5000, total: 5000 },
        { description: "دهان وتلميع", quantity: 1, unitPrice: 3000, total: 3000 },
      ],
      subtotal: 8000,
      vat: Math.round(8000 * settings.vatRate / 100),
      total: 8000 + Math.round(8000 * settings.vatRate / 100),
    }));
    if (backup) localStorage.setItem("pdf_template_settings", backup);
    else localStorage.removeItem("pdf_template_settings");
    setShowPreview(true);
  };

  // ===== Users CRUD =====
  function openNewUser() {
    setUserForm({ ...emptyUser, id: `U-${Date.now()}`, createdAt: new Date().toISOString() });
    setEditingUser(null);
    setShowUserForm(true);
  }
  function openEditUser(u: AppUser) {
    setUserForm(u);
    setEditingUser(u);
    setShowUserForm(true);
  }
  function handleSaveUser() {
    if (!userForm.name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (!userForm.email.trim()) { toast.error("البريد الإلكتروني مطلوب"); return; }
    if (editingUser) {
      usersStore.update(editingUser.id, userForm);
      toast.success("تم تحديث المستخدم");
    } else {
      usersStore.add(userForm);
      toast.success("تم إضافة المستخدم");
    }
    setShowUserForm(false);
  }
  function handleDeleteUser() {
    if (!deletingUser) return;
    usersStore.remove(deletingUser.id);
    toast.success(`تم حذف ${deletingUser.name}`);
    setDeletingUser(null);
  }
  // Role switching removed — role comes from the authenticated profile only.

  async function handleSaveSystemPreferences() {
    setSavingSystemPreferences(true);
    try {
      await saveSystemPreferences(systemPreferences);
      toast.success("تم حفظ إعدادات الهاتف والقالب");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ إعدادات النظام");
    } finally {
      setSavingSystemPreferences(false);
    }
  }

  function updateSystemTheme(themeId: string, patch: Partial<SystemThemePreset>) {
    void saveSystemPreferences({
      ...systemPreferences,
      themes: systemPreferences.themes.map((theme) => theme.id === themeId ? { ...theme, ...patch } : theme),
    });
  }

  function addSystemTheme() {
    const id = `theme-${Date.now()}`;
    void saveSystemPreferences({
      ...systemPreferences,
      activeThemeId: id,
      themes: [
        ...systemPreferences.themes,
        { id, name: "قالب جديد", primary: settings.primaryColor || "#d4a537", accent: "#0ea5e9" },
      ],
    });
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">إعدادات النظام وتخصيص قوالب المستخرجات</p>
      </div>

      <div className="bg-card border border-primary/25 rounded-xl p-4 shadow-card space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Palette size={16} className="text-primary" /> إعدادات التشغيل العامة
            </h3>
            <p className="text-xs text-muted-foreground">
              تحفظ لكل ورشة / tenant وتطبّق على أرقام الهاتف، واتساب، ألوان الواجهة، الأزرار، البطاقات، والشريط الجانبي.
            </p>
          </div>
          <Button onClick={handleSaveSystemPreferences} disabled={savingSystemPreferences} className="gradient-gold text-primary-foreground">
            {savingSystemPreferences ? "جارٍ الحفظ..." : "حفظ إعدادات التشغيل"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">بادئة الدولة الافتراضية للهاتف</label>
            <Select
              value={systemPreferences.defaultCountryCode}
              onValueChange={(value) => void saveSystemPreferences({ ...systemPreferences, defaultCountryCode: value })}
            >
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {COUNTRY_DIALS.map((country) => (
                  <SelectItem key={country.iso} value={country.code}>
                    {country.flag} +{country.code} — {country.nameAr} ({country.nameEn})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">أي رقم بدون بادئة سيُحفظ ويُرسل بصيغة +{systemPreferences.defaultCountryCode} تلقائيًا.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">القالب النشط</label>
            <Select
              value={systemPreferences.activeThemeId}
              onValueChange={(value) => void saveSystemPreferences({ ...systemPreferences, activeThemeId: value })}
            >
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>
                {systemPreferences.themes.map((theme) => (
                  <SelectItem key={theme.id} value={theme.id}>{theme.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">التبديل يطبق الألوان مباشرة على الواجهة.</p>
          </div>

          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={addSystemTheme} className="w-full gap-2">
              <Plus size={14} /> إنشاء قالب لون جديد
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {systemPreferences.themes.map((theme) => (
            <div key={theme.id} className={`rounded-xl border p-3 ${theme.id === systemPreferences.activeThemeId ? "border-primary bg-primary/5" : "border-border bg-secondary/20"}`}>
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={theme.name}
                  onChange={(event) => updateSystemTheme(theme.id, { name: event.target.value })}
                  className="h-9 bg-card"
                />
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.primary} onChange={(event) => updateSystemTheme(theme.id, { primary: event.target.value })} className="h-9 w-12 p-1" />
                  <Input type="color" value={theme.accent || theme.primary} onChange={(event) => updateSystemTheme(theme.id, { accent: event.target.value })} className="h-9 w-12 p-1" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] text-primary">Badge</span>
                <Button size="sm" className="h-7 gradient-gold text-primary-foreground">Button</Button>
                <div className="rounded-lg border border-border bg-card px-3 py-1 text-xs">Card header</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a
          href="/settings/roles-permissions"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Shield size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">الأدوار والصلاحيات</div>
            <div className="text-xs text-muted-foreground">شرح كل دور وحدود وصوله لكل شاشة</div>
          </div>
        </a>
        <a
          href="/settings/quick-actions"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <Plus size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">زر الإجراءات السريعة العائم</div>
            <div className="text-xs text-muted-foreground">إظهار/إخفاء + اختيار الإجراءات + الموقع</div>
          </div>
        </a>
        <a
          href="/settings/data-migration"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center">
            <Cloud size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">ترحيل البيانات إلى السحابة</div>
            <div className="text-xs text-muted-foreground">نقل بيانات هذا الجهاز إلى قاعدة البيانات السحابية</div>
          </div>
        </a>
        <a
          href="/settings/public-access"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center">
            <Shield size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">كلمة المرور الرئيسية للوصول العام</div>
            <div className="text-xs text-muted-foreground">كلمة سر إضافية تفتح صفحات تتبع المركبات لك</div>
          </div>
        </a>
        <a
          href="/settings/sms"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-success/10 text-success flex items-center justify-center">
            <Plus size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">إعدادات SMS (Twilio)</div>
            <div className="text-xs text-muted-foreground">ربط حساب Twilio لإرسال الرسائل تلقائياً</div>
          </div>
        </a>
        <a
          href="/settings/tax"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center">
            <Percent size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">إعدادات الضريبة</div>
            <div className="text-xs text-muted-foreground">تشغيل/إيقاف الضريبة، النسبة، الاسم، الرقم الضريبي، شاملة/مضافة</div>
          </div>
        </a>
        <a
          href="/settings/integrations"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Plus size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">التكاملات والمزامنة</div>
            <div className="text-xs text-muted-foreground">Twilio WhatsApp · Meta Cloud API · Gmail — ربط حسابات الورشة الخاصة</div>
          </div>
        </a>
        <a
          href="/settings/payment-gateways"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <Plus size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">بوابات الدفع الإلكتروني</div>
            <div className="text-xs text-muted-foreground">Stripe · Thawani · MyFatoorah · PayTabs · Tap — روابط دفع Apple/Google Pay</div>
          </div>
        </a>
        <a
          href="/settings/pdf-layout"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">هوامش وتنسيق PDF</div>
            <div className="text-xs text-muted-foreground">قيم موحَّدة (15/18 مم) تُطبَّق على كل المستخرجات</div>
          </div>
        </a>
        <a
          href="/settings/numbering"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <Settings size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">إعدادات الترقيم التسلسلي</div>
            <div className="text-xs text-muted-foreground">حدِّد من أين يبدأ ترقيم الفواتير وأوامر العمل والسندات</div>
          </div>
        </a>
        <a
          href="/settings/vehicle-belongings"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center">
            <Settings size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">قائمة مقتنيات السيارة</div>
            <div className="text-xs text-muted-foreground">العناصر التي تظهر كـ Checkbox عند استلام المركبة</div>
          </div>
        </a>
        <a
          href="/sales/settings"
          className="bg-card border border-border rounded-xl p-4 shadow-card hover:shadow-lg hover:border-primary/40 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">إعدادات المبيعات</div>
            <div className="text-xs text-muted-foreground">سياسات الفواتير، حدود الخصم، الشروط الافتراضية</div>
          </div>
        </a>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Settings size={16} className="text-primary" /> معلومات الشركة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">اسم الشركة (عربي)</label>
            <Input value={settings.companyName} onChange={e => update("companyName", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">اسم الشركة (إنجليزي)</label>
            <Input value={settings.companyNameEn} onChange={e => update("companyNameEn", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">رقم الهاتف</label>
            <Input value={settings.phone} onChange={e => update("phone", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">البريد الإلكتروني</label>
            <Input value={settings.email} onChange={e => update("email", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">العنوان</label>
            <Input value={settings.address} onChange={e => update("address", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">السجل التجاري</label>
            <Input value={settings.commercialReg} onChange={e => update("commercialReg", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
          <div className="space-y-1.5"><label className="text-xs text-muted-foreground">الرقم الضريبي</label>
            <Input value={settings.vatNumber} onChange={e => update("vatNumber", e.target.value)} className="bg-secondary border-border text-foreground" /></div>
        </div>
      </div>

      {/* Logo Upload */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ImageIcon size={16} className="text-primary" /> شعار الشركة
        </h3>
        <p className="text-xs text-muted-foreground">يظهر في رأس جميع المستخرجات (الفواتير، أوامر العمل، التقارير، تقدير التأمين). الحد الأقصى: 1 ميجابايت — يفضّل PNG شفاف.</p>
        <div className="flex items-center gap-4">
          <div className="w-32 h-20 rounded-lg border border-dashed border-border bg-secondary/30 flex items-center justify-center overflow-hidden shrink-0">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="شعار الشركة" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-[10px] text-muted-foreground">لا يوجد شعار</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="border-border gap-1.5">
              <ImageIcon size={14} /> {settings.logoUrl ? "تغيير الشعار" : "رفع شعار"}
            </Button>
            {settings.logoUrl && (
              <Button variant="ghost" size="sm" onClick={handleRemoveLogo} className="text-destructive hover:text-destructive gap-1.5">
                <X size={14} /> إزالة الشعار
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Stamp & Signature */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Stamp size={16} className="text-primary" /> ختم الورشة والتوقيع الرسمي
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">تفعيل عام</span>
            <Switch
              checked={settings.stampEnabled}
              onCheckedChange={v => update("stampEnabled", v)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          ارفع صورة الختم والتوقيع (PNG شفاف يُفضّل) ليظهرا تلقائياً على المستندات الرسمية. الحد الأقصى: 1 ميجابايت لكل صورة.
        </p>

        {/* Uploads */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Stamp */}
          <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Stamp size={13} className="text-primary" /> ختم الورشة
            </label>
            <div className="flex items-center gap-3">
              <div className="w-24 h-24 rounded-lg border border-dashed border-border bg-card flex items-center justify-center overflow-hidden shrink-0">
                {settings.stampUrl ? (
                  <img src={settings.stampUrl} alt="الختم" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground text-center px-1">لم يتم الرفع</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input ref={stampRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "stampUrl", "الختم")} className="hidden" />
                <Button variant="outline" size="sm" onClick={() => stampRef.current?.click()} className="border-border gap-1.5 text-xs">
                  <ImageIcon size={12} /> {settings.stampUrl ? "تغيير" : "رفع"}
                </Button>
                {settings.stampUrl && (
                  <Button variant="ghost" size="sm" onClick={() => { setSettings(p => ({ ...p, stampUrl: undefined })); if (stampRef.current) stampRef.current.value = ""; }} className="text-destructive gap-1.5 text-xs h-7">
                    <X size={12} /> إزالة
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <PenTool size={13} className="text-primary" /> التوقيع
            </label>
            <div className="flex items-center gap-3">
              <div className="w-24 h-24 rounded-lg border border-dashed border-border bg-card flex items-center justify-center overflow-hidden shrink-0">
                {settings.signatureUrl ? (
                  <img src={settings.signatureUrl} alt="التوقيع" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground text-center px-1">لم يتم الرفع</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input ref={signatureRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "signatureUrl", "التوقيع")} className="hidden" />
                <Button variant="outline" size="sm" onClick={() => signatureRef.current?.click()} className="border-border gap-1.5 text-xs">
                  <ImageIcon size={12} /> {settings.signatureUrl ? "تغيير" : "رفع"}
                </Button>
                {settings.signatureUrl && (
                  <Button variant="ghost" size="sm" onClick={() => { setSettings(p => ({ ...p, signatureUrl: undefined })); if (signatureRef.current) signatureRef.current.value = ""; }} className="text-destructive gap-1.5 text-xs h-7">
                    <X size={12} /> إزالة
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Responsible Name */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">اسم المسؤول (يظهر تحت التوقيع)</label>
          <Input
            value={settings.responsibleName || ""}
            onChange={e => update("responsibleName", e.target.value)}
            placeholder="مثال: أحمد محمد — مدير الورشة"
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Position & Size */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">موضع الختم على المستند</label>
            <Select value={settings.stampPosition} onValueChange={v => update("stampPosition", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bottom-center">أسفل الوسط (موصى به)</SelectItem>
                <SelectItem value="bottom-right">أسفل اليمين</SelectItem>
                <SelectItem value="bottom-left">أسفل اليسار</SelectItem>
                <SelectItem value="watermark-center">علامة مائية في الوسط (شفاف)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">حجم الختم</label>
            <Select value={settings.stampSize} onValueChange={v => update("stampSize", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">صغير (~100px)</SelectItem>
                <SelectItem value="md">متوسط (~150px)</SelectItem>
                <SelectItem value="lg">كبير (~200px)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Per-document toggles */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground">إظهار الختم على المستندات التالية:</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { key: "stampOnInvoice", label: "الفواتير الضريبية" },
              { key: "stampOnQuote", label: "عروض الأسعار وتقدير التأمين" },
              { key: "stampOnVoucher", label: "سندات القبض والصرف والدفعات" },
              { key: "stampOnReport", label: "تقارير PDF (محاسبية ومالية)" },
              { key: "stampOnWorkOrder", label: "أوامر العمل" },
              { key: "stampOnInspection", label: "تقارير الفحص والمعاينة" },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/50">
                <span className="text-xs text-foreground">{label}</span>
                <Switch
                  checked={settings[key] as boolean}
                  onCheckedChange={v => update(key, v)}
                  disabled={!settings.stampEnabled}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tax & Currency */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Percent size={16} className="text-primary" /> الضريبة والعملة</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">نسبة الضريبة (%)</label>
            <Input type="number" value={settings.vatRate} onChange={e => update("vatRate", Number(e.target.value))} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">رمز العملة (عربي)</label>
            <Input value={settings.currencySymbol ?? "ر.ع"} onChange={e => update("currencySymbol", e.target.value)} placeholder="ر.ع / ر.س / د.إ" className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">كود العملة (إنجليزي)</label>
            <Select value={settings.currencyCode ?? "OMR"} onValueChange={v => update("currencyCode", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OMR">OMR — ريال عماني</SelectItem>
                <SelectItem value="SAR">SAR — ريال سعودي</SelectItem>
                <SelectItem value="AED">AED — درهم إماراتي</SelectItem>
                <SelectItem value="QAR">QAR — ريال قطري</SelectItem>
                <SelectItem value="KWD">KWD — دينار كويتي</SelectItem>
                <SelectItem value="BHD">BHD — دينار بحريني</SelectItem>
                <SelectItem value="USD">USD — دولار أمريكي</SelectItem>
                <SelectItem value="EUR">EUR — يورو</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">عدد الأصفار العشرية</label>
            <Select value={String(settings.decimals ?? 3)} onValueChange={v => update("decimals", Number(v))}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0 (بدون كسور)</SelectItem>
                <SelectItem value="2">2 (مثال: 1,000.00)</SelectItem>
                <SelectItem value="3">3 (مثال: 1,000.000)</SelectItem>
                <SelectItem value="4">4 (دقة عالية)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">بادئة الدولة الافتراضية للهاتف (واتساب/SMS)</label>
            <Select value={settings.defaultCountryCode ?? "968"} onValueChange={v => update("defaultCountryCode", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {COUNTRY_DIALS.map(c => (
                  <SelectItem key={c.iso} value={c.code}>
                    {c.flag} +{c.code} — {c.nameAr} ({c.nameEn})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">تُستخدم تلقائياً عند توليد روابط واتساب من أرقام بدون بادئة.</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">العملة وعدد الأصفار وبادئة الدولة تُطبَّق تلقائياً على المستندات والروابط. اضغط حفظ.</p>
      </div>

      {/* PDF Template Settings */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><FileText size={16} className="text-primary" /> تخصيص قوالب PDF</h3>
          <Button variant="outline" size="sm" onClick={handlePreview} className="border-border text-foreground hover:bg-secondary gap-1 text-xs">
            <Eye size={14} /> معاينة القالب
          </Button>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1"><Palette size={12} /> اللون الرئيسي للمستندات</label>
          <div className="flex items-center gap-2 flex-wrap">
            {colorPresets.map(c => (
              <button key={c.value} onClick={() => update("primaryColor", c.value)}
                className={`w-9 h-9 rounded-lg border-2 transition-all ${settings.primaryColor === c.value ? "border-foreground scale-110" : "border-border"}`}
                style={{ background: c.value }} title={c.label} />
            ))}
            <Input type="color" value={settings.primaryColor} onChange={e => update("primaryColor", e.target.value)}
              className="w-9 h-9 p-0 border-border rounded-lg cursor-pointer" />
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
          <span className="text-sm text-foreground">إظهار العلامة المائية</span>
          <Switch checked={settings.showWatermark} onCheckedChange={v => update("showWatermark", v)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">نص التذييل المخصص (اتركه فارغاً للنص الافتراضي)</label>
          <Input value={settings.footerText} onChange={e => update("footerText", e.target.value)}
            placeholder="نص تذييل مخصص..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
        </div>
      </div>

      {/* Save / Reset Settings */}
      <div className="flex gap-3">
        <Button onClick={handleSave} className="gradient-gold text-primary-foreground shadow-gold hover:opacity-90">حفظ الإعدادات</Button>
        <Button onClick={handleReset} variant="outline" className="border-border text-foreground hover:bg-secondary gap-1">
          <RotateCcw size={14} /> إعادة الافتراضي
        </Button>
      </div>

      {/* Role switcher removed: roles are sourced from the authenticated profile (server-enforced). */}

      {/* Users Management */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <User size={16} className="text-primary" /> المستخدمين والصلاحيات
          </h3>
          {allowEdit && (
            <Button size="sm" onClick={openNewUser} className="gradient-gold text-primary-foreground gap-1 text-xs hover:opacity-90">
              <Plus size={14} /> مستخدم جديد
            </Button>
          )}
        </div>

        {users.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-6">لا يوجد مستخدمون بعد.</p>
        ) : (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full gradient-gold flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                    {u.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-foreground font-medium truncate">{u.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                        {ROLE_LABELS[u.role]}
                      </span>
                      {u.status === "suspended" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">موقوف</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{u.email}{u.phone ? ` • ${u.phone}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {allowEdit && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditUser(u)} title="تعديل">
                      <Edit size={14} />
                    </Button>
                  )}
                  {allowDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeletingUser(u)}
                      title="حذف"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Form Dialog */}
      <Dialog open={showUserForm} onOpenChange={setShowUserForm}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingUser ? `تعديل ${editingUser.name}` : "مستخدم جديد"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs text-muted-foreground">الاسم الكامل *</label>
              <Input value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">البريد الإلكتروني *</label>
              <Input type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">رقم الهاتف</label>
              <Input value={userForm.phone || ""} onChange={e => setUserForm({ ...userForm, phone: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الدور / الصلاحية *</label>
              <Select value={userForm.role} onValueChange={(v: Role) => setUserForm({ ...userForm, role: v })}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الحالة</label>
              <Select value={userForm.status} onValueChange={(v: "active" | "suspended") => setUserForm({ ...userForm, status: v })}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="suspended">موقوف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 p-3 rounded-lg bg-secondary/40 border border-border/50">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground">{ROLE_LABELS[userForm.role]}:</strong> {ROLE_DESCRIPTIONS[userForm.role]}
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSaveUser} className="gradient-gold text-primary-foreground flex-1">حفظ</Button>
            <Button variant="outline" onClick={() => setShowUserForm(false)} className="border-border">إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deletingUser}
        onOpenChange={(o) => !o && setDeletingUser(null)}
        onConfirm={handleDeleteUser}
        title={`حذف ${deletingUser?.name || ""}`}
        description="سيتم حذف المستخدم نهائياً. لن يتمكن من الدخول مرة أخرى."
      />

      <PdfPreviewDialog open={showPreview} onOpenChange={setShowPreview} htmlContent={previewHtml} title="معاينة القالب" />
    </div>
  );
}
