import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, History, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/queryKeys";
import {
  COMPLIANCE_KINDS, fetchHrEmployeesForCompliance, getComplianceFileUrl,
  getComplianceRecord, listComplianceAudit, saveComplianceRecord, uploadComplianceFile, validateComplianceFile,
  type ComplianceInput,
} from "@/lib/compliance/complianceService";

const blank: ComplianceInput = {
  kind: "commercial_registration", title: "", reference_number: "", issuing_authority: "",
  employee_id: "", employee_name: "", issued_on: "", expires_on: "", status: "active", notes: "",
};

export default function ComplianceRecordPage() {
  const { recordId } = useParams();
  const editing = !!recordId && recordId !== "new";
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const qc = useQueryClient();
  const [form, setForm] = useState<ComplianceInput>(blank);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.compliance.detail(tenantId, recordId),
    queryFn: () => getComplianceRecord(tenantId, recordId!),
    enabled: editing && !!tenantId,
    retry: false,
  });
  const audit = useQuery({
    queryKey: queryKeys.compliance.audit(tenantId, recordId),
    queryFn: () => listComplianceAudit(tenantId, recordId!),
    enabled: editing && !!tenantId,
  });
  const employees = useQuery({
    queryKey: ["compliance", "employee-picker", tenantId],
    queryFn: () => fetchHrEmployeesForCompliance(tenantId),
    enabled: !!tenantId && form.kind === "employee_permit",
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!detail.data) return;
    const record = detail.data;
    setForm({
      kind: record.kind, title: record.title, reference_number: record.reference_number || "",
      issuing_authority: record.issuing_authority || "", employee_id: record.employee_id || "",
      employee_name: record.employee_name || "", issued_on: record.issued_on || "",
      expires_on: record.expires_on, status: record.status, notes: record.notes || "",
    });
  }, [detail.data]);

  const set = <K extends keyof ComplianceInput>(key: K, value: ComplianceInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!tenantId || saving || (editing && !detail.data)) return;
    try { if (file) validateComplianceFile(file); }
    catch { toast.error(isAr ? "اختر PDF أو صورة صالحة بحجم لا يتجاوز 10 MB." : "Choose a PDF or image of at most 10 MB."); return; }
    setSaving(true);
    try {
      let record = await saveComplianceRecord(
        tenantId, form, detail.data ? { id: detail.data.id, updated_at: detail.data.updated_at } : undefined,
      );
      await qc.invalidateQueries({ queryKey: queryKeys.compliance.all });
      if (file) {
        try {
          record = await uploadComplianceFile(tenantId, record, file);
          await qc.invalidateQueries({ queryKey: queryKeys.compliance.all });
        } catch (uploadError) {
          toast.error(isAr ? "حُفظ السجل، لكن المرفق لم يُربط. افتح السجل وأعد رفع الملف." : "Record saved, but the file was not linked. Open the record and retry the upload.");
          console.error("[compliance] attachment failure", uploadError);
          navigate(`/compliance/${record.id}`, { replace: true });
          return;
        }
      }
      toast.success(isAr ? "تم حفظ السجل في قاعدة البيانات" : "Record saved to the database");
      navigate(`/compliance/${record.id}`, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "COMPLIANCE_CONCURRENT_EDIT") {
        toast.error(isAr ? "عدّل مستخدم آخر السجل. حدّث الصفحة ثم راجع التغييرات قبل الحفظ." : "Another user changed this record. Refresh and review before saving.");
      } else if ((error as { code?: string })?.code === "23505") {
        toast.error(isAr ? "توجد وثيقة سارية بنفس النوع والرقم المرجعي. افتحها وجدّدها بدل إنشاء نسخة مكررة." : "An active document with this type and reference already exists. Open and renew it instead.");
      } else if (message === "COMPLIANCE_REQUIRED_FIELDS" || message === "COMPLIANCE_EMPLOYEE_REQUIRED" || message === "COMPLIANCE_DATE_ORDER") {
        toast.error(isAr ? "راجع العنوان والعامل والتواريخ المطلوبة." : "Check the required title, employee and dates.");
      } else {
        toast.error(isAr ? `تعذر الحفظ: ${message}` : `Save failed: ${message}`);
      }
    } finally { setSaving(false); }
  }

  async function openFile(path: string) {
    try {
      const url = await getComplianceFileUrl(tenantId, path);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <Button variant="ghost" size="sm" asChild><Link to="/compliance"><ArrowLeft className="me-2 h-4 w-4"/>{isAr ? "التراخيص والعقود" : "Licences & Contracts"}</Link></Button>
      <h1 className="mt-2 text-2xl font-bold">{editing ? (isAr ? "تعديل الوثيقة وتجديدها" : "Edit or renew document") : (isAr ? "إضافة وثيقة" : "Add document")}</h1>
    </div></div>
    {editing && detail.isLoading && <p>{isAr ? "جاري تحميل الوثيقة..." : "Loading document..."}</p>}
    {editing && detail.isError && <Card className="border-destructive p-4 text-destructive">{isAr ? "تعذر تحميل السجل. لم تُفتح نسخة قديمة للتعديل." : "Could not load the record. An old copy was not opened for editing."}</Card>}
    {(!editing || !!detail.data) && <Card><CardHeader><CardTitle className="text-base">{isAr ? "بيانات الوثيقة" : "Document details"}</CardTitle></CardHeader><CardContent>
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5"><Label>{isAr ? "النوع" : "Type"} *</Label><Select value={form.kind} onValueChange={(value) => set("kind", value as ComplianceInput["kind"])}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
          {COMPLIANCE_KINDS.map((item) => <SelectItem key={item.value} value={item.value}>{isAr ? item.ar : item.en}</SelectItem>)}
        </SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="compliance-title">{isAr ? "اسم الوثيقة" : "Document title"} *</Label><Input id="compliance-title" required maxLength={200} value={form.title} onChange={(event) => set("title", event.target.value)}/></div>
        {form.kind === "employee_permit" && <div className="space-y-1.5 md:col-span-2"><Label>{isAr ? "العامل المرتبط" : "Linked employee"} *</Label>
          <Select value={form.employee_id || ""} onValueChange={(value) => {
            const employee = employees.data?.find((item) => item.id === value);
            setForm((current) => ({ ...current, employee_id: value, employee_name: employee?.name || current.employee_name }));
          }}><SelectTrigger><SelectValue placeholder={isAr ? "اختر العامل من ملف الموظفين" : "Select from employee profiles"}/></SelectTrigger><SelectContent>
            {(employees.data || []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
          </SelectContent></Select>
          {employees.isError && <p className="text-sm text-destructive">{isAr ? "تعذر جلب الموظفين؛ أعد المحاولة." : "Could not load employees; retry."}</p>}
          {form.employee_id && <Link to={`/staff/${form.employee_id}`} className="text-sm text-primary underline">{isAr ? "فتح ملف العامل" : "Open employee profile"}</Link>}
        </div>}
        <div className="space-y-1.5"><Label htmlFor="compliance-reference">{isAr ? "الرقم المرجعي" : "Reference number"}</Label><Input id="compliance-reference" value={form.reference_number || ""} onChange={(event) => set("reference_number", event.target.value)}/></div>
        <div className="space-y-1.5"><Label htmlFor="compliance-authority">{isAr ? "الجهة المصدرة" : "Issuing authority"}</Label><Input id="compliance-authority" value={form.issuing_authority || ""} onChange={(event) => set("issuing_authority", event.target.value)}/></div>
        <div className="space-y-1.5"><Label htmlFor="compliance-issued">{isAr ? "تاريخ الإصدار" : "Issue date"}</Label><Input id="compliance-issued" type="date" value={form.issued_on || ""} onChange={(event) => set("issued_on", event.target.value)}/></div>
        <div className="space-y-1.5"><Label htmlFor="compliance-expiry">{isAr ? "تاريخ الانتهاء" : "Expiry date"} *</Label><Input id="compliance-expiry" type="date" required value={form.expires_on} onChange={(event) => set("expires_on", event.target.value)}/></div>
        <div className="space-y-1.5"><Label>{isAr ? "الحالة" : "Status"}</Label><Select value={form.status} onValueChange={(value) => set("status", value as ComplianceInput["status"])}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
          <SelectItem value="active">{isAr ? "سارية — تظهر في التنبيهات" : "Active — included in alerts"}</SelectItem><SelectItem value="closed">{isAr ? "مغلقة — لا تظهر في التنبيهات" : "Closed — excluded from alerts"}</SelectItem>
        </SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="compliance-file">{isAr ? "مرفق خاص (PDF أو صورة، حتى 10 MB)" : "Private attachment (PDF or image, up to 10 MB)"}</Label><Input id="compliance-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)}/>
          {editing && detail.data?.file_path && <Button type="button" variant="link" className="px-0" onClick={() => void openFile(detail.data!.file_path!)}><ExternalLink className="me-1 h-4 w-4"/>{isAr ? "عرض المرفق الحالي" : "View current attachment"}</Button>}
        </div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="compliance-notes">{isAr ? "ملاحظات" : "Notes"}</Label><Textarea id="compliance-notes" value={form.notes || ""} onChange={(event) => set("notes", event.target.value)}/></div>
        <p className="text-sm text-muted-foreground md:col-span-2">{isAr ? "عند تجديد الوثيقة، عدّل تاريخ الانتهاء هنا؛ يحتفظ سجل التدقيق بالتاريخ السابق. لا تُحذف الوثيقة أو المرفقات القديمة تلقائيًا." : "To renew, change the expiry date. The audit trail retains the previous date. Old records and attachments are not deleted automatically."}</p>
        <div className="md:col-span-2"><Button type="submit" disabled={saving || !tenantId}><Save className="me-2 h-4 w-4"/>{saving ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ السجل" : "Save record")}</Button></div>
      </form>
    </CardContent></Card>}
    {editing && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4"/>{isAr ? "سجل التعديلات والتجديد" : "Change & renewal history"}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      {audit.isLoading && (isAr ? "جاري التحميل..." : "Loading...")}
      {audit.isError && <p className="text-destructive">{isAr ? "تعذر جلب سجل التعديلات." : "Could not load change history."}</p>}
      {!audit.isLoading && !audit.isError && !audit.data?.length && (isAr ? "لا توجد تعديلات مسجلة." : "No changes recorded.")}
      {audit.data?.map((event) => <div key={event.id} className="rounded-md border p-3">
        <span className="font-medium">{event.action === "created" ? (isAr ? "إنشاء" : "Created") : (isAr ? "تعديل" : "Updated")}</span> · {event.created_at.slice(0, 16).replace("T", " ")}
        {event.old_value?.expires_on !== event.new_value.expires_on && <span className="block text-muted-foreground">{isAr ? "تاريخ الانتهاء" : "Expiry date"}: {String(event.old_value?.expires_on || "—")} → {String(event.new_value.expires_on || "—")}</span>}
        {typeof event.old_value?.file_path === "string" && event.old_value.file_path !== event.new_value.file_path && <Button type="button" variant="link" size="sm" className="px-0" onClick={() => void openFile(String(event.old_value?.file_path))}>{isAr ? "عرض المرفق السابق" : "View previous attachment"}</Button>}
      </div>)}
    </CardContent></Card>}
  </div>;
}
