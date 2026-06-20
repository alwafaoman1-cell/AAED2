import { useEffect, useMemo, useRef, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, Save, Camera, Trash2, Plus, Phone, Mail, MapPin, IdCard,
  Briefcase, Calendar, Wallet, FileText, Award, Clock, Coins, AlertTriangle, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  hrStore, type Employee, type Advance, type Deduction, type Bonus, type Leave,
  type Attendance, type Payslip, type EmployeeDocument, type PerformanceReview,
  HR_DEPARTMENTS_AR, HR_POSITIONS_AR,
} from "@/lib/hrStore";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";

export default function EmployeeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const [, force] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    const u = hrStore.subscribe(() => force((x) => x + 1));
    return () => { u(); };
  }, []);

  const employee = useMemo(() => hrStore.getEmployee(id), [id, force]);
  const [draft, setDraft] = useState<Employee | null>(employee || null);

  useEffect(() => { if (employee) setDraft(employee); }, [employee?.id]);

  if (!employee || !draft) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">{isAr ? "الموظف غير موجود" : "Not found"}</p>
        <Button className="mt-4" onClick={() => smartBack(navigate, "/staff")}>{isAr ? "عودة" : "Back"}</Button>
      </div>
    );
  }

  function update<K extends keyof Employee>(k: K, v: Employee[K]) {
    setDraft((d) => d ? { ...d, [k]: v } : d);
  }
  function save() {
    if (!draft.name.trim()) { toast.error(isAr ? "الاسم مطلوب" : "Name required"); return; }
    hrStore.saveEmployee(draft);
    toast.success(isAr ? "تم الحفظ" : "Saved");
  }
  async function avatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error(isAr ? "الحد 10MB" : "Max 10MB"); return; }
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const dataUrl = await fileToWebpDataUrl(f, { maxDimension: 1024 });
    const updated = { ...draft, avatarUrl: dataUrl };
    hrStore.saveEmployee(updated);
    setDraft(updated);
    toast.success(isAr ? "تم تحديث الصورة" : "Avatar updated");
    e.target.value = "";
  }
  function doDelete() {
    hrStore.removeEmployee(employee.id);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    navigate("/staff");
  }

  // Computed
  const summary = hrStore.summary(employee.id);
  const totalGrossSalary = (draft.baseSalary || 0) + (draft.housingAllowance || 0) +
    (draft.transportAllowance || 0) + (draft.otherAllowances || 0);
  const netSalary = totalGrossSalary + summary.monthBonuses - summary.monthDeductions - summary.advanceMonthlyRepay;

  return (
    <div className="space-y-4 max-w-6xl mx-auto" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/staff")}>
            <ArrowLeft className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{draft.name || (isAr ? "موظف جديد" : "New employee")}</h1>
              <span className="text-xs font-mono text-muted-foreground">{draft.employeeNumber}</span>
            </div>
            <div className="text-xs text-muted-foreground">{draft.position || "—"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setConfirmDel(true)} className="text-destructive">
            <Trash2 className="h-4 w-4 me-2" /> {isAr ? "حذف" : "Delete"}
          </Button>
          <Button onClick={save} className="gap-2"><Save className="h-4 w-4" /> {isAr ? "حفظ" : "Save"}</Button>
        </div>
      </div>

      {/* Profile card */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="relative">
            <Avatar className="w-24 h-24 border-4 border-background shadow-lg">
              <AvatarImage src={draft.avatarUrl} />
              <AvatarFallback className="text-xl gradient-gold text-primary-foreground">{(draft.name || "؟").slice(0, 2)}</AvatarFallback>
            </Avatar>
            <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 end-0 bg-primary text-primary-foreground p-1.5 rounded-full shadow">
              <Camera className="h-3 w-3" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={avatarUpload} />
          </div>
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label={isAr ? "الراتب الإجمالي" : "Gross"} value={`${totalGrossSalary.toFixed(3)} ر.ع`} icon={<Wallet className="h-3 w-3" />} />
            <Stat label={isAr ? "صافي الشهر" : "Net (month)"} value={`${netSalary.toFixed(3)} ر.ع`} icon={<Coins className="h-3 w-3" />} highlight />
            <Stat label={isAr ? "السلف المتبقية" : "Outstanding adv."} value={`${summary.totalAdvancesOutstanding.toFixed(3)} ر.ع`} icon={<AlertTriangle className="h-3 w-3" />} />
            <Stat label={isAr ? "المكافآت/الخصومات (شهر)" : "Bonus / deduct"} value={`+${summary.monthBonuses.toFixed(0)} / -${summary.monthDeductions.toFixed(0)}`} icon={<Award className="h-3 w-3" />} />
          </div>
        </div>
      </Card>

      <Tabs defaultValue="info">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="info">{isAr ? "الملف الشخصي" : "Profile"}</TabsTrigger>
          <TabsTrigger value="contract">{isAr ? "العقد والوظيفة" : "Contract"}</TabsTrigger>
          <TabsTrigger value="salary">{isAr ? "الراتب والمالية" : "Salary"}</TabsTrigger>
          <TabsTrigger value="advances">{isAr ? "السلف" : "Advances"}</TabsTrigger>
          <TabsTrigger value="deductions">{isAr ? "خصومات/مكافآت" : "Deduct./Bonus"}</TabsTrigger>
          <TabsTrigger value="payslips">{isAr ? "كشوف الرواتب" : "Payslips"}</TabsTrigger>
          <TabsTrigger value="leaves">{isAr ? "الإجازات" : "Leaves"}</TabsTrigger>
          <TabsTrigger value="attendance">{isAr ? "الحضور" : "Attendance"}</TabsTrigger>
          <TabsTrigger value="documents">{isAr ? "المستندات" : "Documents"}</TabsTrigger>
          <TabsTrigger value="performance">{isAr ? "الأداء" : "Performance"}</TabsTrigger>
        </TabsList>

        {/* PROFILE */}
        <TabsContent value="info" className="mt-4">
          <Card className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={isAr ? "الاسم الكامل" : "Full name"}>
              <Input value={draft.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label={isAr ? "الاسم بالإنجليزية" : "Name (EN)"}>
              <Input value={draft.nameEn || ""} onChange={(e) => update("nameEn", e.target.value)} />
            </Field>
            <Field label={isAr ? "الرقم المدني" : "National ID"}>
              <Input value={draft.nationalId || ""} onChange={(e) => update("nationalId", e.target.value)} />
            </Field>
            <Field label={isAr ? "رقم الجواز" : "Passport"}>
              <Input value={draft.passportNo || ""} onChange={(e) => update("passportNo", e.target.value)} />
            </Field>
            <Field label={isAr ? "الجنسية" : "Nationality"}>
              <Input value={draft.nationality || ""} onChange={(e) => update("nationality", e.target.value)} />
            </Field>
            <Field label={isAr ? "تاريخ الميلاد" : "Date of birth"}>
              <Input type="date" value={draft.dateOfBirth || ""} onChange={(e) => update("dateOfBirth", e.target.value)} />
            </Field>
            <Field label={isAr ? "الجنس" : "Gender"}>
              <Select value={draft.gender || ""} onValueChange={(v) => update("gender", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{isAr ? "ذكر" : "Male"}</SelectItem>
                  <SelectItem value="female">{isAr ? "أنثى" : "Female"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={isAr ? "الحالة الاجتماعية" : "Marital"}>
              <Select value={draft.maritalStatus || ""} onValueChange={(v) => update("maritalStatus", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">{isAr ? "أعزب" : "Single"}</SelectItem>
                  <SelectItem value="married">{isAr ? "متزوج" : "Married"}</SelectItem>
                  <SelectItem value="divorced">{isAr ? "مطلق" : "Divorced"}</SelectItem>
                  <SelectItem value="widowed">{isAr ? "أرمل" : "Widowed"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={isAr ? "الهاتف" : "Phone"}>
              <Input value={draft.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            </Field>
            <Field label={isAr ? "هاتف الطوارئ" : "Emergency phone"}>
              <Input value={draft.emergencyPhone || ""} onChange={(e) => update("emergencyPhone", e.target.value)} />
            </Field>
            <Field label={isAr ? "البريد الإلكتروني" : "Email"}>
              <Input type="email" value={draft.email || ""} onChange={(e) => update("email", e.target.value)} />
            </Field>
            <Field label={isAr ? "العنوان" : "Address"}>
              <Input value={draft.address || ""} onChange={(e) => update("address", e.target.value)} />
            </Field>
          </Card>
        </TabsContent>

        {/* CONTRACT */}
        <TabsContent value="contract" className="mt-4">
          <Card className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={isAr ? "المسمى الوظيفي" : "Position"}>
              <Input value={draft.position} onChange={(e) => update("position", e.target.value)} list="hr-positions" />
              <datalist id="hr-positions">
                {HR_POSITIONS_AR.map((p) => <option key={p} value={p} />)}
              </datalist>
            </Field>
            <Field label={isAr ? "القسم" : "Department"}>
              <Input value={draft.department || ""} onChange={(e) => update("department", e.target.value)} list="hr-departments" />
              <datalist id="hr-departments">
                {HR_DEPARTMENTS_AR.map((d) => <option key={d} value={d} />)}
              </datalist>
            </Field>
            <Field label={isAr ? "نوع العقد" : "Contract type"}>
              <Select value={draft.contractType || ""} onValueChange={(v) => update("contractType", v as any)}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر" : "Select"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">{isAr ? "دوام كامل" : "Full time"}</SelectItem>
                  <SelectItem value="part_time">{isAr ? "دوام جزئي" : "Part time"}</SelectItem>
                  <SelectItem value="contract">{isAr ? "عقد" : "Contract"}</SelectItem>
                  <SelectItem value="freelance">{isAr ? "مستقل" : "Freelance"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={isAr ? "حالة الموظف" : "Status"}>
              <Select value={draft.employmentStatus} onValueChange={(v) => update("employmentStatus", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
                  <SelectItem value="on_leave">{isAr ? "في إجازة" : "On leave"}</SelectItem>
                  <SelectItem value="suspended">{isAr ? "موقوف" : "Suspended"}</SelectItem>
                  <SelectItem value="terminated">{isAr ? "انتهت خدمته" : "Terminated"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={isAr ? "تاريخ التعيين" : "Hire date"}>
              <Input type="date" value={draft.hireDate || ""} onChange={(e) => update("hireDate", e.target.value)} />
            </Field>
            <Field label={isAr ? "المدير المباشر" : "Manager"}>
              <Input value={draft.manager || ""} onChange={(e) => update("manager", e.target.value)} />
            </Field>
            <Field label={isAr ? "بداية العقد" : "Contract start"}>
              <Input type="date" value={draft.contractStartDate || ""} onChange={(e) => update("contractStartDate", e.target.value)} />
            </Field>
            <Field label={isAr ? "نهاية العقد" : "Contract end"}>
              <Input type="date" value={draft.contractEndDate || ""} onChange={(e) => update("contractEndDate", e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <Label>{isAr ? "ملاحظات العقد" : "Contract notes"}</Label>
              <Textarea rows={3} value={draft.notes || ""} onChange={(e) => update("notes", e.target.value)} />
            </div>
          </Card>
        </TabsContent>

        {/* SALARY */}
        <TabsContent value="salary" className="mt-4">
          <Card className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={isAr ? "الراتب الأساسي" : "Base salary"}>
              <Input type="number" step="0.001" value={draft.baseSalary} onChange={(e) => update("baseSalary", Number(e.target.value) || 0)} />
            </Field>
            <Field label={isAr ? "بدل سكن" : "Housing"}>
              <Input type="number" step="0.001" value={draft.housingAllowance || 0} onChange={(e) => update("housingAllowance", Number(e.target.value) || 0)} />
            </Field>
            <Field label={isAr ? "بدل مواصلات" : "Transport"}>
              <Input type="number" step="0.001" value={draft.transportAllowance || 0} onChange={(e) => update("transportAllowance", Number(e.target.value) || 0)} />
            </Field>
            <Field label={isAr ? "بدلات أخرى" : "Other allowances"}>
              <Input type="number" step="0.001" value={draft.otherAllowances || 0} onChange={(e) => update("otherAllowances", Number(e.target.value) || 0)} />
            </Field>
            <Field label={isAr ? "اسم البنك" : "Bank name"}>
              <Input value={draft.bankName || ""} onChange={(e) => update("bankName", e.target.value)} />
            </Field>
            <Field label={isAr ? "رقم الحساب" : "Account no."}>
              <Input value={draft.bankAccount || ""} onChange={(e) => update("bankAccount", e.target.value)} />
            </Field>
            <Field label="IBAN">
              <Input value={draft.iban || ""} onChange={(e) => update("iban", e.target.value)} />
            </Field>
            <div className="md:col-span-2 mt-2 p-4 bg-muted/30 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>{isAr ? "الإجمالي" : "Gross total"}</span>
                <span className="font-mono font-bold">{totalGrossSalary.toFixed(3)} ر.ع</span>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ADVANCES */}
        <TabsContent value="advances" className="mt-4">
          <AdvancesTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>

        {/* DEDUCTIONS / BONUSES */}
        <TabsContent value="deductions" className="mt-4">
          <DeductionsBonusesTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>

        {/* PAYSLIPS */}
        <TabsContent value="payslips" className="mt-4">
          <PayslipsTab employee={draft} isAr={isAr} />
        </TabsContent>

        {/* LEAVES */}
        <TabsContent value="leaves" className="mt-4">
          <LeavesTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>

        {/* ATTENDANCE */}
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>

        {/* DOCUMENTS */}
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>

        {/* PERFORMANCE */}
        <TabsContent value="performance" className="mt-4">
          <PerformanceTab employeeId={employee.id} isAr={isAr} />
        </TabsContent>
      </Tabs>

      <ConfirmDeleteDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        onConfirm={doDelete}
        title={isAr ? "حذف الموظف" : "Delete employee"}
        description={isAr ? "هل أنت متأكد من حذف هذا الموظف؟" : "Delete this employee?"}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>;
}
function Stat({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`}>
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className={`text-sm font-semibold mt-1 font-mono ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

/* ====================== ADVANCES ====================== */
function AdvancesTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const advances = hrStore.listAdvances(employeeId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Advance>(() => emptyAdvance(employeeId));
  function add() { setForm(emptyAdvance(employeeId)); setOpen(true); }
  function save() {
    if (form.amount <= 0) { toast.error(isAr ? "أدخل قيمة" : "Enter amount"); return; }
    const monthly = form.installments > 0 ? form.amount / form.installments : form.amount;
    hrStore.saveAdvance({ ...form, monthlyDeduction: monthly, remainingAmount: form.amount });
    toast.success(isAr ? "تمت إضافة السلفة" : "Added");
    setOpen(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{isAr ? "إجمالي السلف غير المسددة" : "Outstanding"}: <strong className="text-foreground font-mono">{advances.reduce((s, a) => s + a.remainingAmount, 0).toFixed(3)} ر.ع</strong></div>
        <Button size="sm" onClick={add} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "سلفة جديدة" : "New advance"}</Button>
      </div>
      <Card className="divide-y">
        {advances.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد سلف" : "No advances"}</div>}
        {advances.map((a) => (
          <div key={a.id} className="p-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">{a.amount.toFixed(3)} ر.ع <span className="text-xs text-muted-foreground">({a.installments} {isAr ? "قسط" : "inst."})</span></div>
              <div className="text-xs text-muted-foreground">{a.date} — {a.reason || "—"}</div>
            </div>
            <div className="text-end">
              <div className="text-xs text-muted-foreground">{isAr ? "متبقي" : "Remaining"}</div>
              <div className="font-mono font-bold">{a.remainingAmount.toFixed(3)}</div>
            </div>
            <button onClick={() => { hrStore.removeAdvance(a.id); toast.success(isAr ? "تم الحذف" : "Deleted"); }} className="text-destructive p-1.5 hover:bg-destructive/10 rounded">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "سلفة جديدة" : "New advance"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>{isAr ? "القيمة" : "Amount"}</Label><Input type="number" step="0.001" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
            <div><Label>{isAr ? "عدد الأقساط" : "Installments"}</Label><Input type="number" value={form.installments} onChange={(e) => setForm({ ...form, installments: Number(e.target.value) || 1 })} /></div>
            <div><Label>{isAr ? "السبب" : "Reason"}</Label><Input value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            <div>
              <Label>{isAr ? "الحالة" : "Status"}</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{isAr ? "قيد الانتظار" : "Pending"}</SelectItem>
                  <SelectItem value="approved">{isAr ? "معتمدة" : "Approved"}</SelectItem>
                  <SelectItem value="paid">{isAr ? "مصروفة" : "Paid"}</SelectItem>
                  <SelectItem value="rejected">{isAr ? "مرفوضة" : "Rejected"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function emptyAdvance(employeeId: string): Advance {
  return {
    id: hrStore.uid(), employeeId, date: new Date().toISOString().slice(0, 10),
    amount: 0, installments: 1, status: "pending", remainingAmount: 0, createdAt: hrStore.nowIso(),
  };
}

/* ====================== DEDUCTIONS / BONUSES ====================== */
function DeductionsBonusesTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const [tab, setTab] = useState<"deductions" | "bonuses">("deductions");
  const deductions = hrStore.listDeductions(employeeId);
  const bonuses = hrStore.listBonuses(employeeId);
  const [open, setOpen] = useState(false);
  const [dForm, setDForm] = useState<Deduction>(() => ({ id: hrStore.uid(), employeeId, date: new Date().toISOString().slice(0,10), amount: 0, reason: "", type: "violation", createdAt: hrStore.nowIso() }));
  const [bForm, setBForm] = useState<Bonus>(() => ({ id: hrStore.uid(), employeeId, date: new Date().toISOString().slice(0,10), amount: 0, reason: "", type: "performance", createdAt: hrStore.nowIso() }));

  function saveD() { if (dForm.amount <= 0 || !dForm.reason) { toast.error(isAr ? "املأ الحقول" : "Fill fields"); return; } hrStore.saveDeduction(dForm); toast.success(isAr ? "تم" : "Saved"); setOpen(false); setDForm({ ...dForm, id: hrStore.uid(), amount: 0, reason: "" }); }
  function saveB() { if (bForm.amount <= 0 || !bForm.reason) { toast.error(isAr ? "املأ الحقول" : "Fill fields"); return; } hrStore.saveBonus(bForm); toast.success(isAr ? "تم" : "Saved"); setOpen(false); setBForm({ ...bForm, id: hrStore.uid(), amount: 0, reason: "" }); }

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <div className="flex justify-between items-center">
          <TabsList>
            <TabsTrigger value="deductions">{isAr ? "الخصومات" : "Deductions"} ({deductions.length})</TabsTrigger>
            <TabsTrigger value="bonuses">{isAr ? "المكافآت" : "Bonuses"} ({bonuses.length})</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setOpen(true)} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "إضافة" : "Add"}</Button>
        </div>

        <TabsContent value="deductions" className="mt-3">
          <Card className="divide-y">
            {deductions.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد خصومات" : "No deductions"}</div>}
            {deductions.map((d) => (
              <div key={d.id} className="p-3 flex items-center justify-between">
                <div><div className="font-medium">{d.reason}</div><div className="text-xs text-muted-foreground">{d.date} — {d.type}</div></div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-destructive">-{d.amount.toFixed(3)}</span>
                  <button onClick={() => hrStore.removeDeduction(d.id)} className="text-destructive p-1.5 hover:bg-destructive/10 rounded"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="bonuses" className="mt-3">
          <Card className="divide-y">
            {bonuses.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد مكافآت" : "No bonuses"}</div>}
            {bonuses.map((b) => (
              <div key={b.id} className="p-3 flex items-center justify-between">
                <div><div className="font-medium">{b.reason}</div><div className="text-xs text-muted-foreground">{b.date} — {b.type}</div></div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-success">+{b.amount.toFixed(3)}</span>
                  <button onClick={() => hrStore.removeBonus(b.id)} className="text-destructive p-1.5 hover:bg-destructive/10 rounded"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tab === "deductions" ? (isAr ? "إضافة خصم" : "Add deduction") : (isAr ? "إضافة مكافأة" : "Add bonus")}</DialogTitle></DialogHeader>
          {tab === "deductions" ? (
            <div className="space-y-3">
              <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={dForm.date} onChange={(e) => setDForm({ ...dForm, date: e.target.value })} /></div>
              <div><Label>{isAr ? "القيمة" : "Amount"}</Label><Input type="number" step="0.001" value={dForm.amount} onChange={(e) => setDForm({ ...dForm, amount: Number(e.target.value) })} /></div>
              <div><Label>{isAr ? "السبب" : "Reason"}</Label><Input value={dForm.reason} onChange={(e) => setDForm({ ...dForm, reason: e.target.value })} /></div>
              <div><Label>{isAr ? "النوع" : "Type"}</Label>
                <Select value={dForm.type} onValueChange={(v) => setDForm({ ...dForm, type: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">{isAr ? "غياب" : "Absence"}</SelectItem>
                    <SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem>
                    <SelectItem value="violation">{isAr ? "مخالفة" : "Violation"}</SelectItem>
                    <SelectItem value="advance_repayment">{isAr ? "سداد سلفة" : "Advance repay"}</SelectItem>
                    <SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={bForm.date} onChange={(e) => setBForm({ ...bForm, date: e.target.value })} /></div>
              <div><Label>{isAr ? "القيمة" : "Amount"}</Label><Input type="number" step="0.001" value={bForm.amount} onChange={(e) => setBForm({ ...bForm, amount: Number(e.target.value) })} /></div>
              <div><Label>{isAr ? "السبب" : "Reason"}</Label><Input value={bForm.reason} onChange={(e) => setBForm({ ...bForm, reason: e.target.value })} /></div>
              <div><Label>{isAr ? "النوع" : "Type"}</Label>
                <Select value={bForm.type} onValueChange={(v) => setBForm({ ...bForm, type: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="performance">{isAr ? "أداء" : "Performance"}</SelectItem>
                    <SelectItem value="overtime">{isAr ? "إضافي" : "Overtime"}</SelectItem>
                    <SelectItem value="commission">{isAr ? "عمولة" : "Commission"}</SelectItem>
                    <SelectItem value="festival">{isAr ? "عيدية" : "Festival"}</SelectItem>
                    <SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={tab === "deductions" ? saveD : saveB}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ====================== PAYSLIPS ====================== */
function PayslipsTab({ employee, isAr }: { employee: Employee; isAr: boolean }) {
  const slips = hrStore.listPayslips(employee.id);
  function generate() {
    const month = new Date().toISOString().slice(0, 7);
    if (slips.find((s) => s.month === month)) { toast.error(isAr ? "موجود لهذا الشهر" : "Already exists"); return; }
    const allowances = (employee.housingAllowance || 0) + (employee.transportAllowance || 0) + (employee.otherAllowances || 0);
    const summary = hrStore.summary(employee.id, month);
    const net = (employee.baseSalary || 0) + allowances + summary.monthBonuses - summary.monthDeductions - summary.advanceMonthlyRepay;
    hrStore.savePayslip({
      id: hrStore.uid(), employeeId: employee.id, month,
      baseSalary: employee.baseSalary || 0,
      allowances, bonuses: summary.monthBonuses, overtimeAmount: 0,
      deductions: summary.monthDeductions, advanceDeduction: summary.advanceMonthlyRepay,
      netSalary: net, createdAt: hrStore.nowIso(),
    });
    toast.success(isAr ? "تم إنشاء كشف الراتب" : "Payslip created");
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{isAr ? "كشوف الرواتب الشهرية" : "Monthly payslips"}</div>
        <Button size="sm" onClick={generate} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "إنشاء كشف الشهر" : "Generate this month"}</Button>
      </div>
      <Card className="divide-y">
        {slips.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد كشوف" : "No payslips"}</div>}
        {slips.map((p) => (
          <div key={p.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{p.month}</div>
              <span className="font-mono font-bold text-lg">{p.netSalary.toFixed(3)} ر.ع</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="p-2 bg-muted/30 rounded"><div className="text-muted-foreground">{isAr ? "أساسي" : "Base"}</div><div className="font-mono">{p.baseSalary.toFixed(3)}</div></div>
              <div className="p-2 bg-muted/30 rounded"><div className="text-muted-foreground">{isAr ? "بدلات" : "Allowances"}</div><div className="font-mono">{p.allowances.toFixed(3)}</div></div>
              <div className="p-2 bg-success/10 rounded"><div className="text-muted-foreground">{isAr ? "مكافآت" : "Bonuses"}</div><div className="font-mono text-success">+{p.bonuses.toFixed(3)}</div></div>
              <div className="p-2 bg-destructive/10 rounded"><div className="text-muted-foreground">{isAr ? "خصومات+سلف" : "Deduct+adv"}</div><div className="font-mono text-destructive">-{(p.deductions + p.advanceDeduction).toFixed(3)}</div></div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ====================== LEAVES ====================== */
function LeavesTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const leaves = hrStore.listLeaves(employeeId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Leave>(() => emptyLeave(employeeId));
  function save() {
    if (!form.startDate || !form.endDate) { toast.error(isAr ? "حدد التاريخ" : "Set dates"); return; }
    const days = Math.max(1, Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1);
    hrStore.saveLeave({ ...form, days });
    toast.success(isAr ? "تمت الإضافة" : "Saved");
    setOpen(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setForm(emptyLeave(employeeId)); setOpen(true); }} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "إجازة جديدة" : "New leave"}</Button>
      </div>
      <Card className="divide-y">
        {leaves.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد إجازات" : "No leaves"}</div>}
        {leaves.map((l) => (
          <div key={l.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{leaveTypeLabel(l.type, isAr)} — {l.days} {isAr ? "يوم" : "days"}</div>
              <div className="text-xs text-muted-foreground">{l.startDate} → {l.endDate} {l.reason && `— ${l.reason}`}</div>
            </div>
            <div className="flex items-center gap-2">
              <LeaveStatusPill status={l.status} isAr={isAr} />
              <button onClick={() => hrStore.removeLeave(l.id)} className="text-destructive p-1.5 hover:bg-destructive/10 rounded"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "إجازة جديدة" : "New leave"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{isAr ? "النوع" : "Type"}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">{isAr ? "سنوية" : "Annual"}</SelectItem>
                  <SelectItem value="sick">{isAr ? "مرضية" : "Sick"}</SelectItem>
                  <SelectItem value="emergency">{isAr ? "اضطرارية" : "Emergency"}</SelectItem>
                  <SelectItem value="unpaid">{isAr ? "بدون راتب" : "Unpaid"}</SelectItem>
                  <SelectItem value="maternity">{isAr ? "أمومة" : "Maternity"}</SelectItem>
                  <SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>{isAr ? "من" : "From"}</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><Label>{isAr ? "إلى" : "To"}</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div><Label>{isAr ? "السبب" : "Reason"}</Label><Textarea rows={2} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            <div><Label>{isAr ? "الحالة" : "Status"}</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{isAr ? "قيد الانتظار" : "Pending"}</SelectItem>
                  <SelectItem value="approved">{isAr ? "معتمدة" : "Approved"}</SelectItem>
                  <SelectItem value="rejected">{isAr ? "مرفوضة" : "Rejected"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function emptyLeave(employeeId: string): Leave {
  const t = new Date().toISOString().slice(0, 10);
  return { id: hrStore.uid(), employeeId, type: "annual", startDate: t, endDate: t, days: 1, status: "pending", createdAt: hrStore.nowIso() };
}
function leaveTypeLabel(t: string, isAr: boolean) {
  const m: Record<string, [string, string]> = { annual: ["سنوية","Annual"], sick: ["مرضية","Sick"], emergency: ["اضطرارية","Emergency"], unpaid: ["بدون راتب","Unpaid"], maternity: ["أمومة","Maternity"], other: ["أخرى","Other"] };
  return isAr ? (m[t]?.[0] || t) : (m[t]?.[1] || t);
}
function LeaveStatusPill({ status, isAr }: { status: string; isAr: boolean }) {
  const m: Record<string, { ar: string; en: string; cls: string }> = {
    pending:  { ar: "قيد الانتظار", en: "Pending",  cls: "bg-warning/15 text-warning" },
    approved: { ar: "معتمدة",       en: "Approved", cls: "bg-success/15 text-success" },
    rejected: { ar: "مرفوضة",       en: "Rejected", cls: "bg-destructive/15 text-destructive" },
  };
  const x = m[status] || m.pending;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${x.cls}`}>{isAr ? x.ar : x.en}</span>;
}

/* ====================== ATTENDANCE ====================== */
function AttendanceTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const records = hrStore.listAttendance(employeeId, month);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Attendance>(() => emptyAttendance(employeeId));
  function save() { hrStore.saveAttendance(form); toast.success(isAr ? "تم" : "Saved"); setOpen(false); }
  const totals = {
    present: records.filter((r) => r.status === "present").length,
    absent: records.filter((r) => r.status === "absent").length,
    late: records.filter((r) => r.status === "late").length,
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        <Button size="sm" onClick={() => { setForm(emptyAttendance(employeeId)); setOpen(true); }} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "تسجيل" : "Add"}</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 text-center"><div className="text-xs text-muted-foreground">{isAr ? "حضور" : "Present"}</div><div className="text-xl font-bold text-success">{totals.present}</div></Card>
        <Card className="p-3 text-center"><div className="text-xs text-muted-foreground">{isAr ? "تأخير" : "Late"}</div><div className="text-xl font-bold text-warning">{totals.late}</div></Card>
        <Card className="p-3 text-center"><div className="text-xs text-muted-foreground">{isAr ? "غياب" : "Absent"}</div><div className="text-xl font-bold text-destructive">{totals.absent}</div></Card>
      </div>
      <Card className="divide-y">
        {records.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد سجلات" : "No records"}</div>}
        {records.map((r) => (
          <div key={r.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{r.date}</div>
              <div className="text-xs text-muted-foreground">{r.checkIn || "—"} → {r.checkOut || "—"} {r.hours ? `(${r.hours}h)` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              <AttStatusPill status={r.status} isAr={isAr} />
              <button onClick={() => hrStore.removeAttendance(r.id)} className="text-destructive p-1.5 hover:bg-destructive/10 rounded"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "تسجيل حضور" : "Add attendance"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>{isAr ? "حضور" : "Check-in"}</Label><Input type="time" value={form.checkIn || ""} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></div>
              <div><Label>{isAr ? "انصراف" : "Check-out"}</Label><Input type="time" value={form.checkOut || ""} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></div>
            </div>
            <div><Label>{isAr ? "ساعات" : "Hours"}</Label><Input type="number" step="0.1" value={form.hours || 0} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} /></div>
            <div><Label>{isAr ? "الحالة" : "Status"}</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">{isAr ? "حضور" : "Present"}</SelectItem>
                  <SelectItem value="late">{isAr ? "تأخير" : "Late"}</SelectItem>
                  <SelectItem value="absent">{isAr ? "غياب" : "Absent"}</SelectItem>
                  <SelectItem value="leave">{isAr ? "إجازة" : "Leave"}</SelectItem>
                  <SelectItem value="holiday">{isAr ? "عطلة" : "Holiday"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function emptyAttendance(employeeId: string): Attendance {
  return { id: hrStore.uid(), employeeId, date: new Date().toISOString().slice(0, 10), status: "present", createdAt: hrStore.nowIso() };
}
function AttStatusPill({ status, isAr }: { status: string; isAr: boolean }) {
  const m: Record<string, { ar: string; en: string; cls: string }> = {
    present: { ar: "حضور", en: "Present", cls: "bg-success/15 text-success" },
    late:    { ar: "تأخير", en: "Late",   cls: "bg-warning/15 text-warning" },
    absent:  { ar: "غياب", en: "Absent",  cls: "bg-destructive/15 text-destructive" },
    leave:   { ar: "إجازة", en: "Leave",  cls: "bg-info/15 text-info" },
    holiday: { ar: "عطلة", en: "Holiday", cls: "bg-muted text-muted-foreground" },
  };
  const x = m[status] || m.present;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${x.cls}`}>{isAr ? x.ar : x.en}</span>;
}

/* ====================== DOCUMENTS ====================== */
function DocumentsTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const docs = hrStore.listDocuments(employeeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState<EmployeeDocument["type"]>("other");
  const [expiry, setExpiry] = useState("");
  function pick() { fileRef.current?.click(); }
  async function up(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error(isAr ? "الحد 10MB" : "Max 10MB"); return; }
    const { convertImageToWebp, fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const optimized = await convertImageToWebp(f);
    const fileUrl = await fileToWebpDataUrl(f);
    hrStore.saveDocument({
      id: hrStore.uid(), employeeId, name: docName || f.name, type: docType,
      fileUrl, fileName: optimized.name, fileSize: optimized.size,
      expiryDate: expiry || undefined, uploadedAt: hrStore.nowIso(),
    });
    toast.success(isAr ? "تم رفع المستند" : "Uploaded");
    setDocName(""); setExpiry("");
    e.target.value = "";
  }
  return (
    <div className="space-y-3">
      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <div className="md:col-span-2"><Label>{isAr ? "اسم المستند" : "Document name"}</Label><Input value={docName} onChange={(e) => setDocName(e.target.value)} /></div>
        <div>
          <Label>{isAr ? "النوع" : "Type"}</Label>
          <Select value={docType} onValueChange={(v) => setDocType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="id">{isAr ? "بطاقة هوية" : "ID"}</SelectItem>
              <SelectItem value="passport">{isAr ? "جواز سفر" : "Passport"}</SelectItem>
              <SelectItem value="contract">{isAr ? "عقد عمل" : "Contract"}</SelectItem>
              <SelectItem value="certificate">{isAr ? "شهادة" : "Certificate"}</SelectItem>
              <SelectItem value="license">{isAr ? "رخصة" : "License"}</SelectItem>
              <SelectItem value="other">{isAr ? "أخرى" : "Other"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={pick} className="gap-2"><Plus className="h-4 w-4" /> {isAr ? "رفع ملف" : "Upload"}</Button>
        <input ref={fileRef} type="file" hidden onChange={up} />
        <div className="md:col-span-4"><Label>{isAr ? "تاريخ انتهاء (اختياري)" : "Expiry (optional)"}</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-44" /></div>
      </Card>
      <Card className="divide-y">
        {docs.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد مستندات" : "No documents"}</div>}
        {docs.map((d) => (
          <div key={d.id} className="p-3 flex items-center justify-between gap-2">
            <a href={d.fileUrl} download={d.fileName} className="flex-1 hover:underline">
              <div className="font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> {d.name}</div>
              <div className="text-xs text-muted-foreground">{d.type} {d.expiryDate && `— ${isAr ? "ينتهي" : "Expires"} ${d.expiryDate}`}</div>
            </a>
            <button onClick={() => hrStore.removeDocument(d.id)} className="text-destructive p-1.5 hover:bg-destructive/10 rounded"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ====================== PERFORMANCE ====================== */
function PerformanceTab({ employeeId, isAr }: { employeeId: string; isAr: boolean }) {
  const reviews = hrStore.listReviews(employeeId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PerformanceReview>(() => emptyReview(employeeId));
  function calcOverall(r: PerformanceReview["ratings"]) {
    return Math.round(((r.quality + r.speed + r.teamwork + r.discipline + r.initiative) / 5) * 10) / 10;
  }
  function save() {
    const overall = calcOverall(form.ratings);
    hrStore.saveReview({ ...form, overall });
    toast.success(isAr ? "تم" : "Saved");
    setOpen(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setForm(emptyReview(employeeId)); setOpen(true); }} className="gap-2"><Plus className="h-3 w-3" /> {isAr ? "تقييم جديد" : "New review"}</Button>
      </div>
      <Card className="divide-y">
        {reviews.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">{isAr ? "لا توجد تقييمات" : "No reviews"}</div>}
        {reviews.map((r) => (
          <div key={r.id} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold">{r.period}</div>
                <div className="text-xs text-muted-foreground">{r.date} {r.reviewer && `— ${r.reviewer}`}</div>
              </div>
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-warning fill-warning" />
                <span className="text-lg font-bold">{r.overall}</span>
                <span className="text-xs text-muted-foreground">/5</span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2 mt-3 text-xs">
              {(["quality","speed","teamwork","discipline","initiative"] as const).map((k) => (
                <div key={k} className="text-center p-2 bg-muted/30 rounded">
                  <div className="text-muted-foreground">{ratingLabel(k, isAr)}</div>
                  <div className="font-bold">{r.ratings[k]}</div>
                </div>
              ))}
            </div>
            {r.strengths && <div className="mt-3 text-xs"><strong>{isAr ? "نقاط القوة:" : "Strengths:"}</strong> {r.strengths}</div>}
            {r.improvements && <div className="text-xs"><strong>{isAr ? "نقاط للتحسين:" : "Improvements:"}</strong> {r.improvements}</div>}
          </div>
        ))}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "تقييم أداء" : "Performance review"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>{isAr ? "الفترة" : "Period"}</Label><Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="Q1 2026" /></div>
              <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(["quality","speed","teamwork","discipline","initiative"] as const).map((k) => (
                <div key={k}>
                  <Label className="text-xs">{ratingLabel(k, isAr)}</Label>
                  <Input type="number" min={1} max={5} step={0.1} value={form.ratings[k]} onChange={(e) => setForm({ ...form, ratings: { ...form.ratings, [k]: Number(e.target.value) } })} />
                </div>
              ))}
            </div>
            <div><Label>{isAr ? "المُقيِّم" : "Reviewer"}</Label><Input value={form.reviewer || ""} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} /></div>
            <div><Label>{isAr ? "نقاط القوة" : "Strengths"}</Label><Textarea rows={2} value={form.strengths || ""} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></div>
            <div><Label>{isAr ? "نقاط للتحسين" : "Improvements"}</Label><Textarea rows={2} value={form.improvements || ""} onChange={(e) => setForm({ ...form, improvements: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button><Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function emptyReview(employeeId: string): PerformanceReview {
  return {
    id: hrStore.uid(), employeeId, date: new Date().toISOString().slice(0, 10), period: "",
    ratings: { quality: 4, speed: 4, teamwork: 4, discipline: 4, initiative: 4 },
    overall: 4, createdAt: hrStore.nowIso(),
  };
}
function ratingLabel(k: string, isAr: boolean) {
  const m: Record<string, [string, string]> = {
    quality: ["الجودة","Quality"], speed: ["السرعة","Speed"], teamwork: ["العمل الجماعي","Teamwork"],
    discipline: ["الانضباط","Discipline"], initiative: ["المبادرة","Initiative"],
  };
  return isAr ? m[k][0] : m[k][1];
}
