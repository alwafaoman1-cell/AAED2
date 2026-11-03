import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Download, Eye, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { queryKeys } from "@/lib/queryKeys";
import { markClean, markDirty } from "@/lib/unsavedWork";
import { getVehicleEntry } from "@/lib/vehicleEntryService";
import {
  emptyVehicleTechnicalDeclaration, getVehicleTechnicalDeclaration, initialTechnicalDeclarationForm,
  saveVehicleTechnicalDeclaration, technicalFieldMaxLength, type VehicleTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";
import {
  assertPrintableTechnicalDeclaration, downloadTechnicalDeclarationPdf, openTechnicalDeclarationPreview, printTechnicalDeclaration,
} from "@/lib/vehicleTechnicalDeclarationPdf";

type FieldKey = keyof VehicleTechnicalDeclarationForm;
type FieldKind = "text" | "date" | "choice" | "oil" | "chassis" | "checkbox" | "textarea";
interface Field { key: FieldKey; ar: string; en: string; kind: FieldKind; }

const identityFields: Field[] = [
  { key: "claim_number", ar: "رقم المطالبة", en: "Claim Number", kind: "text" },
  { key: "registration_number", ar: "رقم التسجيل / اللوحة", en: "Registration Number", kind: "text" },
  { key: "make_model", ar: "الماركة والموديل", en: "Make & Model", kind: "text" },
  { key: "non_gcc_vehicle", ar: "المركبة من خارج دول الخليج", en: "Non GCC Vehicle", kind: "choice" },
  { key: "towing", ar: "أُحضرت برافعة", en: "Towing", kind: "choice" },
];

const sections: Array<{ number: number; ar: string; en: string; fields: Field[] }> = [
  { number: 1, ar: "حالة المحرك", en: "Engine Status", fields: [
    { key: "cranking", ar: "يدور المحرك", en: "Cranking", kind: "choice" },
    { key: "engine_oil_level", ar: "مستوى زيت المحرك", en: "Engine Oil Level", kind: "oil" },
    { key: "radiator_coolant", ar: "سائل تبريد الرادياتير", en: "Radiator Coolant", kind: "choice" },
    { key: "engine_other_remarks", ar: "ملاحظات أخرى", en: "Other Remarks", kind: "text" },
  ] },
  { number: 2, ar: "حالة صندوق التروس", en: "Gear Box Status", fields: [
    { key: "gear_body_crack", ar: "شقوق ظاهرة في الهيكل", en: "Any Body crack Observed", kind: "choice" },
    { key: "gear_oil_leak", ar: "تسرب زيت ظاهر", en: "Any oil leak observed", kind: "choice" },
    { key: "gear_other_remarks", ar: "ملاحظات أخرى", en: "Other Remarks", kind: "text" },
  ] },
  { number: 3, ar: "إصلاحات سابقة غير سليمة", en: "Previous Improper Repairs Observed", fields: [
    { key: "previous_improper_repairs", ar: "هل وُجدت إصلاحات سابقة غير سليمة؟", en: "Previous Improper Repairs Observed", kind: "choice" },
    { key: "previous_improper_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "textarea" },
  ] },
  { number: 4, ar: "لمبات التحذير في لوحة العدادات", en: "Dash board warning lamp", fields: [
    { key: "airbag_warning", ar: "تحذير الوسائد الهوائية", en: "Air bag warning", kind: "choice" },
    { key: "engine_warning", ar: "تحذير المحرك", en: "Engine warning", kind: "choice" },
    { key: "atm_warning", ar: "تحذير ATM", en: "ATM warning", kind: "choice" },
    { key: "warning_other", ar: "أخرى", en: "Other", kind: "text" },
  ] },
  { number: 5, ar: "ملاحظة حالة الشاصي", en: "Chassis Status Observation", fields: [
    { key: "chassis_status", ar: "حالة الشاصي", en: "Chassis Status", kind: "chassis" },
    { key: "chassis_damage_lh", ar: "ضرر شاصي يسار LH", en: "Chassis damage LH", kind: "checkbox" },
    { key: "chassis_damage_rh", ar: "ضرر شاصي يمين RH", en: "Chassis damage RH", kind: "checkbox" },
    { key: "chassis_replace_lh", ar: "يوصى باستبدال يسار LH", en: "Recommend replace LH", kind: "checkbox" },
    { key: "chassis_replace_rh", ar: "يوصى باستبدال يمين RH", en: "Recommend replace RH", kind: "checkbox" },
    { key: "chassis_notes", ar: "تفاصيل إضافية", en: "Additional details", kind: "text" },
  ] },
  { number: 6, ar: "تشوهات الهيكل والأرضية", en: "Body & Floor Deformation Observed", fields: [
    { key: "floor_deformation", ar: "تشوه الأرضية", en: "Floor deformation", kind: "choice" },
    { key: "body_deformation", ar: "تشوه الهيكل", en: "Body Deformation", kind: "choice" },
    { key: "body_floor_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "text" },
  ] },
  { number: 7, ar: "الإضافات والتعديلات", en: "Any extra accessories/Modification", fields: [
    { key: "accessories_modification", ar: "إكسسوارات أو تعديلات إضافية", en: "Extra accessories/Modification", kind: "choice" },
    { key: "ppe", ar: "PPE", en: "PPE", kind: "choice" },
    { key: "accessories_details", ar: "التفاصيل إن وُجدت", en: "If Yes, Details", kind: "text" },
  ] },
  { number: 8, ar: "ملاحظات أخرى", en: "Other Observations and Remarks", fields: [
    { key: "other_observations", ar: "الملاحظات", en: "Other Observations and Remarks", kind: "textarea" },
  ] },
];

const footerFields: Field[] = [
  { key: "garage_name", ar: "اسم الورشة", en: "Garage Name", kind: "text" },
  { key: "authorized_person", ar: "الشخص المخول", en: "Authorized Person", kind: "text" },
  { key: "date", ar: "تاريخ التوقيع", en: "Date", kind: "date" },
];

export default function VehicleTechnicalDeclarationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const label = (ar: string, en: string) => isAr ? ar : en;
  const [form, setForm] = useState<VehicleTechnicalDeclarationForm>(emptyVehicleTechnicalDeclaration);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const entryQuery = useQuery({
    queryKey: queryKeys.vehicleEntries.detail(id), queryFn: () => getVehicleEntry(id!),
    enabled: !!id, staleTime: 30_000,
  });
  const documentQuery = useQuery({
    queryKey: ["vehicle_technical_declaration", id], queryFn: () => getVehicleTechnicalDeclaration(id!),
    enabled: !!id, staleTime: 10_000,
  });
  const entry = entryQuery.data;
  const record = documentQuery.data;

  useEffect(() => {
    if (!id || initializedFor === id || !entryQuery.isSuccess || !documentQuery.isSuccess || !entry) return;
    setForm(record ? record.form_data : initialTechnicalDeclarationForm(entry));
    setEditingRevision(record?.revision ?? null);
    setDirty(false);
    setInitializedFor(id);
  }, [id, initializedFor, entryQuery.isSuccess, documentQuery.isSuccess, entry, record]);

  useEffect(() => {
    if (!id) return;
    const scope = `vehicle-technical-declaration:${id}`;
    if (dirty) markDirty(scope); else markClean(scope);
    return () => markClean(scope);
  }, [id, dirty]);

  const save = useMutation({
    mutationFn: async () => {
      await assertPrintableTechnicalDeclaration(form);
      return saveVehicleTechnicalDeclaration(id!, form, editingRevision);
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(["vehicle_technical_declaration", id], confirmed);
      setForm(confirmed.form_data);
      setEditingRevision(confirmed.revision);
      setDirty(false);
      toast.success(label("حُفظ النموذج الفني في السحابة", "Technical declaration saved to the cloud"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function setField(key: FieldKey, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function renderField(field: Field) {
    const title = label(field.ar, field.en);
    const fieldId = `technical-${field.key}`;
    const raw = form[field.key];
    if (field.kind === "checkbox") {
      return <label key={field.key} htmlFor={fieldId} className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
        <input id={fieldId} type="checkbox" checked={raw === true} disabled={save.isPending}
          onChange={(event) => setField(field.key, event.target.checked)} className="h-4 w-4" />{title}
      </label>;
    }
    let options: Array<{ value: string; text: string }> = [];
    if (field.kind === "choice") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "yes", text: label("نعم", "Yes") }, { value: "no", text: label("لا", "No") },
    ];
    if (field.kind === "oil") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "ok", text: "OK" }, { value: "no", text: label("غير سليم", "No") },
    ];
    if (field.kind === "chassis") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "ok", text: "OK" }, { value: "deformed", text: label("متشوه", "Deformed") },
    ];
    return <div key={field.key} className="space-y-1.5 min-w-0">
      <label htmlFor={fieldId} className="text-sm font-medium">{title}</label>
      {options.length > 0 ? <select id={fieldId} value={String(raw)} disabled={save.isPending}
        onChange={(event) => setField(field.key, event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        {options.map((option) => <option key={option.value} value={option.value}>{option.text}</option>)}
      </select> : field.kind === "textarea" ?
        <Textarea id={fieldId} value={String(raw)} maxLength={technicalFieldMaxLength(field.key)} rows={3} disabled={save.isPending}
          onChange={(event) => setField(field.key, event.target.value)} /> :
        <Input id={fieldId} type={field.kind === "date" ? "date" : "text"} dir={field.kind === "date" ? "ltr" : undefined}
          value={String(raw)} maxLength={technicalFieldMaxLength(field.key)} disabled={save.isPending}
          onChange={(event) => setField(field.key, event.target.value)} />}
    </div>;
  }

  async function freshSavedForm(): Promise<VehicleTechnicalDeclarationForm | null> {
    if (!record || dirty || save.isPending) return null;
    const refreshed = await documentQuery.refetch();
    if (refreshed.error || !refreshed.data) throw refreshed.error || new Error(label("لم يُعثر على النموذج المحفوظ", "Saved declaration not found"));
    if (refreshed.data.revision !== editingRevision) {
      setForm(refreshed.data.form_data);
      setEditingRevision(refreshed.data.revision);
      setDirty(false);
      throw new Error(label("تغيّر النموذج في جلسة أخرى؛ راجع النسخة الجديدة قبل الطباعة", "Declaration changed in another session; review before printing"));
    }
    return refreshed.data.form_data;
  }

  async function handleOutput(action: "preview" | "print" | "download") {
    // Reserve the tab during the user gesture; the cloud read-back may be slow.
    const target = action === "download" ? null : window.open("", "_blank");
    if (action !== "download" && !target) {
      toast.error(label("اسمح بالنوافذ المنبثقة للمعاينة والطباعة", "Allow pop-ups for preview and printing"));
      return;
    }
    setPdfBusy(true);
    try {
      const savedForm = await freshSavedForm();
      if (!savedForm) { target?.close(); return; }
      if (action === "download") await downloadTechnicalDeclarationPdf(savedForm, entry.entry_number);
      else if (action === "print") {
        if (!await printTechnicalDeclaration(savedForm, target)) throw new Error(label("اسمح بالنوافذ المنبثقة للطباعة", "Allow pop-ups to print"));
      } else if (!openTechnicalDeclarationPreview(savedForm, target)) {
        throw new Error(label("اسمح بالنوافذ المنبثقة للمعاينة", "Allow pop-ups to preview"));
      }
    } catch (error) {
      target?.close();
      toast.error((error as Error).message);
    } finally { setPdfBusy(false); }
  }

  if (entryQuery.isPending || documentQuery.isPending || (entry && initializedFor !== id)) {
    return <div className="flex items-center justify-center gap-2 p-8"><Loader2 className="h-5 w-5 animate-spin" />{label("تحميل النموذج الفني...", "Loading technical declaration...")}</div>;
  }
  if (entryQuery.isError || documentQuery.isError || !entry) {
    return <div className="p-8 text-destructive">{(entryQuery.error as Error)?.message || (documentQuery.error as Error)?.message || label("سجل دخول المركبة غير موجود", "Vehicle entry not found")}</div>;
  }

  return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label={label("العودة إلى دخول المركبة", "Back to vehicle entry")}
          onClick={() => dirty ? setLeaveOpen(true) : navigate(`/vehicle-entry/${id}`)}>
          <ArrowRight className={isAr ? "" : "rotate-180"} size={18} />
        </Button>
        <div><h1 className="text-2xl font-bold">{label("الإقرار الفني للمركبة", "Vehicle Technical Declaration")}</h1>
          <p className="text-sm text-muted-foreground" dir="ltr">{entry.entry_number} · A4 portrait</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!record || dirty || pdfBusy} onClick={() => void handleOutput("preview")}><Eye size={16} className="me-2" />{label("معاينة", "Preview")}</Button>
        <Button variant="outline" disabled={!record || dirty || pdfBusy} onClick={() => void handleOutput("print")}><Printer size={16} className="me-2" />{label("طباعة", "Print")}</Button>
        <Button variant="outline" disabled={!record || dirty || pdfBusy} onClick={() => void handleOutput("download")}><Download size={16} className="me-2" />{label("تنزيل PDF", "Download PDF")}</Button>
        <Button disabled={!dirty || save.isPending || pdfBusy} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 size={16} className="me-2 animate-spin" /> : <Save size={16} className="me-2" />}
          {label("حفظ النموذج", "Save declaration")}
        </Button>
      </div>
    </header>
    <p className="text-sm text-muted-foreground">{label(
      "نموذج إضافي مرتبط بهذا الدخول فقط. حقول الفحص غير محددة افتراضيًا؛ احفظ قبل المعاينة أو الطباعة. التوقيع والختم متروكان للورقة المطبوعة.",
      "An additional form for this entry only. Inspection choices are blank by default; save before preview or printing. Signature and stamp remain on paper.",
    )}</p>
    <Card className="p-4 md:p-5 space-y-4">
      <h2 className="font-semibold">{label("بيانات المركبة والمطالبة", "Vehicle & Claim Details")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{identityFields.map(renderField)}</div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((section) => <Card key={section.number} className="p-4 md:p-5 space-y-4">
        <h2 className="font-semibold">{section.number}. {label(section.ar, section.en)}</h2>
        <div className="grid gap-3 sm:grid-cols-2">{section.fields.map(renderField)}</div>
      </Card>)}
    </div>
    <Card className="p-4 md:p-5 space-y-4">
      <h2 className="font-semibold">{label("بيانات الاعتماد والطباعة", "Workshop & Print Details")}</h2>
      <div className="grid gap-4 sm:grid-cols-3">{footerFields.map(renderField)}</div>
      <p className="text-sm text-muted-foreground">{label("التوقيع والختم لا يُفترضان إلكترونيًا؛ تظهر لهما مساحة فارغة في الورقة.", "Signature and stamp are not assumed electronic; the sheet leaves blank space for both.")}</p>
    </Card>
    <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
      <AlertDialogContent dir={isAr ? "rtl" : "ltr"}><AlertDialogHeader>
        <AlertDialogTitle>{label("تعديلات غير محفوظة", "Unsaved changes")}</AlertDialogTitle>
        <AlertDialogDescription>{label("ستفقد التعديلات غير المحفوظة عند العودة.", "You will lose unsaved edits if you leave.")}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter>
        <AlertDialogCancel>{label("البقاء", "Stay")}</AlertDialogCancel>
        <AlertDialogAction onClick={() => navigate(`/vehicle-entry/${id}`)}>{label("العودة دون حفظ", "Leave without saving")}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
