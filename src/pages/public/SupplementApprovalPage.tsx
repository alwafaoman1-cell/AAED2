// صفحة عامة لموافقة العميل — /c/approve/:token (لا تتطلب تسجيل دخول)
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, Eraser, ShieldCheck, Car, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Item {
  id: string; description: string; quantity: number; unit_price: number;
  notes: string | null; photos: string[]; status: string; total: number;
}
interface ApprovalData {
  request: { id: string; status: string; expires_at: string; expired: boolean; signed_at: string | null };
  work_order: { order_number: string; description: string };
  customer: { name: string; phone: string };
  vehicle: { plate: string; brand: string; model: string; year: number; color: string };
  items: Item[];
}

export default function SupplementApprovalPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [data, setData] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected" | null>>({});
  const [signerName, setSignerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => { document.documentElement.dir = "rtl"; }, []);

  useEffect(() => {
    (async () => {
      try {
        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const res = await fetch(`${base}/functions/v1/supplement-public?token=${encodeURIComponent(token)}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        const json = await res.json();
        if (json.error) setError(json.error);
        else setData(json);
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [token]);

  // Signature canvas handlers
  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    drawing.current = true;
    draw(e);
  }
  function endDraw() {
    drawing.current = false;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.beginPath();
  }
  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#000";
    ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
  }
  function clearSig() {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
  function hasSignature(): boolean {
    const canvas = canvasRef.current; if (!canvas) return false;
    const ctx = canvas.getContext("2d"); if (!ctx) return false;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
    return false;
  }

  function setAll(d: "approved" | "rejected") {
    const next: Record<string, any> = {};
    data?.items.forEach((i) => { if (i.status === "pending_customer") next[i.id] = d; });
    setDecisions(next);
  }

  async function submit() {
    if (!data) return;
    const pending = data.items.filter((i) => i.status === "pending_customer");
    if (pending.some((i) => !decisions[i.id])) {
      toast.error("الرجاء اتخاذ قرار لكل بند");
      return;
    }
    if (!signerName.trim()) { toast.error("الرجاء كتابة اسمك"); return; }
    if (!hasSignature()) { toast.error("الرجاء التوقيع"); return; }

    setSubmitting(true);
    try {
      const signature = canvasRef.current!.toDataURL("image/png");
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${base}/functions/v1/supplement-public`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          token,
          decisions: pending.map((i) => ({ supplement_id: i.id, decision: decisions[i.id] })),
          signature, signer_name: signerName.trim(),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSubmitted(true);
    } catch (e: any) {
      toast.error(e.message || "فشل الإرسال");
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <AlertCircle className="mx-auto text-destructive" size={48}/>
        <h1 className="text-xl font-bold mt-3">رابط غير صالح</h1>
        <p className="text-sm text-muted-foreground mt-2">{error === "not_found" ? "الرابط غير موجود." : error === "invalid_token" ? "الرابط غير صحيح." : "تعذّر تحميل الطلب."}</p>
      </div>
    </div>
  );

  if (data.request.expired || data.request.status === "expired") return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <AlertCircle className="mx-auto text-warning" size={48}/>
        <h1 className="text-xl font-bold mt-3">انتهت صلاحية الرابط</h1>
        <p className="text-sm text-muted-foreground mt-2">الرابط صالح لمدة 24 ساعة فقط. تواصل مع الورشة لإصدار رابط جديد.</p>
      </div>
    </div>
  );

  if (submitted || data.request.status === "signed") return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <CheckCircle2 className="mx-auto text-success" size={64}/>
        <h1 className="text-2xl font-bold mt-3">شكراً لك!</h1>
        <p className="text-sm text-muted-foreground mt-2">تم تسجيل قراراتك بنجاح. ستتواصل معك الورشة قريباً.</p>
      </div>
    </div>
  );

  const totalApproved = data.items
    .filter((i) => decisions[i.id] === "approved")
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="min-h-screen bg-background p-4" dir="rtl">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <ShieldCheck className="text-primary" size={28}/>
          <div>
            <h1 className="text-lg font-bold">طلب موافقة على أعمال إضافية</h1>
            <p className="text-xs text-muted-foreground">رقم أمر العمل: <span className="font-mono">{data.work_order.order_number}</span></p>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-4 grid md:grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <Car className="text-muted-foreground mt-0.5" size={16}/>
            <div>
              <div className="text-xs text-muted-foreground">المركبة</div>
              <div className="font-semibold">{data.vehicle.brand} {data.vehicle.model} {data.vehicle.year || ""}</div>
              <div className="font-mono text-xs">{data.vehicle.plate} • {data.vehicle.color || ""}</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="text-muted-foreground mt-0.5" size={16}/>
            <div>
              <div className="text-xs text-muted-foreground">العميل</div>
              <div className="font-semibold">{data.customer.name}</div>
              <div className="font-mono text-xs">{data.customer.phone}</div>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">البنود المطلوبة ({data.items.length})</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1 border-success/40 text-success" onClick={() => setAll("approved")}>
                <CheckCircle2 size={14}/> موافق على الكل
              </Button>
              <Button size="sm" variant="outline" className="gap-1 border-destructive/40 text-destructive" onClick={() => setAll("rejected")}>
                <XCircle size={14}/> رفض الكل
              </Button>
            </div>
          </div>

          {data.items.map((i) => {
            const isPending = i.status === "pending_customer";
            const d = decisions[i.id];
            return (
              <div key={i.id} className={`border rounded-lg p-3 ${d === "approved" ? "border-success/60 bg-success/5" : d === "rejected" ? "border-destructive/60 bg-destructive/5" : ""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{i.description}</div>
                    {i.notes && <div className="text-xs text-muted-foreground mt-1">{i.notes}</div>}
                    <div className="text-xs text-muted-foreground mt-1">
                      {i.quantity} × {Number(i.unit_price).toFixed(3)} ر.ع
                    </div>
                  </div>
                  <div className="text-lg font-bold text-primary">{i.total.toFixed(3)}</div>
                </div>
                {i.photos?.length > 0 && (
                  <div className="flex gap-1 mt-2 overflow-x-auto">
                    {i.photos.map((p, x) => (
                      <img key={x} src={p} alt="" className="h-20 w-20 object-cover rounded border flex-shrink-0"/>
                    ))}
                  </div>
                )}
                {isPending ? (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant={d === "approved" ? "default" : "outline"}
                      className={"flex-1 gap-1 " + (d === "approved" ? "bg-success hover:bg-success/90" : "border-success/40 text-success hover:bg-success/10")}
                      onClick={() => setDecisions((s) => ({ ...s, [i.id]: "approved" }))}>
                      <CheckCircle2 size={14}/> موافق
                    </Button>
                    <Button size="sm" variant={d === "rejected" ? "destructive" : "outline"}
                      className={"flex-1 gap-1 " + (d !== "rejected" ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "")}
                      onClick={() => setDecisions((s) => ({ ...s, [i.id]: "rejected" }))}>
                      <XCircle size={14}/> رفض
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-2">الحالة: {i.status}</div>
                )}
              </div>
            );
          })}

          <div className="border-t pt-3 text-left flex justify-between items-center">
            <span className="text-muted-foreground text-sm">المجموع المعتمد:</span>
            <span className="text-xl font-bold text-success">{totalApproved.toFixed(3)} ر.ع</span>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm">التوقيع</h2>
          <Input placeholder="اسمك الكامل" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">وقّع داخل المربع</span>
              <Button size="sm" variant="ghost" onClick={clearSig} className="gap-1 h-7"><Eraser size={12}/> مسح</Button>
            </div>
            <canvas
              ref={canvasRef}
              width={600} height={160}
              className="border-2 border-dashed rounded bg-white w-full touch-none"
              style={{ touchAction: "none" }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            بالضغط على "اعتماد" أنت توافق قانونياً على البنود المُؤشَّر عليها. سيُسجَّل عنوان IP الخاص بك ووقت الموافقة ونوع الجهاز كدليل قانوني.
          </p>
          <Button onClick={submit} disabled={submitting} className="w-full gap-2" size="lg">
            {submitting ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} اعتماد القرارات نهائياً
          </Button>
        </div>
      </div>
    </div>
  );
}
