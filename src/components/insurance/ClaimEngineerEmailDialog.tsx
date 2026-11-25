import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, Eye, FileText, Image, Loader2, Mail, RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CLAIM_ENGINEER_EMAIL_LIMIT_BYTES, CLAIM_ENGINEER_GENERATED_TOTAL_LIMIT_BYTES, confirmedClaimEngineerEmailSent,
  encodeClaimEngineerGeneratedPdf, prepareClaimEngineerEmail, sendClaimEngineerEmail,
  type ClaimEngineerEmailPacket, type ClaimEngineerEmailVisit, type ClaimEngineerGeneratedPdf,
} from "@/lib/claimEngineerEmail";
import { buildClaimEngineerDocumentPdf, claimEngineerGeneratedDocuments } from "@/lib/claimEngineerEmailDocuments";
import {
  CLAIM_ENGINEER_DOCUMENT_ORDER, CLAIM_ENGINEER_EMAIL_TEMPLATES, CLAIM_ENGINEER_OWNER_TEST_EMAIL,
  claimEngineerDocumentLabel, claimEngineerTemplateLabel, claimEngineerSummarySourceLabel, defaultClaimEngineerDocumentSelection,
  type ClaimEngineerEmailRecipientMode, type ClaimEngineerEmailTemplateId,
} from "@/lib/claimEngineerEmailTemplates";
import { downloadPdfBlob } from "@/lib/pdfFileDownload";

interface Props { open: boolean; onOpenChange: (open: boolean) => void; claimId: string; entryId?: string; allowOwnerTest?: boolean }
interface PreparedPdf { blob: Blob; payload: ClaimEngineerGeneratedPdf }
const bytesLabel = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export default function ClaimEngineerEmailDialog({ open, onOpenChange, claimId, entryId, allowOwnerTest = false }: Props) {
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const text = (ar: string, en: string) => language === "en" ? en : ar;
  const [packet, setPacket] = useState<ClaimEngineerEmailPacket | null>(null);
  const [loadedOptions, setLoadedOptions] = useState("");
  const [entries, setEntries] = useState<ClaimEngineerEmailVisit[]>([]);
  const [chosenEntry, setChosenEntry] = useState(entryId || "");
  const [templateId, setTemplateId] = useState<ClaimEngineerEmailTemplateId>("inspection_status");
  const [recipientMode, setRecipientMode] = useState<ClaimEngineerEmailRecipientMode>("engineer");
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [delivery, setDelivery] = useState<"" | "sent" | "unconfirmed">("");
  const [prepared, setPrepared] = useState<Record<string, PreparedPdf>>({});
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const [previewId, setPreviewId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const generation = useRef(0);
  const pdfCache = useRef(new Map<string, Promise<PreparedPdf>>());
  const renderQueue = useRef<Promise<unknown>>(Promise.resolve());
  const visitScope = useRef({ identity: "", id: entryId });
  const uncertainContexts = useRef(new Set<string>());

  const load = useCallback(async (visitId?: string) => {
    const request = ++generation.current;
    setLoading(true); setError(""); setPacket(null); setPrepared({}); setPdfErrors({}); setSelected([]); setStale(false); setPreviewId(""); setOwnerConfirmed(false); setDelivery("");
    try {
      const result = await prepareClaimEngineerEmail(claimId, visitId, language, { templateId, recipientMode });
      if (request !== generation.current) return;
      if (result.ok === false) {
        setError(result.error);
        if (result.error === "claim_email_visit_required") setEntries(result.entries || []);
        return;
      }
      const next = result.packet;
      setPacket(next); setLoadedOptions(`${claimId}:${language}:${templateId}:${recipientMode}`); setChosenEntry(next.entryId); visitScope.current.id = next.entryId;
      setSelected(defaultClaimEngineerDocumentSelection([...next.attachments, ...claimEngineerGeneratedDocuments(next)]));
      setDelivery(uncertainContexts.current.has(next.contextHash) ? "unconfirmed" : "");
    } catch { if (request === generation.current) setError("claim_email_prepare_failed"); }
    finally { if (request === generation.current) setLoading(false); }
  }, [claimId, language, templateId, recipientMode]);

  useEffect(() => {
    if (!open) { pdfCache.current.clear(); setPreviewId(""); setPrepared({}); return; }
    const identity = `${claimId}:${entryId || ""}`;
    if (visitScope.current.identity !== identity) { visitScope.current = { identity, id: entryId }; setEntries([]); }
    setNote("");
    void load(visitScope.current.id);
    return () => { generation.current += 1; };
  }, [open, claimId, entryId, load]);
  useEffect(() => { if (!allowOwnerTest && recipientMode === "owner_test") setRecipientMode("engineer"); }, [allowOwnerTest, recipientMode]);

  const generated = useMemo(() => packet ? claimEngineerGeneratedDocuments(packet) : [], [packet]);
  // Serialize rendering to bound mobile memory. Re-selection and preview use
  // exactly the same cached Blob that is attached to the email.
  useEffect(() => {
    if (!open || !packet) return;
    let cancelled = false;
    void (async () => {
      for (const document of generated.filter(file => selected.includes(file.id) || previewId === file.id)) {
        if (cancelled) return;
        const key = `${language}:${document.id}:${document.sourceHash}`;
        let task = pdfCache.current.get(key);
        if (!task) {
          task = renderQueue.current.catch(() => undefined).then(async () => {
            const blob = await buildClaimEngineerDocumentPdf(document, language);
            return { blob, payload: await encodeClaimEngineerGeneratedPdf(blob, document) };
          });
          renderQueue.current = task;
          pdfCache.current.set(key, task);
        }
        try { const value = await task; if (!cancelled) setPrepared(values => ({ ...values, [document.id]: value })); }
        catch { if (!cancelled) setPdfErrors(values => ({ ...values, [document.id]: "claim_email_generated_pdf_failed" })); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, packet, generated, selected, previewId, language]);

  const preview = prepared[previewId];
  useEffect(() => {
    if (!preview) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(preview.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const errorText = (code: string) => {
    const messages: Record<string, [string, string]> = {
      claim_email_visit_required: ["اختر زيارة المركبة المقصودة؛ لا تُختار الزيارة الأخيرة تلقائيًا.", "Choose the intended vehicle visit; the latest visit is not selected automatically."],
      claim_email_engineer_required: ["احفظ المهندس المسؤول في المطالبة أولًا.", "Save the assigned engineer on the claim first."],
      claim_email_engineer_email_required: ["لا يوجد بريد صالح للمهندس المحفوظ. حدّث بياناته ثم حدّث الحزمة.", "The saved engineer has no valid email. Update the contact, then refresh the packet."],
      claim_email_gmail_disabled: ["إرسال Gmail معطّل. فعّله من إعدادات التكامل.", "Gmail sending is disabled. Enable it in integration settings."],
      claim_email_gmail_not_configured: ["أكمل ربط Gmail في إعدادات التكامل قبل الإرسال.", "Connect Gmail in integration settings before sending."],
      claim_email_gmail_reconnect_required: ["انتهى اتصال Gmail. أعد ربطه من إعدادات التكامل.", "Gmail needs to be reconnected in integration settings."],
      claim_email_too_large: ["الحزمة أكبر من الحد المسموح. ألغِ تحديد بعض المرفقات.", "The packet exceeds the size limit. Deselect some attachments."],
      claim_email_generated_pdf_failed: ["تعذر تجهيز هذا PDF أو تجاوز حده 3 MB. حدّث الحزمة أو ألغِ تحديده صراحةً؛ لن يُحذف من الإرسال تلقائيًا.", "This PDF could not be prepared or exceeds 3 MB. Refresh the packet or explicitly deselect it; it will not be silently omitted."],
      claim_email_generated_pdf_invalid: ["تعذر التحقق من مستند PDF المحدد؛ حدّث الحزمة.", "The selected PDF could not be verified; refresh the packet."],
      claim_email_technical_pdf_invalid: ["تعذر التحقق من PDF الإقرار الفني؛ حدّث الحزمة.", "The technical declaration PDF could not be verified; refresh the packet."],
      claim_email_attachment_unavailable: ["تعذر الوصول إلى أحد المرفقات المختارة. لم تُرسل الحزمة ناقصة؛ راجع الملف ثم حدّثها.", "A selected attachment is unavailable. The packet was not sent with missing files; check the file and refresh."],
      claim_email_attachment_changed: ["تغير أحد المرفقات المختارة. حدّث الحزمة وراجعها قبل الإرسال.", "A selected attachment changed. Refresh and review the packet before sending."],
      claim_email_attachment_metadata_required: ["بيانات أحد المرفقات المحفوظة غير مكتملة. راجع الملف ثم حدّث الحزمة.", "Saved attachment details are incomplete. Check the file, then refresh the packet."],
      claim_email_attachment_too_large: ["حجم أحد الملفات الأصلية يتجاوز 12 MB. راجع المرفقات المحفوظة.", "An original file exceeds 12 MB. Review the saved attachments."],
      claim_email_subject_details_required: ["أكمل رقم المطالبة ونوع المركبة وطرازها ورقم اللوحة وحروفها في السجل المحفوظ.", "Complete the saved claim number, vehicle make/model, and plate digits/letters."],
      claim_email_visit_mismatch: ["الزيارة المحددة لا تطابق المطالبة. اختر زيارة مرتبطة صحيحة.", "The selected visit does not match the claim. Choose a linked visit."],
      claim_email_frozen_source_unavailable: ["تعذر الوصول إلى النسخة المحفوظة للنموذج. راجع سجل الزيارة قبل الإرسال.", "The saved form version is unavailable. Review the visit record before sending."],
      claim_email_duplicate_blocked: ["توجد محاولة إرسال مسجلة لهذه الحزمة. راجع سجل التواصل قبل إعادة الإرسال.", "A send attempt already exists for this packet. Check communication history before resending."],
      claim_email_context_changed: ["تغيرت البيانات المحفوظة. راجع الحزمة المحدثة ثم أرسلها مجددًا إذا لزم.", "Saved details changed. Review the refreshed packet before sending again."],
      claim_email_owner_test_forbidden: ["الإرسال التجريبي إلى بريد المالك متاح للمدير فقط.", "Only an administrator can send a test to the owner mailbox."],
      claim_email_owner_test_confirmation_required: ["أكّد إرسال رسالة حقيقية إلى بريد المالك الثابت.", "Confirm sending a real message to the fixed owner mailbox."],
      claim_email_owner_test_mailbox_mismatch: ["اختبار المالك متاح فقط عندما يكون مرسل Gmail المرتبط بهذه المنشأة هو alwafa.oman1@gmail.com. راجع إعدادات ربط Gmail.", "Owner testing is available only when this workshop's configured Gmail sender is alwafa.oman1@gmail.com. Check Gmail integration settings."],
    };
    return messages[code] ? text(...messages[code]) : text("تعذر تحضير أو إرسال الحزمة. حدّث البيانات وحاول مجددًا.", "The packet could not be prepared or sent. Refresh the saved details and try again.");
  };

  const selectedFiles = packet?.attachments.filter(file => selected.includes(file.id)) || [];
  const selectedGenerated = generated.filter(file => selected.includes(file.id));
  const generatedBytes = selectedGenerated.reduce((total, file) => total + (prepared[file.id]?.blob.size || 0), 0);
  const totalBytes = selectedFiles.reduce((total, file) => total + file.byteSize, generatedBytes);
  const limitBytes = Math.min(packet?.limitBytes || CLAIM_ENGINEER_EMAIL_LIMIT_BYTES, CLAIM_ENGINEER_EMAIL_LIMIT_BYTES);
  const overLimit = totalBytes > limitBytes || generatedBytes > CLAIM_ENGINEER_GENERATED_TOTAL_LIMIT_BYTES || selectedFiles.some(file => file.byteSize > 12 * 1024 * 1024);
  const gmailReady = packet?.gmail.enabled && packet.gmail.configured;
  const ownerTest = recipientMode === "owner_test";
  const recipientReady = Boolean(packet?.recipient.email?.trim()) && (!ownerTest || (allowOwnerTest && packet?.ownerTestAllowed && packet.recipient.email.toLowerCase() === CLAIM_ENGINEER_OWNER_TEST_EMAIL));
  const generatedReady = selectedGenerated.every(file => prepared[file.id] && !pdfErrors[file.id]);
  const canSend = Boolean(packet && loadedOptions === `${claimId}:${language}:${templateId}:${recipientMode}` && !loading && !sending && !delivery && !error && gmailReady && recipientReady && generatedReady
    && !overLimit && selected.length && (!ownerTest || ownerConfirmed));
  const locked = sending || Boolean(delivery);

  async function send() {
    if (!canSend || !packet) return;
    const request = generation.current;
    setSending(true); setError("");
    try {
      const result = await sendClaimEngineerEmail({ claimId: packet.claimId, entryId: packet.entryId, language, contextHash: packet.contextHash,
        selectedAttachmentIds: selected, note, templateId, recipientMode, generatedPdfs: selectedGenerated.map(file => prepared[file.id].payload),
        ...(ownerTest ? { confirmOwnerTest: ownerConfirmed } : {}) });
      if (request !== generation.current) {
        if (!confirmedClaimEngineerEmailSent(result) && (result.ok === true || result.error === "claim_email_delivery_unconfirmed")) uncertainContexts.current.add(packet.contextHash);
        return;
      }
      if (confirmedClaimEngineerEmailSent(result)) setDelivery("sent");
      else if (result.ok === true || result.error === "claim_email_delivery_unconfirmed") { uncertainContexts.current.add(packet.contextHash); setDelivery("unconfirmed"); }
      else if (result.error === "claim_email_context_changed") { await load(packet.entryId); setStale(true); }
      else setError(result.error);
    } catch {
      uncertainContexts.current.add(packet.contextHash);
      if (request === generation.current) setDelivery("unconfirmed");
    } finally { setSending(false); }
  }
  function toggle(id: string, checked: boolean) {
    setSelected(values => checked ? [...values.filter(value => value !== id), id] : values.filter(value => value !== id));
    if (error === "claim_email_too_large") setError("");
  }

  return <Dialog open={open} onOpenChange={next => { if (!sending) onOpenChange(next); }}>
    <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl" dir={language === "en" ? "ltr" : "rtl"}>
      <DialogHeader className="text-start">
        <DialogTitle className="flex items-center gap-2 pe-7"><Mail size={20} />{text("نماذج إرسال المهندس", "Engineer email templates")}</DialogTitle>
        <DialogDescription>{text("اختر القالب والملفات، وراجع البيانات المحفوظة قبل إرسال رسالة واحدة بمرفقات مستقلة.", "Choose a template and files, then review saved details before sending one email with separate attachments.")}</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="engineer-email-template">{text("قالب الرسالة", "Email template")}</Label>
          <select id="engineer-email-template" className="min-h-11 w-full rounded-md border bg-background p-2" value={templateId} disabled={sending || loading}
            onChange={event => setTemplateId(event.target.value as ClaimEngineerEmailTemplateId)}>
            {CLAIM_ENGINEER_EMAIL_TEMPLATES.map(id => <option key={id} value={id}>{claimEngineerTemplateLabel(id, language)}</option>)}
          </select></div>
        {allowOwnerTest && <div className="space-y-1"><Label htmlFor="engineer-email-mode">{text("وجهة الإرسال", "Send destination")}</Label>
          <select id="engineer-email-mode" className="min-h-11 w-full rounded-md border bg-background p-2" value={recipientMode} disabled={sending || loading}
            onChange={event => setRecipientMode(event.target.value as ClaimEngineerEmailRecipientMode)}>
            <option value="engineer">{text("المهندس المحفوظ", "Saved engineer")}</option><option value="owner_test">{text("اختبار حقيقي إلى بريد المالك — المدير فقط", "Real test to owner mailbox — administrator only")}</option>
          </select></div>}
      </div>
      {entries.length > 0 && <div className="space-y-2"><Label htmlFor="engineer-email-visit">{text("زيارة المركبة", "Vehicle visit")}</Label>
        <select id="engineer-email-visit" className="min-h-11 w-full rounded-md border bg-background p-2" value={chosenEntry} disabled={sending || loading}
          onChange={event => { const visit = event.target.value; setChosenEntry(visit); visitScope.current.id = visit || undefined; if (visit) void load(visit); }}>
          <option value="">{text("اختر الزيارة", "Choose a visit")}</option>
          {entries.map(visit => <option key={visit.id} value={visit.id}>{visit.entryNumber}{visit.arrivalDate ? ` · ${visit.arrivalDate}` : ""}</option>)}
        </select></div>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />{text("جارٍ تحضير الحزمة من البيانات المحفوظة…", "Preparing the packet from saved data…")}</p>}
      {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{errorText(error)}
        {error.includes("engineer") && <a className="ms-2 underline" href={`/insurance/${claimId}`}>{text("فتح المطالبة", "Open claim")}</a>}
      </div>}
      {stale && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{errorText("claim_email_context_changed")}</p>}
      {packet && <div className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1"><Label htmlFor="engineer-email-recipient">{ownerTest ? text("مستلم الاختبار", "Test recipient") : text("المهندس المستلم", "Recipient engineer")}</Label>
            <Input id="engineer-email-recipient" readOnly value={ownerTest ? text("بريد المالك للاختبار", "Owner test mailbox") : packet.recipient.name} />
            <Input aria-label={ownerTest ? text("بريد المالك الثابت", "Fixed owner email") : text("بريد المهندس المحفوظ", "Saved engineer email")} readOnly dir="ltr" value={packet.recipient.email || ""} />
          </div>
          <div className="min-w-0 space-y-1"><Label htmlFor="engineer-email-from">{text("بريد المرسل", "Sender email")}</Label>
            <Input id="engineer-email-from" readOnly dir="ltr" value={packet.gmail.fromEmail || ""} />
            <p className="break-words text-xs text-muted-foreground">{text("رقم الدخول", "Entry number")}: {packet.entryNumber}</p>
          </div>
        </div>
        {(!gmailReady || !recipientReady) && <p role="alert" className="rounded-md border border-amber-300 p-3 text-sm">{!recipientReady
          ? errorText(ownerTest ? "claim_email_owner_test_forbidden" : "claim_email_engineer_email_required") : errorText(packet.gmail.enabled ? "claim_email_gmail_not_configured" : "claim_email_gmail_disabled")}</p>}
        {packet.statusSummary && packet.statusSummary.length > 0 && <section className="rounded-md border bg-muted/20 p-3" aria-label={text("الفحص والحالة المحفوظة", "Saved inspection and status")}>
          <h3 className="mb-2 text-sm font-semibold">{text("الفحص وحالة المركبة — من السجلات المحفوظة", "Vehicle inspection and status — saved records")}</h3>
          <dl className="grid gap-3 sm:grid-cols-2">{packet.statusSummary.map(item => <div key={item.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{item.value ?? text("لم يُسجّل", "Not recorded")}</dd><dd className="break-words text-xs text-muted-foreground">{text("المصدر", "Source")}: {claimEngineerSummarySourceLabel(item.source, language)}</dd></div>)}</dl>
        </section>}
        <div className="space-y-1"><Label htmlFor="engineer-email-subject">{text("عنوان الرسالة", "Email subject")}</Label><Input id="engineer-email-subject" readOnly dir="ltr" value={packet.subject} /></div>
        <div className="rounded-md border bg-muted/20 p-3" aria-label={text("معاينة الرسالة", "Email preview")}><p className="whitespace-pre-wrap break-words text-sm">{packet.body}{note.trim() ? `\n\n${note.trim()}` : ""}</p></div>
        <fieldset className="min-w-0 space-y-3" disabled={locked}><legend className="mb-1 text-sm font-semibold">{text("المرفقات", "Attachments")} · {selected.length}</legend>
          <p className="text-xs text-muted-foreground">{text("كل ملف مرفق مستقل. يمكنك إلغاء تحديد أي ملف؛ النسخ الأصلية والتواقيع تبقى محفوظة.", "Each file is a separate attachment. Any file can be deselected; originals and signatures remain saved.")}</p>
          {CLAIM_ENGINEER_DOCUMENT_ORDER.map(kind => {
            const originals = packet.attachments.filter(file => file.kind === kind);
            const documents = generated.filter(file => file.kind === kind);
            if (!originals.length && !documents.length) return null;
            return <div key={kind} className="space-y-2"><h4 className="text-sm font-medium">{claimEngineerDocumentLabel(kind, language)}</h4>
              {originals.map(file => <label key={file.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border p-3">
                <Checkbox className="mt-1" checked={selected.includes(file.id)} onCheckedChange={checked => toggle(file.id, checked === true)} aria-label={file.fileName} />
                {kind === "vehicle_photo" ? <Image size={17} className="mt-1 shrink-0" /> : <FileText size={17} className="mt-1 shrink-0" />}
                <span className="min-w-0 flex-1"><span className="block break-all text-sm">{file.fileName}</span><span className="text-xs text-muted-foreground">{text("الملف المحفوظ الأصلي", "Original saved file")} · {bytesLabel(file.byteSize)}</span></span>
              </label>)}
              {documents.map(file => <div key={file.id} className="rounded-md border p-3"><div className="flex items-start gap-3">
                <Checkbox id={`engineer-pdf-${file.id}`} className="mt-1" checked={selected.includes(file.id)} onCheckedChange={checked => toggle(file.id, checked === true)} aria-label={file.fileName} />
                <label htmlFor={`engineer-pdf-${file.id}`} className="min-h-10 min-w-0 flex-1 cursor-pointer"><span className="block break-all text-sm">{file.fileName}</span><span className="block text-xs text-muted-foreground">{text("PDF من النسخة المحفوظة", "PDF from saved version")}{prepared[file.id] ? ` · ${bytesLabel(prepared[file.id].blob.size)}` : ""}</span></label>
                <Button type="button" variant="ghost" size="sm" className="min-h-10 shrink-0 gap-1" aria-label={`${text("معاينة", "Preview")} ${file.fileName}`} onClick={() => setPreviewId(file.id)}><Eye size={16} /><span className="hidden sm:inline">{text("معاينة", "Preview")}</span></Button>
              </div>
                {selected.includes(file.id) && !prepared[file.id] && !pdfErrors[file.id] && <p role="status" className="mt-2 flex items-center gap-2 text-xs"><Loader2 size={14} className="animate-spin" />{text("جارٍ تجهيز PDF…", "Preparing PDF…")}</p>}
                {pdfErrors[file.id] && <p role="alert" className="mt-2 text-xs text-destructive">{errorText(pdfErrors[file.id])}</p>}
              </div>)}
            </div>;
          })}
        </fieldset>
        {previewId && <section className="space-y-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-all text-sm font-medium">{generated.find(file => file.id === previewId)?.fileName}</h3><Button variant="ghost" size="sm" onClick={() => setPreviewId("")} className="gap-1"><X size={15} />{text("إغلاق المعاينة", "Close preview")}</Button></div>
          {previewUrl ? <><iframe src={previewUrl} title={text("معاينة PDF المرفق", "Attachment PDF preview")} className="h-[55dvh] w-full rounded border" /><Button variant="outline" className="min-h-11 gap-2" onClick={() => downloadPdfBlob(preview.blob, generated.find(file => file.id === previewId)!.fileName)}><Download size={15} />{text("تنزيل نسخة المعاينة", "Download preview copy")}</Button><p className="text-xs text-muted-foreground">{text("هذه نفس نسخة PDF التي سترفق بالرسالة. إذا لم يعرض الهاتف المعاينة، نزّلها للاطلاع.", "This exact PDF will be attached. If your phone cannot display the preview, download it to review.")}</p></> : <p role="status">{pdfErrors[previewId] ? errorText(pdfErrors[previewId]) : text("جارٍ تجهيز المعاينة…", "Preparing preview…")}</p>}
        </section>}
        {(!packet.attachments.some(file => file.kind === "source_document") || !packet.attachments.some(file => file.kind === "vehicle_photo") || !packet.technicalDeclaration || packet.warnings.length > 0) &&
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} />{text("راجع اكتمال الحزمة", "Review packet completeness")}</p>
            {!packet.attachments.some(file => file.kind === "source_document") && <p>{text("لا توجد مستندات أصلية محفوظة لهذه الزيارة.", "No original documents are saved for this visit.")}</p>}
            {!packet.attachments.some(file => file.kind === "vehicle_photo") && <p>{text("لا توجد صور مركبة محفوظة لهذه الزيارة.", "No vehicle photos are saved for this visit.")}</p>}
            {!packet.technicalDeclaration && <p>{text("لا يوجد إقرار فني محفوظ لهذه الزيارة.", "No technical declaration is saved for this visit.")}</p>}
            {packet.warnings.includes("claim_email_technical_declaration_unsigned") && <p>{text("الإقرار الفني المحفوظ غير موقّع. راجعه قبل الإرسال.", "The saved technical declaration is unsigned. Review it before sending.")}</p>}
            {!packet.attachments.some(file => file.kind === "signed_intake") && !generated.some(file => file.kind === "signed_intake") && <p>{text("لا توجد نسخة دخول موقّعة متاحة لهذه الزيارة.", "No signed intake version is available for this visit.")}</p>}
          </div>}
        <p className={overLimit ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"} role={overLimit ? "alert" : undefined}>{text("حجم المرفقات المحددة", "Selected attachment size")}: {bytesLabel(totalBytes)} / {bytesLabel(limitBytes)}{overLimit && ` — ${text("ألغِ تحديد بعض الملفات؛ الحد للأصل 12 MB ولملفات PDF الجديدة مجتمعةً 8 MB.", "Deselect some files; each original is limited to 12 MB and generated PDFs together to 8 MB.")}`}</p>
        <div className="space-y-1"><Label htmlFor="engineer-email-note">{text("ملاحظة إضافية للمهندس", "Additional note to the engineer")}</Label><Textarea id="engineer-email-note" maxLength={2000} value={note} disabled={locked} onChange={event => setNote(event.target.value)} /></div>
        {ownerTest && <label className="flex min-h-12 items-start gap-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"><Checkbox checked={ownerConfirmed} disabled={locked} onCheckedChange={checked => setOwnerConfirmed(checked === true)} aria-label={text("تأكيد إرسال اختبار حقيقي", "Confirm real test email")} /><span>{text("أؤكد إرسال رسالة حقيقية إلى بريد المالك الثابت فقط:", "I confirm sending a real message only to the fixed owner mailbox:")} <bdi>{CLAIM_ENGINEER_OWNER_TEST_EMAIL}</bdi></span></label>}
      </div>}
      {delivery === "sent" && <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{text("تم تأكيد إرسال الرسالة وتسجيلها في سجل التواصل.", "Sending was confirmed and recorded in communication history.")}</p>}
      {delivery === "unconfirmed" && <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">{text("تعذر تأكيد تسليم الرسالة. قد يكون Gmail قبلها؛ راجع سجل التواصل قبل إرسال رسالة جديدة. لن تُعاد المحاولة تلقائيًا.", "Delivery could not be confirmed. Gmail may have accepted the message; check communication history before sending a new one. No automatic retry will occur.")}</p>}
      <a href="/settings/integrations" className="text-sm underline">{text("إعدادات ربط Gmail", "Gmail integration settings")}</a>
      <DialogFooter className="gap-2 border-t pt-3">
        <Button variant="outline" className="min-h-11 gap-2" disabled={loading || sending} onClick={() => { pdfCache.current.clear(); void load(chosenEntry || entryId); }}><RefreshCw size={16} />{text("تحديث الحزمة", "Refresh packet")}</Button>
        <Button className="min-h-11 gap-2" disabled={!canSend} onClick={() => void send()}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}{ownerTest ? text("إرسال اختبار حقيقي للمالك", "Send real owner test") : text("إرسال إلى المهندس", "Send to engineer")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
