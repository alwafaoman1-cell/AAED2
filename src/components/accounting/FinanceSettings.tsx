import { useEffect, useRef, useState } from "react";
import {
  Tags, TrendingDown, TrendingUp, Receipt, Wallet, Plus, Trash2, Edit3,
  Save, X, Camera, Image as ImageIcon, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  expenseCategoriesStore,
  incomeCategoriesStore,
  employeeCashboxesStore,
  voucherSettingsStore,
  PAYMENT_METHOD_LABELS,
  type FinanceCategory,
  type EmployeeCashbox,
  type VoucherSettings,
  type PaymentMethod,
} from "@/lib/financeSettingsStore";

function useStoreSubscription(subscribe: (cb: () => void) => () => void) {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);
}

// ============================ Categories Section ============================
interface CategorySectionProps {
  title: string;
  description: string;
  Icon: typeof Tags;
  variant: "expense" | "income";
  store: typeof expenseCategoriesStore;
}

function CategorySection({ title, description, Icon, variant, store }: CategorySectionProps) {
  useStoreSubscription(store.subscribe);
  const items = store.getAll();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<FinanceCategory>>({});
  const [adding, setAdding] = useState(false);

  const accent = variant === "expense" ? "text-destructive" : "text-success";
  const accentBg = variant === "expense" ? "bg-destructive/10" : "bg-success/10";

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft({ name: "", description: "", color: variant === "expense" ? "#ef4444" : "#22c55e", active: true });
  }

  function startEdit(item: FinanceCategory) {
    setEditingId(item.id);
    setAdding(false);
    setDraft({ ...item });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft({});
  }

  function save() {
    if (!draft.name?.trim()) {
      toast({ title: "الاسم مطلوب", variant: "destructive" });
      return;
    }
    if (adding) {
      store.add({
        id: `${variant === "expense" ? "EC" : "IC"}-${Date.now()}`,
        name: draft.name.trim(),
        description: draft.description || "",
        color: draft.color || "#6b7280",
        active: draft.active ?? true,
        createdAt: new Date().toISOString(),
      });
      toast({ title: "تم إضافة التصنيف" });
    } else if (editingId) {
      store.update(editingId, draft);
      toast({ title: "تم تحديث التصنيف" });
    }
    cancel();
  }

  function remove(id: string) {
    store.remove(id);
    toast({ title: "تم حذف التصنيف" });
  }

  function toggleActive(item: FinanceCategory) {
    store.update(item.id, { active: !item.active });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${accentBg} ${accent} flex items-center justify-center`}>
            <Icon size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button size="sm" onClick={startAdd} disabled={adding}>
          <Plus size={14} className="ml-1" /> إضافة
        </Button>
      </div>

      {adding && (
        <CategoryForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} />
      )}

      <div className="space-y-2 mt-3">
        {items.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground text-center py-6">لا توجد تصنيفات بعد. اضغط "إضافة" للبدء.</p>
        )}
        {items.map((item) =>
          editingId === item.id ? (
            <CategoryForm key={item.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} />
          ) : (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: item.color || "#6b7280" }}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-foreground font-medium">{item.name}</p>
                    {!item.active && <Badge variant="outline" className="text-[10px]">معطل</Badge>}
                  </div>
                  {item.description && <p className="text-[11px] text-muted-foreground">{item.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={item.active} onCheckedChange={() => toggleActive(item)} />
                <Button size="icon" variant="ghost" onClick={() => startEdit(item)}>
                  <Edit3 size={14} />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(item.id)}>
                  <Trash2 size={14} className="text-destructive" />
                </Button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function CategoryForm({
  draft, setDraft, onSave, onCancel,
}: {
  draft: Partial<FinanceCategory>;
  setDraft: (d: Partial<FinanceCategory>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <Label className="text-xs">الاسم</Label>
          <Input
            value={draft.name || ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="مثال: قطع غيار"
          />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">الوصف (اختياري)</Label>
          <Input
            value={draft.description || ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="وصف مختصر للتصنيف"
          />
        </div>
        <div>
          <Label className="text-xs">اللون</Label>
          <Input
            type="color"
            value={draft.color || "#6b7280"}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            className="h-9 p-1"
          />
        </div>
        <div className="flex items-end gap-2">
          <Switch
            checked={draft.active ?? true}
            onCheckedChange={(v) => setDraft({ ...draft, active: v })}
          />
          <span className="text-xs text-muted-foreground">مفعل</span>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X size={14} className="ml-1" /> إلغاء
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save size={14} className="ml-1" /> حفظ
        </Button>
      </div>
    </div>
  );
}

// ============================ Voucher Settings Section ============================
function VoucherSettingsSection() {
  useStoreSubscription(voucherSettingsStore.subscribe);
  const settings = voucherSettingsStore.get();
  const { toast } = useToast();
  const [local, setLocal] = useState<VoucherSettings>(settings);

  useEffect(() => setLocal(settings), [settings.receiptPrefix, settings.paymentPrefix]);

  function update<K extends keyof VoucherSettings>(key: K, value: VoucherSettings[K]) {
    setLocal((s) => ({ ...s, [key]: value }));
  }

  function save() {
    voucherSettingsStore.update(local);
    toast({ title: "تم حفظ إعدادات السندات" });
  }

  const samplePayment = `${local.paymentPrefix}-${new Date().getFullYear()}-${String(local.paymentNextNumber).padStart(local.numberPadding, "0")}`;
  const sampleReceipt = `${local.receiptPrefix}-${new Date().getFullYear()}-${String(local.receiptNextNumber).padStart(local.numberPadding, "0")}`;

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center">
          <Receipt size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">إعدادات سندات الصرف والقبض</h3>
          <p className="text-[11px] text-muted-foreground">حدد آلية إدخال القيود المحاسبية للإيرادات والمصروفات</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Auto numbering */}
        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2">الترقيم التلقائي</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">بادئة سند القبض</Label>
              <Input value={local.receiptPrefix} onChange={(e) => update("receiptPrefix", e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label className="text-xs">بادئة سند الصرف</Label>
              <Input value={local.paymentPrefix} onChange={(e) => update("paymentPrefix", e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label className="text-xs">رقم القبض التالي</Label>
              <Input
                type="number"
                value={local.receiptNextNumber}
                onChange={(e) => update("receiptNextNumber", parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <Label className="text-xs">رقم الصرف التالي</Label>
              <Input
                type="number"
                value={local.paymentNextNumber}
                onChange={(e) => update("paymentNextNumber", parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <Label className="text-xs">عدد خانات الترقيم</Label>
              <Input
                type="number"
                min={3}
                max={8}
                value={local.numberPadding}
                onChange={(e) => update("numberPadding", parseInt(e.target.value) || 4)}
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-secondary/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground">معاينة سند قبض</p>
              <p className="text-sm font-mono font-bold text-success">{sampleReceipt}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground">معاينة سند صرف</p>
              <p className="text-sm font-mono font-bold text-destructive">{samplePayment}</p>
            </div>
          </div>
        </div>

        {/* Payment method */}
        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2">طريقة الدفع الافتراضية</h4>
          <Select
            value={local.defaultPaymentMethod}
            onValueChange={(v) => update("defaultPaymentMethod", v as PaymentMethod)}
          >
            <SelectTrigger className="w-full md:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cashbox auto link */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
          <div>
            <p className="text-sm font-medium text-foreground">ربط القيد بالخزينة تلقائياً</p>
            <p className="text-[11px] text-muted-foreground">كل سند يُسجّل في خزينة الموظف الذي أنشأه</p>
          </div>
          <Switch
            checked={local.autoLinkToCashbox}
            onCheckedChange={(v) => update("autoLinkToCashbox", v)}
          />
        </div>

        {/* Photo attachment */}
        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
            <Camera size={14} /> صور سندات الصرف
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
              <div className="flex items-start gap-2">
                <ImageIcon size={16} className="text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">إلزام إرفاق صورة لكل سند صرف</p>
                  <p className="text-[11px] text-muted-foreground">لا يمكن حفظ السند بدون صورة الإيصال</p>
                </div>
              </div>
              <Switch
                checked={local.paymentVoucherRequirePhoto}
                onCheckedChange={(v) => update("paymentVoucherRequirePhoto", v)}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
              <div className="flex items-start gap-2">
                <Camera size={16} className="text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">السماح بالتقاط الصورة من كاميرا الهاتف</p>
                  <p className="text-[11px] text-muted-foreground">يفتح الكاميرا مباشرة عند الإرفاق</p>
                </div>
              </div>
              <Switch
                checked={local.paymentVoucherAllowCamera}
                onCheckedChange={(v) => update("paymentVoucherAllowCamera", v)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-border">
          <Button onClick={save}>
            <Save size={14} className="ml-1" /> حفظ الإعدادات
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================ Employee Cashboxes Section ============================
function EmployeeCashboxesSection() {
  useStoreSubscription(employeeCashboxesStore.subscribe);
  const items = employeeCashboxesStore.getAll();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<EmployeeCashbox>>({});

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft({ employeeName: "", cashboxName: "", openingBalance: 0, currentBalance: 0, isDefault: false, active: true });
  }

  function startEdit(item: EmployeeCashbox) {
    setEditingId(item.id);
    setAdding(false);
    setDraft({ ...item });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft({});
  }

  function save() {
    if (!draft.employeeName?.trim() || !draft.cashboxName?.trim()) {
      toast({ title: "اسم الموظف والخزينة مطلوبان", variant: "destructive" });
      return;
    }
    if (adding) {
      employeeCashboxesStore.add({
        id: `CB-${Date.now()}`,
        employeeName: draft.employeeName.trim(),
        cashboxName: draft.cashboxName.trim(),
        openingBalance: Number(draft.openingBalance) || 0,
        currentBalance: Number(draft.currentBalance ?? draft.openingBalance) || 0,
        isDefault: draft.isDefault ?? false,
        active: draft.active ?? true,
        createdAt: new Date().toISOString(),
      });
      toast({ title: "تم إضافة الخزينة" });
    } else if (editingId) {
      employeeCashboxesStore.update(editingId, draft);
      toast({ title: "تم تحديث الخزينة" });
    }
    cancel();
  }

  function remove(id: string) {
    employeeCashboxesStore.remove(id);
    toast({ title: "تم حذف الخزينة" });
  }

  function setDefault(id: string) {
    items.forEach((it) => employeeCashboxesStore.update(it.id, { isDefault: it.id === id }));
    toast({ title: "تم تعيين الخزينة الافتراضية" });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
            <Wallet size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">خزائن الموظفين</h3>
            <p className="text-[11px] text-muted-foreground">حدد الخزينة الافتراضية لكل موظف لتسجيل العمليات</p>
          </div>
        </div>
        <Button size="sm" onClick={startAdd} disabled={adding}>
          <Plus size={14} className="ml-1" /> إضافة خزينة
        </Button>
      </div>

      {adding && (
        <CashboxForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} />
      )}

      <div className="space-y-2 mt-3">
        {items.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground text-center py-6">لا توجد خزائن بعد. اضغط "إضافة خزينة" للبدء.</p>
        )}
        {items.map((item) =>
          editingId === item.id ? (
            <CashboxForm key={item.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} />
          ) : (
            <div
              key={item.id}
              className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-lg border border-border/60 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-warning/15 text-warning flex items-center justify-center">
                  <Wallet size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{item.employeeName}</p>
                    {item.isDefault && (
                      <Badge className="text-[10px] bg-warning/20 text-warning hover:bg-warning/20">
                        <Star size={10} className="ml-1" /> افتراضية
                      </Badge>
                    )}
                    {!item.active && <Badge variant="outline" className="text-[10px]">معطل</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{item.cashboxName}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">الرصيد الحالي</p>
                  <p className="text-sm font-bold text-foreground">{item.currentBalance.toLocaleString()} ر.ع</p>
                </div>
                <div className="flex items-center gap-1">
                  {!item.isDefault && (
                    <Button size="icon" variant="ghost" title="تعيين كافتراضية" onClick={() => setDefault(item.id)}>
                      <Star size={14} />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => startEdit(item)}>
                    <Edit3 size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(item.id)}>
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function CashboxForm({
  draft, setDraft, onSave, onCancel,
}: {
  draft: Partial<EmployeeCashbox>;
  setDraft: (d: Partial<EmployeeCashbox>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">اسم الموظف</Label>
          <Input
            value={draft.employeeName || ""}
            onChange={(e) => setDraft({ ...draft, employeeName: e.target.value })}
            placeholder="مثال: محمد العبري"
          />
        </div>
        <div>
          <Label className="text-xs">اسم الخزينة</Label>
          <Input
            value={draft.cashboxName || ""}
            onChange={(e) => setDraft({ ...draft, cashboxName: e.target.value })}
            placeholder="مثال: خزينة الاستقبال"
          />
        </div>
        <div>
          <Label className="text-xs">الرصيد الافتتاحي (ر.ع)</Label>
          <Input
            type="number"
            value={draft.openingBalance ?? 0}
            onChange={(e) => setDraft({ ...draft, openingBalance: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label className="text-xs">الرصيد الحالي (ر.ع)</Label>
          <Input
            type="number"
            value={draft.currentBalance ?? draft.openingBalance ?? 0}
            onChange={(e) => setDraft({ ...draft, currentBalance: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center gap-3 pt-5">
          <Switch
            checked={draft.isDefault ?? false}
            onCheckedChange={(v) => setDraft({ ...draft, isDefault: v })}
          />
          <span className="text-xs text-muted-foreground">الخزينة الافتراضية</span>
        </div>
        <div className="flex items-center gap-3 pt-5">
          <Switch
            checked={draft.active ?? true}
            onCheckedChange={(v) => setDraft({ ...draft, active: v })}
          />
          <span className="text-xs text-muted-foreground">مفعلة</span>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X size={14} className="ml-1" /> إلغاء
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save size={14} className="ml-1" /> حفظ
        </Button>
      </div>
    </div>
  );
}

// ============================ Main Component ============================
export default function FinanceSettings() {
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-l from-primary/10 to-transparent border border-primary/20 rounded-xl p-4">
        <h2 className="text-lg font-bold text-foreground">إعدادات المالية</h2>
        <p className="text-xs text-muted-foreground mt-1">
          إدارة تصنيفات المصروفات والإيرادات، إعدادات السندات، وخزائن الموظفين
        </p>
      </div>

      <Tabs defaultValue="expense-cats" dir="rtl" className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="expense-cats" className="text-xs">
            <TrendingDown size={14} className="ml-1" /> تصنيفات المصروفات
          </TabsTrigger>
          <TabsTrigger value="income-cats" className="text-xs">
            <TrendingUp size={14} className="ml-1" /> تصنيفات الدخل
          </TabsTrigger>
          <TabsTrigger value="vouchers" className="text-xs">
            <Receipt size={14} className="ml-1" /> سندات الصرف والقبض
          </TabsTrigger>
          <TabsTrigger value="cashboxes" className="text-xs">
            <Wallet size={14} className="ml-1" /> خزائن الموظفين
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expense-cats">
          <CategorySection
            title="تصنيفات المصروفات"
            description="أنشئ تصنيفات متعددة لتجميع المصروفات وتسهيل التصفية في القوائم والتقارير"
            Icon={TrendingDown}
            variant="expense"
            store={expenseCategoriesStore}
          />
        </TabsContent>

        <TabsContent value="income-cats">
          <CategorySection
            title="تصنيفات حسابات الدخل"
            description="أنشئ تصنيفات متعددة لتجميع حسابات الدخل وتسهيل التصفية في القوائم والتقارير"
            Icon={TrendingUp}
            variant="income"
            store={incomeCategoriesStore}
          />
        </TabsContent>

        <TabsContent value="vouchers">
          <VoucherSettingsSection />
        </TabsContent>

        <TabsContent value="cashboxes">
          <EmployeeCashboxesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
