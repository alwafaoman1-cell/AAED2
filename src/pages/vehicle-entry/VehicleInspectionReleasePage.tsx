import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Copy, Download, FileSignature, Link2, Loader2, MessageCircle, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/queryKeys";
import { markClean, markDirty } from "@/lib/unsavedWork";
import { getVehicleEntry } from "@/lib/vehicleEntryService";
import { getTemplateSettingsAsync } from "@/lib/pdfGenerator";
import { normalizePhone } from "@/lib/phoneUtils";
import { openAndPrintWindow, openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import {
  buildInspectionReleaseHtml,
  createInspectionReleaseLink,
  downloadInspectionReleasePdf,
  emptyInspectionReleaseForm,
  getInspectionRelease,
  inspectionReleaseInitialForm,
  inspectionReleaseMissingFields,
  listInspectionReleases,
  markInspectionVehicleReturned,
  reopenInspectionRelease,
  saveInspectionRelease,
  type InspectionReleaseForm,
} from "@/lib/vehicleInspectionRelease";

const fields: Array<{ key: keyof InspectionReleaseForm; ar: string; en: string; long?: boolean; required?: boolean }> = [
  { key: "inspection_summary", ar: "ملخص المعاينة والفحص", en: "Inspection summary", long: true, required: true },
  { key: "inspected_items", ar: "ما تم فحصه", en: "Items inspected", long: true },
  { key: "uninspected_items", ar: "ما لم يُفحص أو يتعذر فحصه", en: "Not inspected", long: true },
  { key: "visible_damage", ar: "الأضرار الظاهرة", en: "Visible damage", long: true },
  { key: "pending_action", ar: "الإجراء المنتظر قبل الإصلاح", en: "Pending decision/action", long: true, required: true },
  { key: "exit_condition", ar: "حالة المركبة عند الخروج المؤقت", en: "Condition at temporary release", long: true, required: true },
  { key: "contents_handed_over", ar: "المحتويات المسلّمة", en: "Contents handed over", long: true },
  { key: "keys_handed_over", ar: "عدد المفاتيح المسلّمة", en: "Keys handed over" },
  { key: "recipient_name", ar: "اسم مستلم المركبة", en: "Recipient name", required: true },
  { key: "recipient_id_number", ar: "رقم هوية المستلم", en: "Recipient ID number", required: true },
  { key: "recipient_phone", ar: "هاتف المستلم", en: "Recipient phone", required: true },
  { key: "recipient_relation", ar: "صفة المستلم", en: "Recipient relationship" },
  { key: "staff_name", ar: "اسم موظف الورشة", en: "Workshop representative" },
  { key: "notes", ar: "ملاحظات إضافية", en: "Additional notes", long: true },
];

export default function VehicleInspectionReleasePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [form, setForm] = useState<InspectionReleaseForm>(emptyInspectionReleaseForm);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState(false);
  const [newDraftMode, setNewDraftMode] = useState(false);
  const t = (ar: string, en: string) => isAr ? ar : en;

  useEffect(() => {
    if (!id) return;
    const scope = `vehicle-inspection-release:${id}`;
    if (dirty) markDirty(scope); else markClean(scope);
    return () => markClean(scope);
  }, [dirty, id]);

  const entryQuery = useQuery({
    queryKey: queryKeys.vehicleEntries.detail(id),
    queryFn: () => getVehicleEntry(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
  const releaseQuery = useQuery({
    queryKey: ["vehicle_inspection_releases", id],
    queryFn: () => getInspectionRelease(id!),
    enabled: !!id,
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data?.status === "awaiting_signature" ? 20_000 : false,
  });
  const entry = entryQuery.data;
  const release = releaseQuery.data;
  const displayRelease = newDraftMode ? null : release;
  const historyQuery = useQuery({
    queryKey: ["vehicle_inspection_release_history", id],
    queryFn: () => listInspectionReleases(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!id || initializedFor === id || !entryQuery.isSuccess || !releaseQuery.isSuccess || !entry) return;
    setForm(release?.form_data ? { ...emptyInspectionReleaseForm, ...release.form_data } : inspectionReleaseInitialForm(entry));
    setInitializedFor(id);
  }, [id, initializedFor, entryQuery.isSuccess, releaseQuery.isSuccess, entry, release]);

  const save = useMutation({
    mutationFn: () => saveInspectionRelease(id!, form),
    onSuccess: (saved) => {
      qc.setQueryData(["vehicle_inspection_releases", id], saved);
      void qc.invalidateQueries({ queryKey: ["vehicle_inspection_release_history", id] });
      setNewDraftMode(false);
      setDirty(false);
      toast.success(isAr ? "حُفظ المحضر في السحابة" : "Report saved to the cloud");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const createLink = useMutation({
    mutationFn: () => createInspectionReleaseLink(release!.id),
    onSuccess: (result) => {
      setLink(result.url);
      void releaseQuery.refetch();
      toast.success(isAr ? "أُنشئ رابط توقيع صالح لمدة 7 أيام" : "Seven-day signature link created");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const reopen = useMutation({
    mutationFn: () => reopenInspectionRelease(release!.id),
    onSuccess: (record) => {
      qc.setQueryData(["vehicle_inspection_releases", id], record);
      setLink(null);
      toast.success(isAr ? "أُلغي الرابط القديم وأُعيد المحضر للتعديل" : "Old link revoked; report reopened for editing");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const returned = useMutation({
    mutationFn: () => markInspectionVehicleReturned(release!.id),
    onSuccess: (record) => {
      qc.setQueryData(["vehicle_inspection_releases", id], record);
      void qc.invalidateQueries({ queryKey: ["vehicle_inspection_release_history", id] });
      void qc.invalidateQueries({ queryKey: queryKeys.insuranceClaims.all });
      void qc.invalidateQueries({ queryKey: queryKeys.jobOrders.all });
      toast.success(t("سُجلت عودة المركبة إلى الورشة", "Vehicle return recorded"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateField(key: keyof InspectionReleaseForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function backToEntry() {
    if (dirty && !window.confirm(t("لديك تعديلات غير محفوظة. هل تريد مغادرة الصفحة؟", "You have unsaved changes. Leave this page?"))) return;
    navigate(`/vehicle-entry/${id}`);
  }

  function html(media?: any[]) {
    if (!displayRelease || !entry) throw new Error(isAr ? "احفظ المحضر أولًا" : "Save the report first");
    return buildInspectionReleaseHtml(displayRelease, media || entry.vehicle_media || [], isAr ? "ar" : "en");
  }

  async function pdfAction(action: "preview" | "print" | "download") {
    // Open the preview within the click gesture. Cloud settings and media URL
    // refresh may otherwise take long enough for the browser to block it.
    const previewWindow = action === "preview" ? window.open("", "_blank") : null;
    if (action === "preview" && !previewWindow) {
      toast.error(t("اسمح بالنوافذ المنبثقة لمعاينة المستند", "Allow pop-ups to preview the document"));
      return;
    }
    setBusyPdf(true);
    try {
      await getTemplateSettingsAsync();
      // Refresh the signed media URLs before creating the document.
      const refreshed = await entryQuery.refetch();
      if (!refreshed.data) throw new Error(t("تعذر تحديث صور المركبة", "Could not refresh vehicle photos"));
      const content = html(refreshed.data.vehicle_media || []);
      if (action === "preview") openSanitizedPdfWindow(content, previewWindow);
      else if (action === "print") await openAndPrintWindow(content);
      else await downloadInspectionReleasePdf(content, displayRelease!.release_number);
    } catch (error: any) {
      previewWindow?.close();
      toast.error(error?.message || (isAr ? "تعذر إنشاء المستند" : "Could not prepare the document"));
    } finally {
      setBusyPdf(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast.success(isAr ? "تم نسخ الرابط" : "Link copied"); }
    catch { toast.error(isAr ? "تعذر نسخ الرابط" : "Could not copy link"); }
  }

  function whatsappLink() {
    if (!link) return;
    const message = isAr
      ? `يرجى مراجعة محضر معاينة وخروج المركبة المؤقت رقم ${release?.release_number} وتوقيعه إلكترونيًا:\n${link}`
      : `Please review and sign vehicle inspection and temporary release ${release?.release_number}:\n${link}`;
    const recipient = normalizePhone(release?.form_data?.recipient_phone);
    window.open(`https://wa.me/${recipient}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  if (entryQuery.isError || releaseQuery.isError || !entry) {
    if (entryQuery.isLoading || releaseQuery.isLoading) return <div className="p-8 flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />{isAr ? "جاري تحميل المحضر..." : "Loading report..."}</div>;
    const message = (entryQuery.error as Error)?.message || (releaseQuery.error as Error)?.message;
    return <div className="p-8 text-destructive">{message || (isAr ? "تعذر فتح سجل الدخول" : "Entry unavailable")}</div>;
  }
  if (!initializedFor) return <div className="p-8 flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />{isAr ? "جاري تحميل المحضر..." : "Loading report..."}</div>;

  const locked = displayRelease?.status !== "draft" && !!displayRelease;
  const missing = inspectionReleaseMissingFields(form);
  const entryCanRelease = ["Received", "Issued", "Converted to Claim", "Converted to Work Order"].includes(entry.status);
  const customer = displayRelease?.entry_snapshot?.customer || entry.customer || entry.customer_snapshot || {};
  const vehicle = displayRelease?.entry_snapshot?.vehicle || entry.vehicle || entry.vehicle_snapshot || {};
  const marks = displayRelease?.entry_snapshot?.damage_marks || entry.damage_marks || [];
  const photos = (entry.vehicle_media || []).filter((photo: any) => photo.media_type === "image" && (!displayRelease || displayRelease.photo_media_ids?.includes(photo.id)));
  const canCreate = entryCanRelease && !!displayRelease && !dirty && missing.length === 0 && displayRelease.status !== "signed";
  const releaseStatusLabel = displayRelease?.status === "signed"
    ? t("موقّع", "Signed")
    : displayRelease?.status === "awaiting_signature"
      ? t("بانتظار توقيع المستلم", "Awaiting recipient signature")
      : t("مسودة", "Draft");

  return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6" dir={isAr ? "rtl" : "ltr"}>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={backToEntry}><ArrowRight className={isAr ? "" : "rotate-180"} size={18} /></Button>
        <div><h1 className="text-2xl font-bold">{t("معاينة وفحص وتسليم مؤقت", "Inspection & Temporary Release")}</h1>
          <p className="text-sm text-muted-foreground" dir="ltr">{displayRelease?.release_number || entry.entry_number}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!displayRelease || busyPdf} onClick={() => void pdfAction("preview")}>{t("معاينة PDF", "Preview PDF")}</Button>
        <Button variant="outline" disabled={!displayRelease || busyPdf} onClick={() => void pdfAction("print")}><Printer size={15} className="me-1" />{t("طباعة", "Print")}</Button>
        <Button variant="outline" disabled={!displayRelease || busyPdf} onClick={() => void pdfAction("download")}><Download size={15} className="me-1" />{t("تنزيل PDF", "Download PDF")}</Button>
      </div>
    </header>

    <Card className="p-4 text-sm leading-7">
      <div className="font-bold">{t("سجل الدخول الأصلي", "Original vehicle entry")}: {entry.entry_number}</div>
      <div>{t("العميل", "Customer")}: {customer.name || "—"} · {t("المركبة", "Vehicle")}: {[vehicle.make || vehicle.brand, vehicle.model, vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ")}</div>
      <div className="text-muted-foreground">{t("هذا المحضر ليس تسليمًا نهائيًا ولا يُنشئ فاتورة أو مطالبة أو أمر عمل جديدًا.", "This is not final delivery and does not create an invoice, claim, or new work order.")}</div>
      {!entryCanRelease && <div className="text-destructive">{entry.status === "Draft"
        ? t("يجب حفظ استلام المركبة قبل محضر الخروج المؤقت.", "Save the vehicle reception before creating a temporary release.")
        : t("لا يمكن إصدار خروج مؤقت لسجل دخول ملغى.", "A cancelled vehicle entry cannot be temporarily released.")}</div>}
    </Card>

    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-bold">{t("بيانات المعاينة والخروج", "Inspection and release details")}</h2>
        <span className="text-xs rounded bg-muted px-2 py-1">{releaseStatusLabel}</span></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((field) => <label key={field.key} className="block space-y-1 text-sm">
          <span className="font-semibold">{t(field.ar, field.en)} {field.required && <span className="text-destructive">*</span>}</span>
          {field.long
            ? <Textarea value={form[field.key]} disabled={locked || save.isPending} maxLength={field.key === "notes" ? 1500 : 2000} onChange={(event) => updateField(field.key, event.target.value)} rows={3} />
            : <Input value={form[field.key]} disabled={locked || save.isPending} maxLength={160} onChange={(event) => updateField(field.key, event.target.value)} />}
        </label>)}
      </div>
      {missing.length > 0 && <p className="text-xs text-amber-700">{t("الحقول المطلوبة قبل إرسال الرابط", "Required before sharing a link")}: {missing.map((key) => fields.find((field) => field.key === key)?.[isAr ? "ar" : "en"]).join("، ")}</p>}
      {!locked && <Button disabled={save.isPending || !entryCanRelease} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("حفظ المحضر في السحابة", "Save report to cloud")}
      </Button>}
      {dirty && <p className="text-xs text-amber-700">{t("تعديلات غير محفوظة؛ احفظها قبل إرسال الرابط.", "Unsaved changes; save before sharing the link.")}</p>}
    </Card>

    <Card className="p-4 space-y-3">
      <h2 className="font-bold">{t("توثيق الدخول المرتبط", "Linked entry evidence")}</h2>
      <p className="text-xs text-muted-foreground">{t("الصور من السجل الأصلي نفسه ولا تُرفع أو تُخزن مرتين.", "Photos come from the original entry and are not stored twice.")}</p>
      {Array.isArray(marks) && marks.length > 0 && <div className="text-sm">{marks.map((mark: any) => <p key={mark.mark_number}>#{mark.mark_number} · {mark.vehicle_part || "—"} · {mark.description || mark.notes || "—"}</p>)}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{photos.map((photo: any) => <div key={photo.id} className="rounded border p-2 text-xs">
        {(photo.url || photo.public_url) ? <img src={photo.url || photo.public_url} alt="" className="aspect-[4/3] w-full object-contain" /> : <div className="aspect-[4/3] grid place-items-center bg-muted">{t("الصورة غير متاحة", "Photo unavailable")}</div>}
        <div className="mt-1 truncate">{photo.category || photo.file_name}</div>
      </div>)}</div>
    </Card>

    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 font-bold"><FileSignature size={18} />{t("إقرار المستلم والتوقيع الإلكتروني", "Recipient acknowledgement & electronic signature")}</div>
      <p className="text-sm leading-7 whitespace-pre-wrap">{(isAr ? displayRelease?.declaration_ar : displayRelease?.declaration_en) || t("احفظ المحضر لعرض الإقرار الرسمي.", "Save the report to display the acknowledgement.")}</p>
      {displayRelease?.status === "signed" ? <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
        {t("تم توقيع المحضر واعتماد الخروج المؤقت", "Signed; temporary release confirmed")} · {displayRelease.signer_name} · {displayRelease.signed_at}
        {displayRelease.signature_data_url && <img src={displayRelease.signature_data_url} alt="" className="mt-2 h-16 object-contain" />}
        {displayRelease.returned_at ? <p className="mt-2">{t("عادت المركبة إلى الورشة", "Vehicle returned to workshop")} · {displayRelease.returned_at}</p>
          : <Button className="mt-3" variant="outline" disabled={returned.isPending} onClick={() => {
            if (window.confirm(t("تأكيد عودة المركبة فعليًا إلى الورشة؟", "Confirm the vehicle has actually returned to the workshop?"))) returned.mutate();
          }}>{t("تسجيل عودة المركبة", "Record vehicle return")}</Button>}
        {displayRelease.returned_at && <Button className="mt-3 ms-2" variant="outline" onClick={() => {
          setForm(inspectionReleaseInitialForm(entry));
          setNewDraftMode(true);
          setDirty(true);
        }}>{t("بدء محضر خروج جديد", "Start another release report")}</Button>}
      </div> : <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canCreate || createLink.isPending} onClick={() => createLink.mutate()}><Link2 size={15} className="me-1" />{t("إنشاء رابط توقيع العميل", "Create customer signature link")}</Button>
          {displayRelease?.status === "awaiting_signature" && <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate()}>{t("إلغاء الرابط وتعديل المحضر", "Revoke link and edit")}</Button>}
          <Button variant="outline" onClick={() => { void releaseQuery.refetch(); void entryQuery.refetch(); }}><RefreshCw size={15} className="me-1" />{t("تحديث حالة التوقيع", "Refresh signature status")}</Button>
        </div>
        {displayRelease?.status === "awaiting_signature" && <p className="text-xs text-muted-foreground">{t("إذا فُقد الرابط، أنشئ رابطًا جديدًا؛ يُلغى السابق تلقائيًا.", "If the link is lost, generate a new one; the previous link is revoked.")}</p>}
        {link && <div className="space-y-2"><div className="rounded border bg-muted p-2 text-xs break-all" dir="ltr">{link}</div>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void copyLink()}><Copy size={14} className="me-1" />{t("نسخ", "Copy")}</Button>
            <Button variant="outline" size="sm" onClick={whatsappLink}><MessageCircle size={14} className="me-1" />{t("إرسال واتساب", "Share via WhatsApp")}</Button></div></div>}
      </div>}
    </Card>
    {(historyQuery.data?.length || 0) > 0 && <Card className="p-4 space-y-2">
      <h2 className="font-bold">{t("سجل محاضر المعاينة السابقة", "Inspection release history")}</h2>
      {historyQuery.data?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
        <span>{item.release_number} · {item.status === "signed" ? t("موقّع", "Signed") : item.status === "awaiting_signature" ? t("بانتظار التوقيع", "Awaiting signature") : t("مسودة", "Draft")} · {item.signed_at || "—"}</span>
        <Button size="sm" variant="outline" disabled={busyPdf} onClick={async () => {
          const previewWindow = window.open("", "_blank");
          if (!previewWindow) {
            toast.error(t("اسمح بالنوافذ المنبثقة لمعاينة المستند", "Allow pop-ups to preview the document"));
            return;
          }
          try {
            await getTemplateSettingsAsync();
            const freshEntry = await entryQuery.refetch();
            if (!freshEntry.data) throw new Error(t("تعذر تحديث صور المركبة", "Could not refresh vehicle photos"));
            openSanitizedPdfWindow(buildInspectionReleaseHtml(item, freshEntry.data.vehicle_media || [], isAr ? "ar" : "en"), previewWindow);
          } catch (error: any) { previewWindow.close(); toast.error(error?.message || t("تعذر فتح المستند", "Could not open document")); }
        }}>{t("عرض المستند", "View document")}</Button>
      </div>)}
    </Card>}
  </div>;
}
