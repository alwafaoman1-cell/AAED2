import { useState } from "react";
import { Camera, Loader2, MessageSquare, Star, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { VehiclePortalTracking } from "@/lib/unifiedVehiclePortal";

const stages: Record<string, [string, string]> = {
  received: ["استلام المركبة", "Vehicle received"], inspection: ["الفحص والتقدير", "Inspection and estimate"],
  waiting_insurance: ["بانتظار الموافقة", "Waiting for approval"], insurance_approved: ["تم اعتماد التأمين", "Insurance approved"],
  parts_in_transit: ["بانتظار وصول القطع", "Parts in transit"], in_repair: ["تحت الإصلاح", "Under repair"],
  quality: ["الفحص النهائي", "Final check"], ready: ["جاهزة للتسليم", "Ready for delivery"], delivered: ["تم التسليم", "Delivered"],
};
const phases: Record<string, [string, string]> = {
  received: ["صور الاستلام", "Intake photos"], inspection: ["صور الفحص", "Inspection photos"],
  in_progress: ["أثناء الإصلاح", "During repair"], in_repair: ["أثناء الإصلاح", "During repair"],
  quality: ["فحص الجودة", "Quality check"], delivery: ["صور التسليم", "Delivery photos"], after: ["بعد الإصلاح", "After repair"],
};
function safePhoto(url: string) { return /^https:\/\//i.test(url) || /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(url); }

export default function VehiclePortalOrderTracking({ tracking, language, busy, onFeedback, onNote }: {
  tracking: VehiclePortalTracking; language: "ar" | "en"; busy: boolean;
  onFeedback: (rating: number, comment: string) => Promise<boolean>; onNote: (note: string) => Promise<boolean>;
}) {
  const en = language === "en"; const text = (ar: string, english: string) => en ? english : ar;
  const [rating, setRating] = useState(0); const [comment, setComment] = useState("");
  const [note, setNote] = useState(""); const [noteSaved, setNoteSaved] = useState(false);
  const progress = Number.isFinite(Number(tracking.progress_pct)) ? Math.max(0, Math.min(100, Number(tracking.progress_pct))) : 0;
  const stage = stages[tracking.stage_key]?.[en ? 1 : 0] || text("جارٍ تحديث الحالة", "Status update pending");
  const progressLabel = text("تقدم أعمال المركبة", "Vehicle repair progress");
  const ratingLabel = text("من 5 نجوم", "out of 5 stars");
  const feedbackLabel = text("إرسال التقييم", "Submit feedback");
  const noteLabel = text("إرسال الملاحظة", "Send note");
  const displayTime = (value?: string | null) => value ? new Date(value).toLocaleString(en ? "en-GB" : "ar-OM", { timeZone: "Asia/Muscat" }) : "";
  const photos = (tracking.photos || []).filter((photo) => typeof photo.url === "string" && safePhoto(photo.url));
  return <section className="space-y-4 border-t pt-4" aria-label={progressLabel}>
    <div className="space-y-2"><h3 className="flex items-center gap-2 font-semibold"><Wrench className="h-5 w-5" />{progressLabel}</h3><div className="flex justify-between gap-3 text-sm"><strong>{stage}</strong><span>{progress.toLocaleString(en ? "en-GB" : "ar-OM")}%</span></div><div role="progressbar" aria-label={progressLabel} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>{tracking.updated_at && <p className="text-xs text-muted-foreground">{text("آخر تحديث — مسقط", "Last updated — Muscat")}: {displayTime(tracking.updated_at)}</p>}</div>
    {photos.length > 0 && <div className="space-y-2"><h4 className="flex items-center gap-2 text-sm font-semibold"><Camera className="h-4 w-4" />{text("صور تقدم العمل", "Work progress photos")}</h4><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{photos.map((photo, index) => {
      const phase = phases[photo.phase || ""]?.[en ? 1 : 0] || text("تحديث المركبة", "Vehicle update");
      return <figure key={`${photo.url}:${index}`} className="overflow-hidden rounded-lg border"><a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={photo.caption || phase} className="aspect-video w-full bg-muted object-cover" loading="lazy" referrerPolicy="no-referrer" /></a><figcaption className="space-y-1 p-2 text-xs"><p className="font-medium text-primary">{phase}</p>{photo.caption && <p>{photo.caption}</p>}</figcaption></figure>;
    })}</div></div>}
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">{text("الملاحظات والتواصل مع الورشة", "Notes and workshop communication")}</summary><div className="mt-3 space-y-3">
      {!!tracking.messages?.length && <ul className="max-h-60 space-y-2 overflow-auto">{tracking.messages.map((message, index) => <li key={`${message.created_at}:${index}`} className="rounded-lg bg-muted/50 p-3 text-sm"><p className="whitespace-pre-wrap">{message.message}</p>{message.created_at && <p className="mt-1 text-xs text-muted-foreground">{displayTime(message.created_at)}</p>}</li>)}</ul>}
      <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (busy || note.trim().length < 2) return; if (await onNote(note)) { setNote(""); setNoteSaved(true); } }}>
        <label className="block space-y-1 text-sm"><span>{text("ملاحظتك للورشة", "Your note to the workshop")}</span><Textarea value={note} onChange={(event) => { setNote(event.target.value); setNoteSaved(false); }} rows={3} maxLength={2000} disabled={busy} /></label>
        <Button type="submit" variant="outline" size="sm" disabled={busy || note.trim().length < 2} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}{noteLabel}</Button>
        {noteSaved && <p role="status" className="text-sm text-emerald-700">{text("حُفظت ملاحظتك وأصبحت متاحة لفريق الورشة للمراجعة.", "Your note was saved for the workshop team to review.")}</p>}
      </form>
    </div></details>
    {(tracking.feedback || tracking.stage_key === "delivered") && <section className="space-y-3 rounded-lg border p-3"><h4 className="flex items-center gap-2 text-sm font-semibold"><Star className="h-4 w-4" />{text("تقييم تجربتك", "Rate your experience")}</h4>{tracking.feedback ? <div className="space-y-1 text-sm"><p>{tracking.feedback.rating} / 5</p>{tracking.feedback.comment && <p className="whitespace-pre-wrap">{tracking.feedback.comment}</p>}<p className="text-xs text-muted-foreground">{displayTime(tracking.feedback.created_at)}</p></div> : <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); if (busy || rating < 1) return; if (await onFeedback(rating, comment)) { setRating(0); setComment(""); } }}>
      <div role="group" aria-label={text("تقييم من 1 إلى 5", "Rating from 1 to 5")} className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map((score) => {
        const label = `${score} ${ratingLabel}`;
        return <button key={score} type="button" disabled={busy} aria-label={label} aria-pressed={rating === score} onClick={() => setRating(score)} className={`rounded-lg border p-2 ${score <= rating ? "border-amber-400 text-amber-500" : "text-muted-foreground"}`}><Star className={`h-6 w-6 ${score <= rating ? "fill-current" : ""}`} /></button>;
      })}</div><label className="block space-y-1 text-sm"><span>{text("تعليق اختياري", "Optional comment")}</span><Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={500} disabled={busy} /></label><Button type="submit" size="sm" disabled={busy || rating < 1} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{feedbackLabel}</Button>
    </form>}</section>}
  </section>;
}
