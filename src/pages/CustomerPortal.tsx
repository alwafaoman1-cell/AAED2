import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Car, Calendar, ShieldAlert, Clock, CheckCircle2, Star,
  Camera, Sparkles, Wrench, ShieldCheck, Truck, Inbox, Search, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Tracking {
  order_number: string;
  entry_date: string | null;
  eta: string | null;
  progress_pct: number;
  stage: { key: string; label_ar: string; label_en: string; emoji: string };
  is_delivered: boolean;
  vehicle: { plate: string; brand: string; model: string; year: number; color: string };
  customer_name: string;
  pending_approvals: number;
  photos: Array<{ id: string; phase: string; url: string; caption?: string; uploaded_at?: string }>;
  feedback: { rating: number; comment: string | null; created_at: string } | null;
  workshop_name: string;
}

const STAGES = [
  { key: "received", ar: "الاستلام", en: "Received", icon: Inbox },
  { key: "inspection", ar: "الفحص", en: "Inspection", icon: Search },
  { key: "waiting_insurance", ar: "بانتظار التأمين", en: "Waiting Insurance", icon: Clock },
  { key: "insurance_approved", ar: "اعتماد التأمين", en: "Insurance Approved", icon: ShieldCheck },
  { key: "parts_in_transit", ar: "القطع في الطريق", en: "Parts in transit", icon: Truck },
  { key: "in_repair", ar: "جاري الإصلاح", en: "Under repair", icon: Wrench },
  { key: "quality", ar: "الجودة", en: "Quality", icon: ShieldCheck },
  { key: "delivered", ar: "تم التسليم", en: "Delivered", icon: CheckCircle2 },
];

const PHASE_LABEL: Record<string, { ar: string; en: string }> = {
  received: { ar: "قبل الإصلاح", en: "Before" },
  inspection: { ar: "الفحص", en: "Inspection" },
  in_progress: { ar: "أثناء الإصلاح", en: "During" },
  quality: { ar: "ضبط الجودة", en: "Quality" },
  delivery: { ar: "بعد الإصلاح", en: "After" },
};

function StarRow({ value, onSelect }: { value: number; onSelect?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 justify-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect?.(i)}
          disabled={!onSelect}
          className={`p-1 transition-transform ${onSelect ? "hover:scale-125" : ""}`}
        >
          <Star
            size={28}
            className={i <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}
          />
        </button>
      ))}
    </div>
  );
}

export default function CustomerPortal() {
  const { token } = useParams();
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function logPortalOpen(result: "opened" | "invalid" | "expired" | "network") {
    if (!token) return;
    try {
      await supabase.rpc("log_public_tracking_open" as any, {
        p_short_code: token,
        p_target_type: "customer_tracking",
        p_user_agent: navigator.userAgent || null,
        p_result: result,
      });
    } catch {
      // Tracking logs must never break the customer portal.
    }
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc("get_public_tracking" as any, { p_token: token });
    if (err) { setError("network"); setLoading(false); void logPortalOpen("network"); return; }
    const r: any = res;
    if (r?.error) {
      setError(r.error);
      setLoading(false);
      void logPortalOpen(r.error === "expired" ? "expired" : "invalid");
      return;
    }
    setData(r as Tracking);
    setError(null);
    setLoading(false);
    void logPortalOpen("opened");
  }

  useEffect(() => { load(); }, [token]);

  // Realtime: refresh when work order updates
  useEffect(() => {
    if (!data) return;
    const ch = supabase
      .channel(`portal-${token}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [data?.order_number]);

  const stagesView = useMemo(() => {
    if (!data) return [];
    const currentIdx = STAGES.findIndex((s) => s.key === data.stage.key);
    return STAGES.map((s, i) => ({
      ...s,
      done: i < currentIdx || data.is_delivered,
      active: i === currentIdx,
    }));
  }, [data]);

  const photosByPhase = useMemo(() => {
    const map: Record<string, Tracking["photos"]> = {};
    (data?.photos || []).forEach((p) => {
      const k = p.phase || "in_progress";
      (map[k] = map[k] || []).push(p);
    });
    return map;
  }, [data]);

  async function submitFeedback() {
    if (!token || rating < 1) { toast.error("اختر تقييماً"); return; }
    setSubmitting(true);
    const { error: err } = await supabase.rpc("submit_customer_feedback" as any, {
      p_token: token, p_rating: rating, p_comment: comment || null,
    });
    setSubmitting(false);
    if (err) { toast.error(err.message); return; }
    toast.success("شكراً لتقييمك! / Thank you for your feedback");
    load();
  }

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">رابط غير صالح</h1>
          <p className="text-sm text-muted-foreground">تأكد من الرابط المُرسَل لك. / Invalid or expired link.</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background pb-12">
      {/* Header */}
      <header className="bg-gradient-to-l from-primary/20 via-card to-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-foreground truncate">{data.workshop_name || "متابعة المركبة"}</h1>
              <p className="text-[10px] text-muted-foreground">Vehicle Repair Tracking</p>
            </div>
            <div className="text-left shrink-0">
              <p className="text-[10px] text-muted-foreground">رقم أمر العمل</p>
              <p className="font-mono text-primary font-bold text-sm">{data.order_number}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* Hero status card */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-card text-center">
          <div className="text-5xl mb-2" aria-hidden>{data.stage.emoji}</div>
          <h2 className="text-lg font-bold text-foreground">{data.stage.label_ar}</h2>
          <p className="text-[11px] text-muted-foreground mb-4">{data.stage.label_en}</p>

          {/* Smart progress bar */}
          <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 right-0 bg-gradient-to-l from-primary to-success transition-all duration-1000 rounded-full"
              style={{ width: `${data.progress_pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            نسبة الإنجاز / Progress: <span className="text-primary font-bold">{data.progress_pct}%</span>
          </p>

          {data.eta && !data.is_delivered && (
            <div className="mt-4 inline-flex items-center gap-2 bg-info/10 border border-info/30 rounded-lg px-3 py-2">
              <Calendar size={14} className="text-info" />
              <span className="text-xs text-foreground">
                موعد التسليم المتوقع / ETA: <span className="font-mono font-semibold">{data.eta}</span>
              </span>
            </div>
          )}
        </section>

        {/* Vehicle info */}
        <section className="bg-card border border-border rounded-xl p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3">
            <Car size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">المركبة / Vehicle</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">اللوحة:</span> <span className="font-mono text-foreground">{data.vehicle.plate}</span></div>
            <div><span className="text-muted-foreground">النوع:</span> <span className="text-foreground">{data.vehicle.brand} {data.vehicle.model}</span></div>
            <div><span className="text-muted-foreground">السنة:</span> <span className="text-foreground">{data.vehicle.year}</span></div>
            <div><span className="text-muted-foreground">اللون:</span> <span className="text-foreground">{data.vehicle.color || "—"}</span></div>
            {data.entry_date && (
              <div className="col-span-2"><span className="text-muted-foreground">دخول الورشة:</span> <span className="text-foreground font-mono">{data.entry_date}</span></div>
            )}
          </div>
        </section>

        {/* Pending approvals callout */}
        {data.pending_approvals > 0 && (
          <section className="bg-warning/10 border border-warning/40 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} className="text-warning" />
              <h3 className="text-sm font-bold text-foreground">
                {data.pending_approvals} طلب موافقة بانتظارك
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              تم اكتشاف أعمال إضافية مطلوبة على مركبتك. سيصلك رابط الموافقة برسالة واتساب منفصلة.
              <br />
              <span className="opacity-80">Additional work approval is required — you'll receive a separate WhatsApp link.</span>
            </p>
          </section>
        )}

        {/* Timeline */}
        <section className="bg-card border border-border rounded-xl p-4 shadow-card">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            مراحل الإصلاح / Repair Stages
          </h3>
          <div className="relative pr-7 space-y-2">
            <div className="absolute right-[14px] top-2 bottom-2 w-0.5 bg-border" />
            {stagesView.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.key} className="relative">
                  <div className={`absolute -right-[22px] top-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    s.done ? "bg-success border-success text-success-foreground" :
                    s.active ? "bg-primary border-primary text-primary-foreground animate-pulse" :
                    "bg-card border-border text-muted-foreground"
                  }`}>
                    {s.done ? <CheckCircle2 size={12} /> : <Icon size={11} />}
                  </div>
                  <div className={`rounded-lg p-2.5 border ${
                    s.active ? "bg-primary/5 border-primary/40" :
                    s.done ? "bg-success/5 border-success/20" :
                    "bg-secondary/20 border-border opacity-60"
                  }`}>
                    <div className="text-sm font-semibold text-foreground">{s.ar}</div>
                    <div className="text-[10px] text-muted-foreground">{s.en}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Photo gallery — before / during / after */}
        {data.photos.length > 0 && (
          <section className="bg-card border border-border rounded-xl p-4 shadow-card">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Camera size={16} className="text-primary" />
              صور المركبة / Photos
            </h3>
            <div className="space-y-4">
              {Object.entries(photosByPhase).map(([phase, items]) => (
                <div key={phase}>
                  <h4 className="text-xs font-semibold text-primary mb-2">
                    {PHASE_LABEL[phase]?.ar || phase} / {PHASE_LABEL[phase]?.en || phase}
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {items.map((p) => (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="aspect-square rounded-lg overflow-hidden border border-border bg-secondary/30">
                        <img src={p.url} alt={p.caption || ""} loading="lazy" className="w-full h-full object-cover hover:scale-110 transition-transform" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Feedback after delivery */}
        {data.is_delivered && (
          <section className="bg-card border border-border rounded-xl p-5 shadow-card">
            <h3 className="text-sm font-bold text-foreground mb-3 text-center flex items-center justify-center gap-2">
              <MessageSquare size={16} className="text-primary" />
              تقييم تجربتك / Rate your experience
            </h3>
            {data.feedback ? (
              <div className="text-center space-y-2">
                <StarRow value={data.feedback.rating} />
                {data.feedback.comment && (
                  <p className="text-sm text-muted-foreground italic">"{data.feedback.comment}"</p>
                )}
                <p className="text-[10px] text-success">شكراً لتقييمك / Thanks for your feedback</p>
              </div>
            ) : (
              <div className="space-y-3">
                <StarRow value={rating} onSelect={setRating} />
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="اكتب تعليقاً (اختياري) / Optional comment"
                  rows={3}
                  maxLength={500}
                />
                <Button onClick={submitFeedback} disabled={submitting || rating < 1} className="w-full">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "إرسال التقييم / Submit"}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Customer notes — pending approval */}
        <CustomerNotesBox token={token!} />

        {/* Privacy notice */}
        <div className="flex items-start gap-2 bg-info/5 border border-info/20 rounded-lg p-3">
          <ShieldAlert size={14} className="text-info shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            هذه الصفحة تعرض فقط حالة الإصلاح. لا تحتوي على أي معلومات مالية أو تفاصيل المطالبة التأمينية لحماية خصوصيتك.
            <br />
            <span className="opacity-80">This page shows only repair status. No financial or insurance claim details are displayed.</span>
          </p>
        </div>

        <footer className="text-center pt-2">
          <p className="text-[10px] text-muted-foreground">{data.workshop_name} — Customer Portal</p>
        </footer>
      </main>
    </div>
  );
}

function CustomerNotesBox({ token }: { token: string }) {
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (note.trim().length < 2) { toast.error("اكتب ملاحظتك أولاً"); return; }
    setSending(true);
    const { error } = await supabase.rpc("submit_portal_note" as any, {
      p_token: token,
      p_note: note.trim(),
      p_customer_name: name.trim() || null,
      p_ip: null,
      p_user_agent: navigator.userAgent,
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
    setNote("");
    toast.success("تم استلام ملاحظتك — قيد المراجعة من قبل الورشة");
  }

  return (
    <section className="bg-card border border-border rounded-xl p-4 shadow-card">
      <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <MessageSquare size={16} className="text-primary" />
        أرسل ملاحظة للورشة / Send a note
      </h3>
      {sent ? (
        <div className="text-xs bg-success/10 border border-success/30 rounded-lg p-3 text-center">
          ✅ تم استلام ملاحظتك. سيتم مراجعتها من قبل المشرف.
          <br/>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSent(false)}>إرسال ملاحظة أخرى</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسمك (اختياري)"
            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
            maxLength={80}
          />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="اكتب ملاحظتك هنا..."
            rows={3}
            maxLength={2000}
          />
          <Button onClick={send} disabled={sending || note.trim().length < 2} className="w-full">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "إرسال الملاحظة"}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            ⏳ ملاحظتك ستظهر للورشة بعد الاعتماد. لا يمكن تعديلها أو حذفها بعد الإرسال.
          </p>
        </div>
      )}
    </section>
  );
}
