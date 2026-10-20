import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Eraser, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface PublicRelease {
  release_number: string;
  entry_snapshot: Record<string, any>;
  form_data: Record<string, string>;
  declaration_ar: string;
  declaration_en: string;
  signed: boolean;
  signer_name?: string;
  signed_at?: string;
  error?: string;
}

interface PublicPhoto { id: string; url: string; category?: string; file_name?: string }

export default function VehicleInspectionReleaseSignPage() {
  const { token } = useParams<{ token: string }>();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const t = (ar: string, en: string) => isAr ? ar : en;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const inkRef = useRef(false);
  const [data, setData] = useState<PublicRelease | null>(null);
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) { setError("invalid_link"); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: response, error: rpcError } = await supabase.rpc(
        "get_vehicle_inspection_release_for_signature" as any,
        { p_token: token } as any,
      );
      const result = response as unknown as PublicRelease | null;
      if (rpcError || !result || result.error) {
        setError(result?.error || "invalid_link");
        setData(null);
        return;
      }
      setData(result);
      setError(null);
      const { data: media, error: mediaError } = await supabase.functions.invoke(
        "vehicle-entry-signature-media",
        { body: { token, purpose: "inspection_release" } },
      );
      setPhotos(!mediaError && Array.isArray(media?.media) ? media.media : []);
    } catch {
      setError("unavailable");
      setData(null);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawingRef.current = true;
    const p = point(event);
    context.beginPath(); context.moveTo(p.x, p.y);
    canvas.setPointerCapture(event.pointerId);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext("2d");
    if (!drawingRef.current || !context) return;
    const p = point(event);
    context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    context.strokeStyle = "#14213d"; context.lineTo(p.x, p.y); context.stroke();
    inkRef.current = true;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    inkRef.current = false;
  }

  async function submit() {
    if (!token || !data || !canvasRef.current) return;
    if (!agreed || !inkRef.current || !signerName.trim()) {
      toast.error(t("يرجى قراءة الإقرار وكتابة اسم المستلم ورسم التوقيع", "Read the acknowledgement, enter the recipient name, and draw your signature"));
      return;
    }
    setSubmitting(true);
    try {
      const { data: response, error: rpcError } = await supabase.rpc(
        "submit_vehicle_inspection_release_signature" as any,
        {
          p_token: token,
          p_signature: canvasRef.current.toDataURL("image/png"),
          p_signer_name: signerName.trim(),
          p_user_agent: navigator.userAgent,
        } as any,
      );
      if (rpcError) throw rpcError;
      if (!(response as any)?.ok) throw new Error("signature_not_saved");
      toast.success(t("تم حفظ التوقيع والخروج المؤقت", "Signature and temporary release confirmed"));
      await load();
    } catch (submitError: any) {
      toast.error(String(submitError?.message || "").includes("expired_link")
        ? t("انتهت صلاحية الرابط؛ اطلب رابطًا جديدًا", "Link expired; request a new one")
        : t("لم يُحفظ التوقيع؛ تواصل مع الورشة قبل المغادرة", "Signature not saved; contact the workshop before leaving"));
    } finally { setSubmitting(false); }
  }

  if (loading) return <main className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></main>;
  if (error || !data) return <main className="min-h-screen grid place-items-center bg-slate-50 p-4" dir={isAr ? "rtl" : "ltr"}>
    <div className="max-w-md rounded-xl border bg-white p-6 text-center"><AlertCircle className="mx-auto h-10 w-10 text-red-600" />
      <h1 className="mt-3 text-xl font-bold">{t("رابط التوقيع غير متاح", "Signature link unavailable")}</h1>
      <p className="mt-2 text-sm">{error === "expired_link" ? t("انتهت صلاحية الرابط؛ اطلب رابطًا جديدًا من الورشة.", "The link expired; request a new one from the workshop.") : t("الرابط غير صالح أو أُلغي.", "The link is invalid or revoked.")}</p></div>
  </main>;

  const snap = data.entry_snapshot || {};
  const vehicle = snap.vehicle || {};
  const form = data.form_data || {};
  const plate = [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ");
  const display = (ar: string, en: string, value: unknown) => <div className="rounded border p-3"><small className="text-slate-500">{t(ar, en)}</small><div className="font-semibold break-words">{String(value || "—")}</div></div>;

  return <main className="min-h-screen bg-slate-50 p-3 sm:p-6" dir={isAr ? "rtl" : "ltr"}>
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="rounded-xl border bg-white p-5 text-center"><FileSignature className="mx-auto h-9 w-9 text-primary" />
        <h1 className="mt-2 text-xl font-bold">{t("توقيع محضر معاينة وتسليم مؤقت", "Inspection & Temporary Release Signature")}</h1>
        <p className="mt-2 font-mono text-sm" dir="ltr">{data.release_number} · {snap.entry_number}</p>
      </header>
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-bold">{t("المركبة والمستلم", "Vehicle & Recipient")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">{display("اللوحة", "Plate", plate)}{display("المركبة", "Vehicle", [vehicle.make || vehicle.brand, vehicle.model].filter(Boolean).join(" "))}
          {display("اسم المستلم", "Recipient", form.recipient_name)}{display("رقم الهوية", "ID number", form.recipient_id_number)}
          {display("حالة المركبة عند الخروج", "Condition at exit", form.exit_condition)}{display("المحتويات والمفاتيح", "Contents and keys", `${form.contents_handed_over || "—"} · ${form.keys_handed_over || "—"}`)}</div>
      </section>
      <section className="rounded-xl border bg-white p-4 space-y-3"><h2 className="font-bold">{t("ما تم فحصه والإجراء المنتظر", "Inspection and pending action")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">{display("ملخص المعاينة", "Inspection summary", form.inspection_summary)}{display("ما تم فحصه", "Inspected items", form.inspected_items)}
          {display("ما لم يُفحص", "Not inspected", form.uninspected_items)}{display("الإجراء المنتظر", "Pending action", form.pending_action)}</div>
        {Array.isArray(snap.damage_marks) && snap.damage_marks.length > 0 && <div className="rounded border p-3 text-sm"><strong>{t("الأضرار المسجلة عند الدخول", "Damage recorded at entry")}</strong>
          {snap.damage_marks.map((mark: any) => <div key={mark.mark_number}>#{mark.mark_number} · {mark.vehicle_part || "—"} · {mark.description || mark.notes || "—"}</div>)}</div>}
      </section>
      {photos.length > 0 && <section className="rounded-xl border bg-white p-4"><h2 className="mb-3 font-bold">{t("صور الدخول المرتبطة", "Linked entry photos")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{photos.map((photo) => <figure key={photo.id} className="rounded border p-1">
          <img src={photo.url} alt="" loading="lazy" className="aspect-[4/3] w-full object-contain" /><figcaption className="truncate text-center text-xs">{photo.category || photo.file_name}</figcaption>
        </figure>)}</div></section>}
      <section className="rounded-xl border bg-white p-4"><h2 className="font-bold">{t("الإقرار", "Acknowledgement")}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{isAr ? data.declaration_ar : data.declaration_en}</p></section>
      {data.signed ? <section className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center text-emerald-900"><CheckCircle2 className="mx-auto h-10 w-10" />
        <h2 className="mt-2 font-bold">{t("تم اعتماد التوقيع", "Signature confirmed")}</h2><p>{data.signer_name} · {data.signed_at}</p></section>
        : <section className="rounded-xl border bg-white p-4 space-y-3">
          <label className="flex items-start gap-2 text-sm leading-7"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-2" />
            <span>{t("راجعت بيانات المعاينة وحالة المركبة والمحتويات، وأقر باستلامها مؤقتًا حسب ما ورد أعلاه.", "I reviewed the inspection, vehicle condition, and listed contents, and acknowledge temporary receipt as stated above.")}</span></label>
          <label className="block space-y-1 text-sm font-semibold">
            <span>{t("اكتب اسم المستلم كما يظهر أعلاه", "Enter the recipient name as shown above")}</span>
            <Input value={signerName} onChange={(event) => setSignerName(event.target.value)} maxLength={160} autoComplete="name" />
          </label>
          <div className="font-semibold">{t("توقيع المستلم", "Recipient signature")}: {form.recipient_name}</div>
          <canvas ref={canvasRef} width={900} height={300} className="h-40 w-full touch-none rounded border-2 border-dashed bg-white"
            onPointerDown={start} onPointerMove={draw} onPointerUp={() => { drawingRef.current = false; }} onPointerCancel={() => { drawingRef.current = false; }} onPointerLeave={() => { drawingRef.current = false; }} />
          <Button variant="ghost" size="sm" onClick={clear}><Eraser size={14} className="me-1" />{t("مسح", "Clear")}</Button>
          <Button className="w-full" disabled={submitting} onClick={() => void submit()}>{submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("اعتماد التوقيع الإلكتروني", "Confirm electronic signature")}</Button>
          <p className="text-xs text-slate-500">{t("الرابط مخصص للمستلم المذكور، والتوقيع يوثّق الاستلام المؤقت ولا يثبت الهوية عبر OTP.", "This link is for the named recipient. It records temporary receipt and does not verify identity by OTP.")}</p>
        </section>}
    </div>
  </main>;
}
