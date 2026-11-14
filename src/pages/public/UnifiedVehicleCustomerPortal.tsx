import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CarFront, CheckCircle2, CircleHelp, ClipboardCheck, FileText, Images, KeyRound, Loader2, LockKeyhole, LogOut, Power, PowerOff, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import ElectronicSignaturePad from "@/components/ElectronicSignaturePad";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import VehiclePortalOrderTracking from "@/components/vehicle-entry/VehiclePortalOrderTracking";
import { buildIntakeReceiptHtml } from "@/lib/vehicleIntakeReceipt";
import { extractPlateDigits, extractPlateLetters, formatPlate } from "@/lib/plateUtils";
import { inspectionReleaseDisplayValue } from "@/lib/inspectionReleaseOptions";
import { readVehiclePortal, readVehiclePortalDocument, readVehiclePortalMedia, signVehiclePortalEntry, signVehiclePortalOrder, signVehiclePortalRelease, submitVehiclePortalFeedback, submitVehiclePortalNote, unlockVehiclePortal, VehiclePortalError, type VehiclePortalData, type VehiclePortalEntry, type VehiclePortalMedia, type VehiclePortalRelease } from "@/lib/unifiedVehiclePortal";

type Translate = (ar: string, en: string) => string;
type Access = { session: string; expiresAt: string | null; data: VehiclePortalData };

function safeSignature(source?: string) {
  // Only stored signature pixels are accepted here; no external tracking URLs or SVG.
  return source && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(source) ? source : undefined;
}

function SignatureRecord({ name, at, signature, text, en }: { name?: string; at?: string; signature?: string; text: Translate; en: boolean }) {
  const image = safeSignature(signature);
  return <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
    <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{text("موقّع ومحفوظ", "Signed and saved")}</p>
    {name && <p>{text("اسم الموقّع", "Signer")}: {name}</p>}
    {at && <p className="text-sm text-muted-foreground">{new Date(at).toLocaleString(en ? "en-GB" : "ar-OM")}</p>}
    {image && <img src={image} alt={text("التوقيع المحفوظ", "Saved signature")} className="h-24 max-w-full rounded bg-white object-contain" />}
  </div>;
}

function LegacyIntakeSignatureRecord({ entry, text, en }: { entry: VehiclePortalEntry; text: Translate; en: boolean }) {
  const image = safeSignature(entry.signature_data_url);
  const knownTime = !!entry.signed_at && Number.isFinite(Date.parse(entry.signed_at));
  const title = text("التوقيع السابق المحفوظ", "Retained previous signature");
  return <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:bg-amber-950/20">
    <h4 className="font-semibold">{title}</h4>
    {entry.signer_name && <p>{text("اسم الموقّع", "Signer")}: {entry.signer_name}</p>}
    <p className="text-sm text-muted-foreground">{knownTime ? new Date(entry.signed_at!).toLocaleString(en ? "en-GB" : "ar-OM") : text("وقت التوقيع السابق غير موثّق.", "The previous signature time was not recorded.")}</p>
    {image && <img src={image} alt={title} className="h-24 max-w-full rounded bg-white object-contain" />}
    <p className="text-sm">{text("هذا توقيع تاريخي محفوظ دون نسخة أصلية مجمّدة. لا يُصدر هذا العرض وصلًا جديدًا منه ولا ينقله إلى إصدار جديد. أي تعديل أساسي يتطلب توقيعًا جديدًا.", "This is a retained historical signature without a frozen original document. Showing it does not create a new receipt or transfer it to a new revision. Material changes require a new signature.")}</p>
  </div>;
}

function ReleaseReport({ release, text, en }: { release: VehiclePortalRelease; text: Translate; en: boolean }) {
  const fields = [
    ["inspection_summary", text("ملخص الفحص", "Inspection summary")],
    ["inspected_items", text("ما تم فحصه", "Items inspected")],
    ["uninspected_items", text("ما لم يتم فحصه", "Items not inspected")],
    ["visible_damage", text("الأضرار الظاهرة", "Visible damage")],
    ["pending_action", text("الإجراء المنتظر", "Pending action")],
    ["exit_condition", text("حالة المركبة عند الخروج", "Condition at release")],
    ["contents_handed_over", text("المقتنيات المسلّمة", "Contents handed over")],
    ["keys_handed_over", text("المفاتيح المسلّمة", "Keys handed over")],
    ["recipient_name", text("المستلم المحدد", "Expected recipient")],
    ["recipient_id_number", text("هوية المستلم", "Recipient identity number")],
    ["recipient_phone", text("هاتف المستلم", "Recipient phone")],
    ["recipient_relation", text("صفة المستلم", "Recipient relationship")],
    ["staff_name", text("الموظف المسلّم", "Releasing employee")],
    ["notes", text("ملاحظات إذن الخروج", "Release notes")],
  ] as const;
  return <dl className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap pt-1">{inspectionReleaseDisplayValue(key, release.form_data?.[key] || (key === "recipient_name" ? release.recipient_name || "" : ""), en ? "en" : "ar") || "—"}</dd></div>)}</dl>;
}

function SignatureForm({ text, name: initialName, disabled, consentLabel, onSubmit }: { text: Translate; name?: string; disabled: boolean; consentLabel: string; onSubmit: (name: string, signature: string, consent: boolean) => Promise<boolean> }) {
  const [name, setName] = useState(initialName || "");
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const submitLabel = text("إرسال التوقيع وحفظه", "Submit and save signature");
  return <form className="space-y-3 border-t pt-4" onSubmit={async (event) => {
    event.preventDefault();
    if (disabled || !name.trim() || !signature || !consent) return;
    if (await onSubmit(name, signature, consent)) { setSignature(""); setConsent(false); }
  }}>
    <label className="block space-y-1"><span>{text("اسم الموقّع الكامل", "Signer's full name")}</span><Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required disabled={disabled} /></label>
    <ElectronicSignaturePad value={signature} onChange={setSignature} disabled={disabled} compactOutput={false} title={text("التوقيع الإلكتروني", "Electronic signature")} description={text("وقّع داخل المربع باستخدام الإصبع أو الفأرة.", "Sign inside the box with your finger or mouse.")} clearLabel={text("مسح التوقيع", "Clear signature")} savedLabel={text("التوقيع جاهز للإرسال. لم يُحفظ بعد.", "Your signature is ready to submit. It has not been saved yet.")} emptyLabel={text("التوقيع مطلوب.", "A signature is required.")} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={disabled} required className="mt-1 h-4 w-4" /><span>{consentLabel}</span></label>
    <Button type="submit" disabled={disabled || !name.trim() || !signature || !consent} className="gap-2">{disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{submitLabel}</Button>
  </form>;
}

export default function UnifiedVehicleCustomerPortal() {
  const { token = "" } = useParams<{ token: string }>();
  // A changed URL remounts all in-memory access, forms, signatures and document previews.
  return <VehiclePortalSession key={token} token={token} />;
}

function VehiclePortalSession({ token }: { token: string }) {
  const { i18n } = useTranslation();
  const en = !!i18n.language?.startsWith("en");
  const text: Translate = (ar, english) => en ? english : ar;
  const labels = { open: text("فتح البوابة", "Open portal"), lock: text("قفل البوابة", "Lock portal"), unavailable: text("لم يُفعّل بعد", "Not enabled yet"), document: text("الوصل مع نموذج الدخول — معاينة وتنزيل", "Receipt with intake form — view and download"), photos: text("عرض صور حالة المركبة", "View vehicle condition photos") };
  const [access, setAccess] = useState<Access | null>(null);
  const [digits, setDigits] = useState("");
  const [letters, setLetters] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<VehiclePortalError["code"] | null>(null);
  const [tab, setTab] = useState<"intake" | "order" | "delivery">("intake");
  const [document, setDocument] = useState<{ html: string; number: string } | null>(null);
  const [photos, setPhotos] = useState<Record<string, VehiclePortalMedia[]>>({});
  const session = access?.session;
  const expiresAt = access?.expiresAt;
  const generation = useRef(0);
  const current = useRef(access);
  const working = useRef(false);
  const mounted = useRef(true);
  const lock = useCallback(() => {
    generation.current += 1;
    current.current = null;
    working.current = false;
    setAccess(null); setDocument(null); setPhotos({}); setDigits(""); setLetters(""); setTab("intake"); setBusy(false);
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);

  const fail = useCallback((cause: unknown) => {
    const code = cause instanceof VehiclePortalError ? cause.code : "failed";
    if (code !== "failed" && code !== "changed") lock();
    setError(code);
  }, [lock]);

  // Revalidate server access after manager pause, final delivery or returning to the page.
  useEffect(() => {
    if (!session) return;
    let active = true;
    const revalidate = async () => {
      if (working.current || window.document.visibilityState === "hidden") return;
      const requestGeneration = generation.current;
      try {
        const data = await readVehiclePortal(token, session);
        if (active && mounted.current && generation.current === requestGeneration) {
          const latest = current.current;
          if (latest?.session === session) { const next = { ...latest, data }; current.current = next; setAccess(next); }
        }
      } catch (cause) { if (active && mounted.current && generation.current === requestGeneration) fail(cause); }
    };
    const interval = window.setInterval(revalidate, 30_000);
    window.addEventListener("focus", revalidate);
    window.document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pagehide", lock);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", revalidate); window.document.removeEventListener("visibilitychange", revalidate); window.removeEventListener("pagehide", lock); };
  }, [session, token, fail, lock]);

  useEffect(() => {
    if (!expiresAt) return;
    const check = () => { if (!(Date.parse(expiresAt) > Date.now())) { lock(); setError("expired"); } };
    check();
    const timer = window.setInterval(check, 10_000);
    return () => window.clearInterval(timer);
  }, [expiresAt, lock]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (working.current || !token || !extractPlateDigits(digits) || !extractPlateLetters(letters)) return;
    working.current = true; setBusy(true); setError(null);
    const requestGeneration = generation.current;
    try {
      const unlocked = await unlockVehiclePortal(token, digits, letters);
      if (!mounted.current || generation.current !== requestGeneration) return;
      if (unlocked.expires_at && !(Date.parse(unlocked.expires_at) > Date.now())) throw new VehiclePortalError("expired");
      const data = await readVehiclePortal(token, unlocked.session);
      if (!mounted.current || generation.current !== requestGeneration) return;
      const next = { session: unlocked.session, expiresAt: unlocked.expires_at, data };
      current.current = next; setAccess(next); setDigits(""); setLetters("");
    } catch (cause) { if (mounted.current && generation.current === requestGeneration) fail(cause); }
    finally { if (mounted.current && generation.current === requestGeneration) { working.current = false; setBusy(false); } }
  }

  async function authenticated(action: (session: string) => Promise<void>, confirm?: (data: VehiclePortalData) => boolean) {
    const active = current.current;
    if (!active || working.current) return false;
    working.current = true; setBusy(true); setError(null);
    const requestGeneration = ++generation.current;
    try {
      await action(active.session);
      if (!mounted.current || generation.current !== requestGeneration) return false;
      const data = await readVehiclePortal(token, active.session);
      if (!mounted.current || generation.current !== requestGeneration) return false;
      if (confirm && !confirm(data)) throw new VehiclePortalError("failed");
      const next = { ...active, data }; current.current = next; setAccess(next);
      return true;
    } catch (cause) {
      if (mounted.current && generation.current === requestGeneration) {
        if (cause instanceof VehiclePortalError && cause.code === "changed") {
          try {
            const data = await readVehiclePortal(token, active.session);
            if (!mounted.current || generation.current !== requestGeneration) return false;
            const next = { ...active, data }; current.current = next; setAccess(next);
          } catch (refreshError) { if (mounted.current && generation.current === requestGeneration) fail(refreshError); return false; }
        }
        fail(cause);
      }
      return false;
    }
    finally { if (mounted.current && generation.current === requestGeneration) { working.current = false; setBusy(false); } }
  }

  async function showPhotos(entry: VehiclePortalEntry) {
    let media: VehiclePortalMedia[] = [];
    const operation = authenticated(async (activeSession) => { media = await readVehiclePortalMedia(token, activeSession, entry.id, entry.revision); });
    const requestGeneration = generation.current;
    const ok = await operation;
    if (ok && mounted.current && generation.current === requestGeneration) setPhotos((previous) => ({ ...previous, [`${entry.id}:${entry.revision}`]: media }));
  }

  async function preview(entry: VehiclePortalEntry) {
    if (entry.legacy_signature || entry.has_frozen_document === false) return;
    let html = "";
    const operation = authenticated(async (session) => {
      const source = await readVehiclePortalDocument(token, session, entry.id);
      html = await buildIntakeReceiptHtml(source, en ? "en" : "ar", true);
    });
    const requestGeneration = generation.current;
    const ok = await operation;
    if (ok && mounted.current && generation.current === requestGeneration) setDocument({ html, number: entry.receipt_number || entry.entry_number });
  }

  function sendFeedback(orderId: string, rating: number, comment: string) {
    return authenticated((activeSession) => submitVehiclePortalFeedback(token, activeSession, orderId, rating, comment), (saved) => saved.order?.id === orderId && saved.order.tracking?.feedback?.rating === rating && (saved.order.tracking.feedback.comment || "").trim() === comment.trim());
  }
  function sendNote(orderId: string, note: string) {
    return authenticated((activeSession) => submitVehiclePortalNote(token, activeSession, orderId, note), (saved) => saved.order?.id === orderId && saved.order.tracking?.messages?.[0]?.message.trim() === note.trim());
  }

  const errors: Record<VehiclePortalError["code"], string> = {
    unavailable: text("الرابط غير متاح. يرجى التواصل مع الورشة.", "This link is unavailable. Please contact the workshop."),
    expired: text("انتهت صلاحية الرابط. يمكن للمدير إعادة تفعيله.", "This link has expired. A manager can reactivate it."),
    disabled: text("أوقف المدير هذا الرابط مؤقتًا. يرجى التواصل مع الورشة.", "A manager has paused this link. Please contact the workshop."),
    credentials: text("تعذّر التحقق من اللوحة. تأكد من الأرقام والحروف وحاول لاحقًا.", "The plate could not be verified. Check the digits and letters and try again later."),
    session: text("انتهت جلسة الدخول. أدخل رقم اللوحة وحروفها مجددًا.", "Your access session ended. Enter the plate digits and letters again."),
    changed: text("تغيّر المستند قبل الحفظ. راجع أحدث البيانات ووقّع الإصدار الجديد مجددًا.", "The document changed before saving. Review the latest details and sign the new revision again."),
    failed: text("تعذّر إكمال العملية. تحقق من الاتصال وأعد المحاولة.", "The operation could not be completed. Check your connection and try again."),
  };
  const data = access?.data;
  const orderAvailable = !!data?.order?.enabled;
  const deliveryAvailable = !!data?.delivery?.enabled;
  const selectedTab = tab === "order" && !orderAvailable || tab === "delivery" && !deliveryAvailable ? "intake" : tab;

  return <main dir={en ? "ltr" : "rtl"} className="min-h-screen bg-muted/30 px-4 py-6 sm:py-10">
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-xl font-bold"><CarFront className="h-6 w-6" />{text("بوابة المركبة", "Vehicle portal")}</h1><p className="mt-1 text-sm text-muted-foreground">{text("الدخول وأمر العمل والتسليم في رابط واحد", "Intake, work order and delivery in one link")}</p></div>
        <Button variant="outline" size="sm" onClick={() => { setDocument(null); void i18n.changeLanguage(en ? "ar" : "en"); }}>{en ? "العربية" : "English"}</Button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errors[error]}</p>}
      {!data ? <Card className="mx-auto max-w-md space-y-5 p-5 sm:p-7">
        <div className="space-y-2"><LockKeyhole className="h-10 w-10 text-primary" /><h2 className="text-lg font-semibold">{text("تحقق من ملكية المركبة", "Verify your vehicle")}</h2><p className="text-sm text-muted-foreground">{text("أدخل رقم اللوحة وحروفها لفتح مستندات المركبة. تقبل الحروف العربية أو الإنجليزية.", "Enter your plate digits and letters to open the vehicle documents. Arabic and English letters are accepted.")}</p></div>
        <form onSubmit={unlock} className="space-y-4" autoComplete="off">
          <label className="block space-y-1"><span>{text("رقم اللوحة", "Plate digits")}</span><Input value={digits} onChange={(event) => setDigits(event.target.value)} inputMode="numeric" maxLength={12} autoComplete="off" dir="ltr" required disabled={busy} /></label>
          <label className="block space-y-1"><span>{text("حروف اللوحة", "Plate letters")}</span><Input value={letters} onChange={(event) => setLetters(event.target.value)} maxLength={12} autoComplete="off" autoCapitalize="characters" required disabled={busy} /></label>
          <Button type="submit" className="w-full gap-2" disabled={busy || !token || !extractPlateDigits(digits) || !extractPlateLetters(letters)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{labels.open}</Button>
        </form>
      </Card> : <>
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-semibold">{[data.vehicle.make, data.vehicle.model, data.vehicle.year].filter(Boolean).join(" ")}</h2><p>{data.customer.name}</p><p className="font-mono" dir="ltr">{formatPlate(data.vehicle)}</p></div><Button variant="outline" size="sm" className="gap-2" onClick={() => { lock(); setError(null); }}><LogOut className="h-4 w-4" />{labels.lock}</Button></Card>
        <nav aria-label={text("مستندات المركبة", "Vehicle documents")} className="grid grid-cols-3 gap-2">
          {([{ id: "intake" as const, icon: ClipboardCheck, enabled: true, label: text("الدخول والمراجعات", "Intake and reviews") }, { id: "order" as const, icon: Wrench, enabled: orderAvailable, label: text("أمر العمل", "Work order") }, { id: "delivery" as const, icon: CheckCircle2, enabled: deliveryAvailable, label: text("الاستلام والخروج النهائي", "Final delivery") }]).map(({ id, icon: Icon, enabled, label }) => <button key={id} type="button" disabled={!enabled || busy} aria-pressed={selectedTab === id} onClick={() => { setTab(id); setError(null); }} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center text-sm font-medium disabled:opacity-50 ${selectedTab === id ? "border-primary bg-primary/10 text-primary" : "bg-card"}`}><Icon className="h-7 w-7" /><span>{label}</span>{!enabled && <LockKeyhole aria-label={labels.unavailable} className="h-3 w-3" />}</button>)}
        </nav>
        <p className="text-sm text-muted-foreground">{text("يتفعّل أمر العمل بعد اعتماد المطالبة، والتسليم النهائي بعد اعتماد المدير. يبقى الرابط متاحًا خلال العمل ولمدة 10 أيام بعد التسليم النهائي.", "The work order opens after claim approval and final delivery opens after manager approval. This link stays available during workshop work and for 10 days after final delivery.")}</p>
        {selectedTab === "intake" && <section aria-label={text("نماذج الدخول والمراجعات", "Intake and review forms")} className="space-y-4">
          {data.entries.length === 0 && <Card className="p-4">{text("لا توجد نماذج دخول متاحة حاليًا.", "No intake forms are currently available.")}</Card>}
          {data.entries.map((entry) => {
            const running = entry.running_status === "running";
            const stopped = entry.running_status === "not_running";
            const StatusIcon = running ? Power : stopped ? PowerOff : CircleHelp;
            return <Card key={`${entry.id}:${entry.revision}`} className="space-y-4 p-4 sm:p-5">
              <header className="space-y-1"><p className="text-xs font-medium text-primary">{entry.review_source_entry_id ? text("زيارة مراجعة مرتبطة بالدخول السابق", "Review visit linked to the previous intake") : text("دخول واستلام المركبة", "Vehicle intake")}</p><h3 className="font-semibold">{entry.entry_number} · {text("الإصدار", "Revision")} {entry.revision}</h3><p className="text-sm text-muted-foreground">{entry.arrival_date} {entry.arrival_time}</p></header>
              <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{text("حالة المركبة", "Vehicle running status")}</p><p className="mt-1 flex items-center gap-2 font-medium"><StatusIcon className={`h-5 w-5 ${running ? "text-emerald-600" : stopped ? "text-red-600" : "text-muted-foreground"}`} />{running ? text("تعمل", "Running") : stopped ? text("لا تعمل", "Not running") : text("غير موثّقة في النموذج السابق", "Not recorded in this previous form")}</p></div><div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{text("قراءة العداد", "Odometer")}</p><p className="mt-1 font-medium">{entry.mileage == null ? "—" : `${entry.mileage.toLocaleString(en ? "en-GB" : "ar-OM")} ${text("كم", "km")}`}</p></div></div>
              {entry.condition && <div><h4 className="text-sm font-semibold">{text("وصف حالة المركبة", "Vehicle condition")}</h4><p className="whitespace-pre-wrap text-sm">{entry.condition}</p></div>}
              {entry.review_reason && <div><h4 className="text-sm font-semibold">{text("سبب الرجوع للمراجعة", "Reason for review")}</h4><p className="whitespace-pre-wrap text-sm">{entry.review_reason}</p></div>}
              <div><h4 className="text-sm font-semibold">{text("الملاحظات", "Notes")}</h4><p className="whitespace-pre-wrap text-sm">{entry.notes || "—"}</p></div>
              <div className={`rounded-lg border p-3 ${entry.new_damage === true ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20" : ""}`}><h4 className="font-semibold">{text("هل توجد أضرار جديدة؟", "Any new damage?")}</h4><p>{entry.new_damage === true ? text("نعم، توجد أضرار جديدة", "Yes, new damage is recorded") : entry.new_damage === false ? text("لا توجد أضرار جديدة", "No new damage") : text("لم يُسجّل في النموذج السابق", "Not recorded in this previous form")}</p>{entry.new_damage_notes && <p className="mt-2 whitespace-pre-wrap text-sm">{entry.new_damage_notes}</p>}</div>
              <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => void showPhotos(entry)}><Images className="h-4 w-4" />{labels.photos}</Button>
              {photos[entry.id + ":" + entry.revision] && <div className="grid grid-cols-2 gap-2">
                {photos[entry.id + ":" + entry.revision].length === 0 && <p className="col-span-2 text-sm text-muted-foreground">{text("لا توجد صور محفوظة لهذا النموذج.", "No photos are saved for this form.")}</p>}
                {photos[entry.id + ":" + entry.revision].map((photo) => <figure key={photo.id} className="space-y-1"><img src={photo.url} alt={photo.caption || text("صورة حالة المركبة", "Vehicle condition photo")} className="aspect-video w-full rounded-lg border object-contain" referrerPolicy="no-referrer" />{photo.caption && <figcaption className="text-xs">{photo.caption}</figcaption>}</figure>)}
              </div>}
              {(en ? entry.declaration_en : entry.declaration_ar) && <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{en ? entry.declaration_en : entry.declaration_ar}</p>}
              {entry.legacy_signature ? <LegacyIntakeSignatureRecord entry={entry} text={text} en={en} /> : entry.signed ? <><SignatureRecord name={entry.signer_name} at={entry.signed_at} signature={entry.signature_data_url} text={text} en={en} />{entry.has_frozen_document !== false ? <Button variant="outline" disabled={busy} className="gap-2" onClick={() => void preview(entry)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{labels.document}</Button> : <p className="text-sm text-muted-foreground">{text("النسخة الأصلية الموقّعة غير متاحة للتنزيل.", "The original signed document is unavailable for download.")}</p>}</> : <SignatureForm text={text} name={data.customer.name} disabled={busy} consentLabel={text("قرأت بيانات الدخول وحالة المركبة والملاحظات والأضرار الجديدة، وأقر بصحتها وأوافق على حفظ توقيعي على هذا الإصدار وإصدار وصل الاستلام.", "I have reviewed the intake details, running status, notes and new damage. I confirm they are correct and agree to save my signature on this revision and issue the intake receipt.")} onSubmit={(name, signature, consent) => authenticated((session) => signVehiclePortalEntry(token, session, entry, name, signature, consent), (saved) => saved.entries.some((row) => row.id === entry.id && row.revision === entry.revision && row.signed && !row.legacy_signature))} />}
              {entry.releases?.map((release) => <section key={release.id} className="space-y-3 rounded-lg border p-3"><h4 className="font-semibold">{text("إذن الخروج المؤقت للفحص", "Temporary inspection release")} · {release.release_number}</h4><ReleaseReport release={release} text={text} en={en} /><p className="whitespace-pre-wrap text-sm">{en ? release.declaration_en : release.declaration_ar}</p>{release.signed_at ? <SignatureRecord name={release.signer_name} at={release.signed_at} signature={release.signature_data_url} text={text} en={en} /> : release.status === "awaiting_signature" ? <SignatureForm key={`${release.id}:${release.digest}`} text={text} name={release.recipient_name || release.form_data?.recipient_name} disabled={busy} consentLabel={text("قرأت إذن الخروج المؤقت وأوافق على إقراره وحفظ توقيعي عليه.", "I have read the temporary release and agree to its declaration and to save my signature.")} onSubmit={(name, signature, consent) => authenticated((session) => signVehiclePortalRelease(token, session, release, name, signature, consent), (saved) => saved.entries.some((row) => row.releases?.some((item) => item.id === release.id && item.digest === release.digest && !!item.signed_at)))} /> : <p className="text-sm text-muted-foreground">{text("لم يجهّز إذن الخروج للتوقيع بعد.", "The release is not ready for signature yet.")}</p>}</section>)}
            </Card>;
          })}
        </section>}
        {selectedTab === "order" && data.order?.enabled && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">{text("أمر العمل", "Work order")} {data.order.order_number}</h2>{data.order.work_summary && <p className="whitespace-pre-wrap">{data.order.work_summary}</p>}
          {data.order.diagnosis && <div><h3 className="font-semibold">{text("التشخيص", "Diagnosis")}</h3><p className="whitespace-pre-wrap text-sm">{data.order.diagnosis}</p></div>}
          {!!data.order.work_items?.length && <div><h3 className="font-semibold">{text("الأعمال المعتمدة", "Approved work")}</h3><ol className="list-inside list-decimal space-y-2 pt-2">{data.order.work_items.map((item, index) => <li key={index} className="rounded-lg border p-3 text-sm"><span className="font-medium">{item.title}</span>{item.note && <p className="whitespace-pre-wrap pt-1 text-muted-foreground">{item.note}</p>}</li>)}</ol></div>}<p className="whitespace-pre-wrap text-sm">{en ? data.order.declaration_en : data.order.declaration_ar}</p>{data.order.legacy_signature ? <p className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">{text("موقّع سابقًا؛ نسخة محتوى المستند الأصلي الموقّع غير متاحة.", "Previously signed; the original signed content snapshot is unavailable.")}</p> : data.order.signed ? <SignatureRecord name={data.order.signer_name} at={data.order.signed_at} signature={data.order.signature_data_url} text={text} en={en} /> : <SignatureForm key={`${data.order.id}:${data.order.digest}`} text={text} name={data.customer.name} disabled={busy} consentLabel={text("قرأت أمر العمل والأعمال الموضحة وأوافق على حفظ توقيعي على إقراره.", "I have read the work order and listed work and agree to save my signature on its declaration.")} onSubmit={(name, signature, consent) => authenticated((session) => signVehiclePortalOrder(token, session, data.order!, name, signature, consent), (saved) => saved.order?.signed === true && saved.order.id === data.order?.id && saved.order.digest === data.order?.digest)} />}
          {data.order.tracking && <VehiclePortalOrderTracking key={data.order.id} tracking={data.order.tracking} language={en ? "en" : "ar"} busy={busy} onFeedback={(rating, comment) => sendFeedback(data.order!.id || "", rating, comment)} onNote={(note) => sendNote(data.order!.id || "", note)} />}
        </Card>}
        {selectedTab === "delivery" && data.delivery?.enabled && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">{text("تأكيد استلام وخروج المركبة", "Vehicle delivery confirmation")}</h2><p>{text("وصل الاستلام المرتبط", "Linked intake receipt")}: {data.delivery.receipt_number || "—"}</p>{data.delivery.work_summary && <p className="whitespace-pre-wrap">{data.delivery.work_summary}</p>}<SignatureRecord name={data.delivery.recipient_name} at={data.delivery.delivered_at} signature={data.delivery.signature_data_url} text={text} en={en} /></Card>}
        <PdfPreviewDialog open={!!document} onOpenChange={(open) => { if (!open) setDocument(null); }} htmlContent={document?.html || ""} title={text("الوصل مع نموذج دخول المركبة", "Receipt with vehicle intake form")} fileName={`vehicle-intake-${document?.number || "document"}`} allowShare={false} />
      </>}
    </div>
  </main>;
}
