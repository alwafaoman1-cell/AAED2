import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Car, CheckCircle2, Eraser, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { VEHICLE_ENTRY_DECLARATION_AR, VEHICLE_ENTRY_DECLARATION_EN } from "@/lib/vehicleEntryService";
import { toast } from "sonner";

interface EntrySignatureData {
  entry_number: string;
  arrival_date?: string;
  arrival_time?: string;
  arrival_method?: string;
  customer?: { name?: string };
  vehicle?: {
    plate_number?: string;
    plate_letters?: string;
    make?: string;
    model?: string;
    year?: string;
    color?: string;
    vin?: string;
  };
  vehicle_condition?: Record<string, unknown>;
  vehicle_contents?: Record<string, unknown>;
  declaration_ar?: string;
  declaration_en?: string;
  signed: boolean;
  signer_name?: string;
  signed_at?: string;
  expires_at?: string;
  error?: string;
}

const errorMessage = (error?: string | null) => {
  if (error === "expired_link") return "انتهت صلاحية رابط التوقيع. يرجى طلب رابط جديد من الورشة.";
  if (error === "entry_unavailable") return "نموذج دخول المركبة غير متاح للتوقيع.";
  return "الرابط غير صالح أو تم إيقافه. يرجى التواصل مع الورشة.";
};

export default function VehicleEntrySignPage() {
  const { token } = useParams<{ token: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [data, setData] = useState<EntrySignatureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("invalid_link");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: response, error: requestError } = await supabase.rpc(
      "get_vehicle_entry_for_customer_signature" as any,
      { p_token: token } as any,
    );
    const result = response as unknown as EntrySignatureData | null;
    if (requestError || !result || result.error) {
      setError(result?.error || "invalid_link");
      setLoading(false);
      return;
    }
    setData(result);
    setSignerName(result.signer_name || result.customer?.name || "");
    setError(null);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawingRef.current = true;
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture?.(event.pointerId);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!drawingRef.current || !canvas || !context) return;
    const point = canvasPoint(event);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
    context.lineTo(point.x, point.y);
    context.stroke();
    hasInkRef.current = true;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
  };

  const submit = async () => {
    if (!token || !data || !canvasRef.current) return;
    if (!agreed) {
      toast.error("يجب الموافقة على الإقرار قبل التوقيع");
      return;
    }
    if (!signerName.trim()) {
      toast.error("يرجى إدخال اسم الموقّع");
      return;
    }
    if (!hasInkRef.current) {
      toast.error("يرجى رسم التوقيع داخل المربع");
      return;
    }

    setSubmitting(true);
    try {
      const { data: response, error: requestError } = await supabase.rpc(
        "submit_vehicle_entry_customer_signature" as any,
        {
          p_token: token,
          p_signature: canvasRef.current.toDataURL("image/png"),
          p_signer_name: signerName.trim(),
          p_user_agent: navigator.userAgent,
        } as any,
      );
      if (requestError) throw requestError;
      const result = response as unknown as { ok?: boolean } | null;
      if (!result?.ok) throw new Error("تعذر اعتماد التوقيع");
      toast.success("تم اعتماد توقيع استلام المركبة بنجاح");
      await load();
    } catch (submitError: any) {
      const message = String(submitError?.message || "");
      toast.error(message.includes("expired_link") ? errorMessage("expired_link") : "تعذر حفظ التوقيع. يرجى المحاولة مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>;
  }

  if (error || !data) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 p-5" dir="rtl">
        <section className="w-full max-w-lg rounded-2xl border bg-white p-7 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-3 text-xl font-bold">تعذر فتح رابط التوقيع</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{errorMessage(error)}</p>
        </section>
      </main>
    );
  }

  const vehicle = data.vehicle || {};
  const plate = [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—";
  const vehicleName = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—";
  const declarationAr = data.declaration_ar || VEHICLE_ENTRY_DECLARATION_AR;
  const declarationEn = data.declaration_en || VEHICLE_ENTRY_DECLARATION_EN;
  const condition = data.vehicle_condition || {};
  const contents = data.vehicle_contents || {};
  const conditionText = [
    condition.condition_description,
    condition.visible_damage,
    condition.previous_damage,
    condition.additional_notes,
    condition.mechanical_notes,
  ].filter(Boolean).map(String);

  return (
    <main className="min-h-screen bg-slate-50 p-3 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-2xl border bg-white p-5 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-2 text-xl font-bold">توقيع دخول واستلام المركبة</h1>
          <p className="text-sm font-semibold text-slate-600" dir="ltr">Vehicle Entry & Receipt Signature</p>
          <div className="mt-3 inline-flex rounded-lg bg-primary/10 px-4 py-2 font-mono text-lg font-black text-primary" dir="ltr">
            {data.entry_number}
          </div>
        </header>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 font-bold"><Car size={18} /> بيانات المركبة / Vehicle</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Info label="اسم العميل / Customer" value={data.customer?.name || "—"} />
            <Info label="رقم اللوحة / Plate" value={plate} emphasize />
            <Info label="المركبة / Make & Model" value={vehicleName} />
            <Info label="رقم الهيكل / VIN" value={vehicle.vin || "—"} />
            <Info label="تاريخ الدخول / Entry Date" value={data.arrival_date || "—"} />
            <Info label="طريقة الوصول / Arrival" value={data.arrival_method || "—"} />
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-bold"><FileSignature size={18} /> الإقرار / Declaration</div>
          <div className="mb-4 rounded-xl border bg-slate-50 p-4">
            <div className="text-sm font-bold">حالة المركبة عند الدخول / Vehicle Condition at Entry</div>
            {conditionText.length > 0 ? (
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
                {conditionText.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
              </ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">لا توجد ملاحظات إضافية مسجلة.</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs sm:grid-cols-4">
              <span>المفاتيح: <b>{String(contents.keys_count || "—")}</b></span>
              <span>الوقود: <b>{String(contents.fuel_level || "—")}</b></span>
              <span>الاستمارة: <b>{contents.registration_card ? "نعم" : "لا"}</b></span>
              <span>أغراض شخصية: <b>{contents.personal_items ? "نعم" : "لا"}</b></span>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{declarationAr}</p>
          <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-left text-sm leading-6 text-slate-700" dir="ltr">{declarationEn}</p>
        </section>

        {data.signed ? (
          <section className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h2 className="mt-2 text-lg font-bold text-emerald-900">تم اعتماد التوقيع</h2>
            <p className="mt-1 text-sm text-emerald-800">{data.signer_name || "—"}</p>
            <p className="text-xs text-emerald-700" dir="ltr">{data.signed_at ? new Date(data.signed_at).toLocaleString("en-GB") : ""}</p>
          </section>
        ) : (
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-slate-50 p-4 text-sm leading-6">
              <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>قرأت بيانات المركبة والإقرار أعلاه، وأوافق عليها وأعتمد توقيعي الإلكتروني.<br /><span dir="ltr">I have reviewed the vehicle details and declaration and approve my electronic signature.</span></span>
            </label>
            <label className="mt-4 block text-sm font-semibold">اسم الموقّع / Signer Name</label>
            <Input value={signerName} onChange={(event) => setSignerName(event.target.value)} maxLength={160} className="mt-1" />
            <label className="mt-4 block text-sm font-semibold">التوقيع / Signature</label>
            <div className="mt-1 overflow-hidden rounded-xl border-2 border-dashed bg-white">
              <canvas
                ref={canvasRef}
                width={900}
                height={300}
                className="h-44 w-full touch-none cursor-crosshair"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerLeave={stopDrawing}
              />
            </div>
            <button type="button" onClick={clearSignature} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Eraser size={13} /> مسح التوقيع
            </button>
            <Button className="mt-4 h-12 w-full gap-2" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 size={17} />}
              {submitting ? "جاري الحفظ..." : "اعتماد التوقيع الإلكتروني"}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">يُحفظ التوقيع مع وقت الاعتماد ونسخة الإقرار، ويظهر داخل مستند دخول المركبة.</p>
          </section>
        )}
      </div>
    </main>
  );
}

function Info({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words font-bold ${emphasize ? "text-lg text-red-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
