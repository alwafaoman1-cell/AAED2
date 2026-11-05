import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Download, Eye, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import VehicleTechnicalDeclarationFields from "@/components/vehicle-entry/VehicleTechnicalDeclarationFields";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { queryKeys } from "@/lib/queryKeys";
import { markClean, markDirty } from "@/lib/unsavedWork";
import { getVehicleEntry } from "@/lib/vehicleEntryService";
import {
  emptyVehicleTechnicalDeclaration, getVehicleTechnicalDeclaration, initialTechnicalDeclarationForm,
  saveVehicleTechnicalDeclaration, validateTechnicalDeclarationForm, type VehicleTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";
import {
  assertPrintableTechnicalDeclaration, downloadTechnicalDeclarationPdf, openTechnicalDeclarationPreview, printTechnicalDeclaration,
} from "@/lib/vehicleTechnicalDeclarationPdf";

export default function VehicleTechnicalDeclarationPage({ workspace }: { workspace?: "supervisor" } = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const backPath = workspace === "supervisor" ? `/supervisor/entry/${id}/complete` : `/vehicle-entry/${id}`;
  const qc = useQueryClient();
  const { profile } = useAuth();
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
    setForm(record ? record.form_data : initialTechnicalDeclarationForm(entry, profile?.full_name || ""));
    setEditingRevision(record?.revision ?? null);
    setDirty(false);
    setInitializedFor(id);
  }, [id, initializedFor, entryQuery.isSuccess, documentQuery.isSuccess, entry, record, profile?.full_name]);

  useEffect(() => {
    if (initializedFor !== id || record || dirty || !profile?.full_name) return;
    setForm((current) => current.authorized_person ? current : {
      ...current, authorized_person: profile.full_name, signer_role: "report_author",
    });
  }, [id, initializedFor, record, dirty, profile?.full_name]);

  useEffect(() => {
    if (!id) return;
    const scope = `vehicle-technical-declaration:${id}`;
    if (dirty) markDirty(scope); else markClean(scope);
    return () => markClean(scope);
  }, [id, dirty]);

  const save = useMutation({
    mutationFn: async () => {
      validateTechnicalDeclarationForm(form);
      await assertPrintableTechnicalDeclaration(form);
      return saveVehicleTechnicalDeclaration(id!, form, editingRevision);
    },
    onSuccess: (confirmed) => {
      qc.setQueryData(["vehicle_technical_declaration", id], confirmed);
      // Intake preview/download consume the hydrated canonical row on the entry.
      void qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(id) });
      setForm(confirmed.form_data);
      setEditingRevision(confirmed.revision);
      setDirty(false);
      toast.success(label("حُفظ النموذج الفني في السحابة", "Technical declaration saved to the cloud"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
          onClick={() => dirty ? setLeaveOpen(true) : navigate(backPath)}>
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
      "نموذج إضافي مرتبط بهذا الدخول فقط. حقول الفحص غير محددة افتراضيًا؛ احفظ قبل المعاينة أو الطباعة. لا يُدرج توقيع إلا بعد التقاطه من الموقّع.",
      "An additional form for this entry only. Inspection choices are blank by default; save before preview or printing. A signature appears only after the signer provides it.",
    )}</p>
    <VehicleTechnicalDeclarationFields value={form} disabled={save.isPending}
      reportAuthorName={profile?.full_name || ""}
      technicianName={entry.work_order?.technician_name || entry.converted_work_order?.technician_name || ""}
      onChange={(next) => { setForm(next); setDirty(true); }} />
    <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
      <AlertDialogContent dir={isAr ? "rtl" : "ltr"}><AlertDialogHeader>
        <AlertDialogTitle>{label("تعديلات غير محفوظة", "Unsaved changes")}</AlertDialogTitle>
        <AlertDialogDescription>{label("ستفقد التعديلات غير المحفوظة عند العودة.", "You will lose unsaved edits if you leave.")}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter>
        <AlertDialogCancel>{label("البقاء", "Stay")}</AlertDialogCancel>
        <AlertDialogAction onClick={() => navigate(backPath)}>{label("العودة دون حفظ", "Leave without saving")}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
