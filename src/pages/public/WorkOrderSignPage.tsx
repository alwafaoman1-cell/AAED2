import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldCheck, CheckCircle2, Eraser, Car, FileText, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface WorkItem { id: string; title: string; note?: string }
interface SignData {
  order_number: string;
  entry_date: string;
  description?: string;
  diagnosis?: string;
  work_items: WorkItem[];
  vehicle: { plate?: string; brand?: string; model?: string; year?: number; color?: string };
  customer: { name?: string; phone?: string };
  workshop_name?: string;
  signed: boolean;
  signed_at?: string;
  signer_name?: string;
  signature_data_url?: string;
}

export default function WorkOrderSignPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SignData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data: r, error } = await supabase.rpc("get_work_order_for_sign", { p_token: token });
    if (error) { setErr(error.message); setLoading(false); return; }
    const obj: any = r;
    if (obj?.error) { setErr(obj.error); setLoading(false); return; }
    setData(obj as SignData);
    setName(obj?.signer_name || obj?.customer?.name || "");
    setLoading(false);
  }
  useEffect(() => { load(); }, [token]);

  // --- Signature canvas ---
  function pos(e: PointerEvent | React.PointerEvent, c: HTMLCanvasElement) {
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current; if (!c) return;
    drawingRef.current = true;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const p = pos(e, c);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const p = pos(e, c);
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
    ctx.lineTo(p.x, p.y); ctx.stroke();
    hasInkRef.current = true;
  }
  function endDraw() { drawingRef.current = false; }
  function clearCanvas() {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    hasInkRef.current = false;
  }

  async function submit() {
    if (!data || !token) return;
    if (!hasInkRef.current) { toast.error("الرجاء التوقيع في المربع أدناه"); return; }
    if (!name.trim()) { toast.error("الرجاء كتابة اسم الموقّع"); return; }
    if (!agreed) { toast.error("الرجاء الموافقة على البنود قبل التوقيع"); return; }
    const c = canvasRef.current; if (!c) return;
    const sig = c.toDataURL("image/png");
    setSubmitting(true);
    try {
      const ua = navigator.userAgent;
      const { error } = await supabase.rpc("submit_work_order_signature", {
        p_token: token, p_signature: sig, p_signer_name: name.trim(),
        p_ip: null, p_user_agent: ua,
      });
      if (error) throw error;
      toast.success("✅ تم استلام توقيعك. شكراً لك!");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر إرسال التوقيع");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
  if (err || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6" dir="rtl">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 text-center space-y-3">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
        <h2 className="text-lg font-bold text-foreground">رابط غير صالح</h2>
        <p className="text-sm text-muted-foreground">{err === "not_found" ? "لم يتم العثور على أمر العمل." : err === "revoked" ? "تم إيقاف هذا الرابط." : "تعذّر تحميل الصفحة."}</p>
      </div>
    </div>
  );

  const v = data.vehicle || {};
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/30 p-4 md:p-6" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-card border border-border rounded-2xl p-5 text-center">
          <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-2" />
          <h1 className="text-xl font-bold text-foreground">{data.workshop_name || "الورشة"}</h1>
          <p className="text-xs text-muted-foreground mt-1">أمر العمل رقم <span className="font-mono font-bold text-foreground" dir="ltr">{data.order_number}</span> — بتاريخ {data.entry_date}</p>
        </div>

        {/* Vehicle + customer */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Car size={16} /> بيانات المركبة</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-muted-foreground">العميل:</span> <span className="text-foreground font-medium">{data.customer?.name || "-"}</span></div>
            <div><span className="text-muted-foreground">الهاتف:</span> <span className="text-foreground font-mono" dir="ltr">{data.customer?.phone || "-"}</span></div>
            <div><span className="text-muted-foreground">المركبة:</span> <span className="text-foreground font-medium">{[v.brand, v.model, v.year].filter(Boolean).join(" ")}</span></div>
            <div><span className="text-muted-foreground">اللوحة:</span> <span className="text-foreground font-mono" dir="ltr">{v.plate || "-"}</span></div>
            {v.color && <div><span className="text-muted-foreground">اللون:</span> <span className="text-foreground">{v.color}</span></div>}
          </div>
        </div>

        {/* Work items */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground"><FileText size={16} /> بنود الأعمال المطلوبة</div>
          {(data.work_items || []).length === 0 && !data.description && !data.diagnosis ? (
            <p className="text-xs text-muted-foreground">لم يتم تحديد بنود تفصيلية. الرجاء التواصل مع الورشة للاستفسار.</p>
          ) : (
            <>
              {(data.work_items || []).length > 0 && (
                <ol className="space-y-2">
                  {data.work_items.map((w, i) => (
                    <li key={w.id} className="flex gap-3 items-start bg-secondary/40 border border-border rounded-lg p-2.5">
                      <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">{w.title || "-"}</div>
                        {w.note && <div className="text-[11px] text-muted-foreground mt-0.5">{w.note}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {data.description && (
                <div className="text-xs bg-secondary/40 border border-border rounded-lg p-2.5">
                  <div className="text-muted-foreground mb-1">الوصف:</div>
                  <div className="text-foreground whitespace-pre-wrap">{data.description}</div>
                </div>
              )}
              {data.diagnosis && (
                <div className="text-xs bg-secondary/40 border border-border rounded-lg p-2.5">
                  <div className="text-muted-foreground mb-1">التشخيص الأولي:</div>
                  <div className="text-foreground whitespace-pre-wrap">{data.diagnosis}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Already signed view */}
        {data.signed ? (
          <div className="bg-card border-2 border-success/40 rounded-2xl p-5 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-bold text-foreground">تم التوقيع بنجاح</h2>
            <p className="text-xs text-muted-foreground">
              وقّع بواسطة: <span className="font-medium text-foreground">{data.signer_name || "-"}</span>
              <br />
              بتاريخ: <span className="font-mono" dir="ltr">{data.signed_at ? new Date(data.signed_at).toLocaleString() : "-"}</span>
            </p>
            {data.signature_data_url && (
              <div className="bg-white rounded-lg border border-border p-3 inline-block">
                <img src={data.signature_data_url} alt="التوقيع" className="max-h-32" />
              </div>
            )}
          </div>
        ) : (
          // Signing form
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="text-sm font-bold text-foreground">التوقيع الإلكتروني</div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              <span>أوافق على بنود الأعمال المذكورة أعلاه وأفوّض الورشة بالقيام بالإصلاحات.</span>
            </label>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">اسم الموقّع</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="الاسم الكامل" className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">التوقيع (وقّع بإصبعك في المربع)</label>
              <div className="bg-white border-2 border-dashed border-border rounded-lg overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={200}
                  className="w-full h-40 touch-none"
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                />
              </div>
              <button type="button" onClick={clearCanvas} className="text-[11px] text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1">
                <Eraser size={12} /> مسح
              </button>
            </div>
            <Button onClick={submit} disabled={submitting} className="w-full h-11 gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 size={16} />}
              {submitting ? "جاري الإرسال..." : "تأكيد التوقيع"}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              يُسجَّل التوقيع مع التاريخ والوقت كإثبات قانوني.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
