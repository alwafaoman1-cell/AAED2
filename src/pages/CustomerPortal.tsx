import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  Camera,
  Car,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  FileText,
  Image as ImageIcon,
  Inbox,
  Loader2,
  MessageCircle,
  MessageSquare,
  Phone,
  Receipt,
  Route,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  formatCurrencyEnglish,
  formatDateEnglish,
  formatDateTimeEnglish,
  formatNumberEnglish,
  toEnglishDigits,
} from "@/lib/formatters/numberFormat";

type PortalStageKey =
  | "received"
  | "inspection"
  | "waiting_insurance"
  | "insurance_approved"
  | "parts_in_transit"
  | "in_repair"
  | "quality"
  | "ready"
  | "delivered";

interface PortalStage {
  key: PortalStageKey | string;
  label_ar: string;
  label_en: string;
  emoji?: string;
  updated_at?: string | null;
  note?: string | null;
}

interface PortalPhoto {
  id: string;
  phase: string;
  url: string;
  caption?: string | null;
  uploaded_at?: string | null;
}

interface PortalSupplement {
  id: string;
  description: string;
  reason?: string | null;
  notes?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  vat?: number | null;
  total?: number | null;
  status: string;
  sent_at?: string | null;
  decided_at?: string | null;
  approval_token?: string | null;
  photos?: Array<{ url?: string; caption?: string }>;
}

interface PortalInvoice {
  id?: string;
  number: string;
  date?: string | null;
  subtotal: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
  status: string;
  pdf_url?: string | null;
  qr_link?: string | null;
  visible?: boolean;
}

interface PortalPayment {
  number: string;
  date?: string | null;
  amount: number;
  method?: string | null;
  reference?: string | null;
}

interface PortalPart {
  id?: string;
  name: string;
  status?: string | null;
  type?: string | null;
  quantity?: number | null;
  image_url?: string | null;
  note?: string | null;
}

interface PortalDocument {
  id?: string;
  title: string;
  category?: string | null;
  url: string;
  type?: "image" | "pdf" | "file" | string;
  uploaded_at?: string | null;
}

interface Tracking {
  order_number: string;
  entry_date: string | null;
  eta: string | null;
  progress_pct: number;
  stage: PortalStage;
  stages?: PortalStage[];
  is_delivered: boolean;
  vehicle: {
    plate: string;
    brand: string;
    model: string;
    year: number | string | null;
    color: string | null;
    vin?: string | null;
  };
  customer_name: string;
  customer_phone?: string | null;
  workshop_name: string;
  workshop_phone?: string | null;
  whatsapp_phone?: string | null;
  work_order?: {
    type?: string | null;
    status?: string | null;
    description?: string | null;
    expected_delivery?: string | null;
  };
  pending_approvals: number;
  supplements?: PortalSupplement[];
  invoices?: PortalInvoice[];
  payments?: PortalPayment[];
  replaced_parts?: PortalPart[];
  photos: PortalPhoto[];
  documents?: PortalDocument[];
  messages?: Array<{ id?: string; message: string; created_at?: string | null; source?: string | null }>;
  feedback: { rating: number; comment: string | null; created_at: string } | null;
}

const BASE_STAGES: Array<{ key: PortalStageKey; ar: string; en: string; icon: typeof Inbox }> = [
  { key: "received", ar: "استلام المركبة", en: "Vehicle received", icon: Inbox },
  { key: "inspection", ar: "الفحص والتقدير", en: "Inspection & estimate", icon: ShieldCheck },
  { key: "waiting_insurance", ar: "بانتظار الموافقة", en: "Waiting approval", icon: Clock },
  { key: "in_repair", ar: "تحت الإصلاح", en: "Under repair", icon: Wrench },
  { key: "quality", ar: "الفحص النهائي", en: "Final check", icon: ShieldCheck },
  { key: "ready", ar: "جاهزة للتسليم", en: "Ready for delivery", icon: Car },
  { key: "delivered", ar: "تم التسليم", en: "Delivered", icon: CheckCircle2 },
];

const PHASE_LABEL: Record<string, string> = {
  received: "صور الاستلام",
  inspection: "صور الفحص",
  in_progress: "أثناء الإصلاح",
  in_repair: "أثناء الإصلاح",
  quality: "فحص الجودة",
  delivery: "صور التسليم",
  after: "بعد الإصلاح",
};

function money(value: unknown) {
  return formatCurrencyEnglish(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, "OMR");
}

function safeText(value: unknown, fallback = "—") {
  const text = toEnglishDigits(value ?? "").trim();
  return text || fallback;
}

function statusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (["approved", "signed"].includes(s)) return "تمت الموافقة";
  if (["rejected", "declined"].includes(s)) return "مرفوض";
  if (["paid"].includes(s)) return "مدفوعة";
  if (["partial", "partially_paid"].includes(s)) return "مدفوعة جزئيًا";
  if (["sent", "pending", "pending_customer"].includes(s)) return "بانتظار الموافقة";
  if (["delivered"].includes(s)) return "تم التسليم";
  return status || "غير محدد";
}

function statusTone(status: string) {
  const s = String(status || "").toLowerCase();
  if (["approved", "signed", "paid", "delivered", "completed"].includes(s)) return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
  if (["rejected", "declined", "failed", "overdue"].includes(s)) return "bg-red-500/10 text-red-700 border-red-500/30";
  return "bg-amber-500/10 text-amber-700 border-amber-500/30";
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: typeof Car;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right"
      >
        <span className="flex items-center gap-2 font-bold text-foreground">
          <Icon size={17} className="text-primary" />
          {title}
        </span>
        <ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

function StarRow({ value, onSelect }: { value: number; onSelect?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 justify-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onSelect?.(i)} disabled={!onSelect} className={onSelect ? "p-1 hover:scale-110 transition-transform" : "p-1"}>
          <Star size={25} className={i <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"} />
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
  const loggedOpenRef = useRef(false);

  async function logPortalOpen(result: "success" | "invalid" | "expired" | "network") {
    if (!token || loggedOpenRef.current) return;
    loggedOpenRef.current = true;
    try {
      await supabase.rpc("log_public_tracking_open" as any, {
        p_short_code: token,
        p_target_type: "customer_tracking",
        p_user_agent: navigator.userAgent || null,
        p_result: result,
      });
    } catch {
      // Public tracking must never break the customer portal.
    }
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc("get_public_tracking" as any, { p_token: token });
    if (err) {
      setError("network");
      setLoading(false);
      void logPortalOpen("network");
      return;
    }
    const r: any = res;
    if (r?.error) {
      setError(r.error);
      setLoading(false);
      void logPortalOpen(r.error === "expired" ? "expired" : "invalid");
      return;
    }
    setData({
      ...r,
      photos: Array.isArray(r?.photos) ? r.photos : [],
      supplements: Array.isArray(r?.supplements) ? r.supplements : [],
      invoices: Array.isArray(r?.invoices) ? r.invoices : [],
      payments: Array.isArray(r?.payments) ? r.payments : [],
      replaced_parts: Array.isArray(r?.replaced_parts) ? r.replaced_parts : [],
      documents: Array.isArray(r?.documents) ? r.documents : [],
      messages: Array.isArray(r?.messages) ? r.messages : [],
    } as Tracking);
    setError(null);
    setLoading(false);
    void logPortalOpen("success");
  }

  useEffect(() => {
    loggedOpenRef.current = false;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!data) return;
    const ch = supabase
      .channel(`portal-${token}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, () => {
        const alreadyLogged = loggedOpenRef.current;
        void load().finally(() => {
          loggedOpenRef.current = alreadyLogged;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.order_number, token]);

  const stagesView = useMemo(() => {
    if (!data) return [];
    const currentKey = data.stage.key === "insurance_approved" ? "waiting_insurance" : data.stage.key;
    const currentIdx = BASE_STAGES.findIndex((s) => s.key === currentKey);
    return BASE_STAGES.map((s, i) => ({
      ...s,
      done: data.is_delivered || (currentIdx >= 0 && i < currentIdx),
      active: !data.is_delivered && i === currentIdx,
      extra: data.stages?.find((x) => x.key === s.key),
    }));
  }, [data]);

  const photosByPhase = useMemo(() => {
    const map: Record<string, PortalPhoto[]> = {};
    (data?.photos || []).forEach((p) => {
      const k = p.phase || "in_progress";
      (map[k] = map[k] || []).push(p);
    });
    return map;
  }, [data]);

  const invoice = data?.invoices?.find((x) => x.visible !== false) || data?.invoices?.[0] || null;
  const remaining = invoice ? Math.max(0, Number(invoice.balance || 0)) : 0;
  const whatsApp = data?.whatsapp_phone || data?.customer_phone;

  async function submitFeedback() {
    if (!token || rating < 1) {
      toast.error("اختر تقييماً");
      return;
    }
    setSubmitting(true);
    const { error: err } = await supabase.rpc("submit_customer_feedback" as any, {
      p_token: token,
      p_rating: rating,
      p_comment: comment || null,
    });
    setSubmitting(false);
    if (err) {
      toast.error(err.message);
      return;
    }
    toast.success("شكراً لتقييمك");
    void load();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    const isExpired = error === "expired" || error === "revoked";
    return (
      <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md text-center shadow-card">
          <AlertCircle className="w-10 h-10 text-warning mx-auto mb-3" />
          <h1 className="text-xl font-bold text-foreground mb-2">
            {isExpired ? "انتهت صلاحية الرابط" : "الرابط غير صالح أو منتهي"}
          </h1>
          <p className="text-sm text-muted-foreground">
            يرجى التواصل مع الورشة للحصول على رابط متابعة جديد.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">بوابة العميل</p>
              <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate">
                {safeText(data.workshop_name, "متابعة إصلاح المركبة")}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                آخر تحديث: {formatDateTimeEnglish(data.stage.updated_at || data.entry_date || new Date().toISOString())}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {whatsApp && (
                <a
                  href={`https://wa.me/${String(whatsApp).replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  aria-label="WhatsApp"
                >
                  <MessageCircle size={18} />
                </a>
              )}
              {data.customer_phone && (
                <a
                  href={`tel:${data.customer_phone}`}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary"
                  aria-label="Call"
                >
                  <Phone size={18} />
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <section className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-card">
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl">
                  {data.stage.emoji || "🚗"}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">{data.stage.label_ar}</h2>
                  <p className="text-sm text-muted-foreground">{data.stage.label_en}</p>
                </div>
              </div>
              <div>
                <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 right-0 bg-gradient-to-l from-primary to-emerald-500 transition-all duration-700 rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, Number(data.progress_pct || 0)))}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  نسبة الإنجاز: <span className="font-bold text-primary">{formatNumberEnglish(data.progress_pct, { maximumFractionDigits: 0 })}%</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <InfoTile label="رقم أمر العمل" value={data.order_number} />
              <InfoTile label="رقم اللوحة" value={data.vehicle.plate} />
              <InfoTile label="المركبة" value={`${data.vehicle.brand || ""} ${data.vehicle.model || ""}`} />
              <InfoTile label="العميل" value={data.customer_name} />
              <InfoTile label="تاريخ الدخول" value={formatDateEnglish(data.entry_date)} />
              <InfoTile label="موعد التسليم" value={formatDateEnglish(data.eta)} />
            </div>
          </div>
        </section>

        <Section title="مراحل إصلاح السيارة" icon={Route}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stagesView.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={`rounded-2xl border p-3 ${
                    s.done
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : s.active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border bg-secondary/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-8 w-8 rounded-xl flex items-center justify-center ${s.done ? "bg-emerald-500 text-white" : s.active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}>
                      {s.done ? <CheckCircle2 size={15} /> : <Icon size={15} />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{s.ar}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{s.en}</p>
                    </div>
                  </div>
                  {s.extra?.updated_at && <p className="text-[10px] text-muted-foreground mt-2">{formatDateTimeEnglish(s.extra.updated_at)}</p>}
                  {s.extra?.note && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{s.extra.note}</p>}
                </div>
              );
            })}
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <Section title="أمر العمل" icon={FileText}>
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <InfoLine label="رقم الأمر" value={data.order_number} />
                <InfoLine label="نوع العمل" value={data.work_order?.type || "غير محدد"} />
                <InfoLine label="الحالة الحالية" value={data.work_order?.status || data.stage.label_ar} />
                <InfoLine label="تاريخ الدخول" value={formatDateEnglish(data.entry_date)} />
                <InfoLine label="التسليم المتوقع" value={formatDateEnglish(data.work_order?.expected_delivery || data.eta)} />
                <InfoLine label="VIN" value={data.vehicle.vin || "غير معروض"} />
              </div>
              {data.work_order?.description && (
                <div className="mt-3 rounded-xl bg-secondary/30 p-3 text-sm text-foreground">
                  {toEnglishDigits(data.work_order.description)}
                </div>
              )}
            </Section>

            <Section title="الأعمال الإضافية التي تحتاج موافقة" icon={Sparkles}>
              {data.supplements?.length ? (
                <div className="space-y-3">
                  {data.supplements.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-foreground">{safeText(item.description, "عمل إضافي")}</h4>
                          {item.reason || item.notes ? <p className="text-xs text-muted-foreground mt-1">{safeText(item.reason || item.notes)}</p> : null}
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[11px] ${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <InfoTile label="قبل الضريبة" value={money(Number(item.quantity || 1) * Number(item.unit_price || 0))} />
                        <InfoTile label="VAT 5%" value={money(item.vat ?? Number(item.quantity || 1) * Number(item.unit_price || 0) * 0.05)} />
                        <InfoTile label="الإجمالي" value={money(item.total ?? Number(item.quantity || 1) * Number(item.unit_price || 0) * 1.05)} />
                      </div>
                      {String(item.status).toLowerCase().includes("pending") && item.approval_token && (
                        <Link
                          to={`/c/approve/${encodeURIComponent(item.approval_token)}`}
                          className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                        >
                          مراجعة واعتماد العمل الإضافي
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="لا توجد أعمال إضافية بانتظار موافقة العميل." />
              )}
            </Section>

            <Section title="القطع المستبدلة" icon={Wrench} defaultOpen={false}>
              {data.replaced_parts?.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.replaced_parts.map((part, index) => (
                    <div key={part.id || index} className="rounded-xl border border-border bg-background/60 p-3">
                      <div className="flex gap-3">
                        {part.image_url ? (
                          <img src={part.image_url} alt="" className="h-14 w-14 rounded-xl object-cover border border-border" />
                        ) : (
                          <div className="h-14 w-14 rounded-xl bg-secondary/40 flex items-center justify-center text-muted-foreground">
                            <Wrench size={18} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">{safeText(part.name, "قطعة")}</p>
                          <p className="text-xs text-muted-foreground">{safeText(part.status, "تم الاستبدال")} · {safeText(part.type, "غير محدد")}</p>
                          <p className="text-xs text-muted-foreground">الكمية: {formatNumberEnglish(part.quantity || 1)}</p>
                        </div>
                      </div>
                      {part.note && <p className="text-xs text-muted-foreground mt-2">{toEnglishDigits(part.note)}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="لا توجد قطع مستبدلة معروضة للعميل." />
              )}
            </Section>

            <Section title="الصور والمستندات" icon={ImageIcon}>
              {data.photos.length || data.documents?.length ? (
                <div className="space-y-4">
                  {Object.entries(photosByPhase).map(([phase, items]) => (
                    <div key={phase}>
                      <h4 className="text-xs font-bold text-primary mb-2">{PHASE_LABEL[phase] || phase}</h4>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {items.map((p) => (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="aspect-square rounded-xl overflow-hidden border border-border bg-secondary/30">
                            <img src={p.url} alt={p.caption || ""} loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                  {data.documents?.length ? (
                    <div className="grid gap-2">
                      {data.documents.map((doc, index) => (
                        <a key={doc.id || index} href={doc.url} target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-background/60 p-3 flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <FileText size={15} className="text-primary" />
                            {safeText(doc.title, "مستند")}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{formatDateEnglish(doc.uploaded_at)}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="لا توجد صور أو مستندات مسموحة للعرض حاليًا." />
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <Section title="الفواتير والمدفوعات" icon={Receipt}>
              {invoice ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-background/60 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold text-foreground">{invoice.number}</p>
                      <span className={`rounded-full border px-2 py-1 text-[11px] ${statusTone(invoice.status)}`}>{statusLabel(invoice.status)}</span>
                    </div>
                    <InfoLine label="قبل الضريبة" value={money(invoice.subtotal)} />
                    <InfoLine label="VAT 5%" value={money(invoice.vat)} />
                    <InfoLine label="الإجمالي" value={money(invoice.total)} strong />
                    <InfoLine label="المدفوع" value={money(invoice.paid)} />
                    <InfoLine label="المتبقي" value={money(remaining)} strong={remaining > 0} />
                    {invoice.pdf_url && (
                      <a href={invoice.pdf_url} target="_blank" rel="noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary/40">
                        <FileText size={14} />
                        عرض الفاتورة PDF
                      </a>
                    )}
                  </div>
                  {data.payments?.length ? (
                    <div className="space-y-2">
                      {data.payments.map((payment, index) => (
                        <div key={payment.number || index} className="rounded-lg bg-secondary/30 p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground">{payment.number}</span>
                            <span className="font-mono text-emerald-600">{money(payment.amount)}</span>
                          </div>
                          <p className="text-muted-foreground">{formatDateEnglish(payment.date)} · {safeText(payment.method, "طريقة دفع")}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState text="لا توجد فاتورة عميل معروضة حاليًا." />
              )}
            </Section>

            <CustomerNotesBox token={token!} />

            <Section title="الرسائل والملاحظات" icon={MessageSquare} defaultOpen={false}>
              {data.messages?.length ? (
                <div className="space-y-2">
                  {data.messages.map((msg, index) => (
                    <div key={msg.id || index} className="rounded-xl bg-secondary/30 p-3 text-sm">
                      <p className="text-foreground">{toEnglishDigits(msg.message)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatDateTimeEnglish(msg.created_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="لا توجد رسائل معروضة بعد." />
              )}
            </Section>

            {data.is_delivered && (
              <Section title="تقييم التجربة" icon={Star}>
                {data.feedback ? (
                  <div className="text-center space-y-2">
                    <StarRow value={data.feedback.rating} />
                    {data.feedback.comment && <p className="text-sm text-muted-foreground italic">"{data.feedback.comment}"</p>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <StarRow value={rating} onSelect={setRating} />
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="اكتب تعليقاً اختيارياً" rows={3} maxLength={500} />
                    <Button onClick={submitFeedback} disabled={submitting || rating < 1} className="w-full">
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "إرسال التقييم"}
                    </Button>
                  </div>
                )}
              </Section>
            )}

            <div className="rounded-2xl border border-info/20 bg-info/5 p-3 flex items-start gap-2">
              <ShieldAlert size={15} className="text-info shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                هذه بوابة عميل آمنة. لا تعرض UUID أو بيانات داخلية أو مصروفات الورشة أو أرباحها.
              </p>
            </div>
          </div>
        </div>

        <footer className="text-center pt-3">
          <p className="text-[10px] text-muted-foreground">{safeText(data.workshop_name)} — Customer Portal</p>
        </footer>
      </main>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3 min-w-0">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      <p className="font-semibold text-foreground truncate" dir="auto">{safeText(value)}</p>
    </div>
  );
}

function InfoLine({ label, value, strong }: { label: string; value: unknown; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${strong ? "font-bold text-primary" : "font-medium text-foreground"} text-left`} dir="auto">
        {safeText(value)}
      </span>
    </div>
  );
}

function CustomerNotesBox({ token }: { token: string }) {
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (note.trim().length < 2) {
      toast.error("اكتب ملاحظتك أولاً");
      return;
    }
    setSending(true);
    const { error } = await supabase.rpc("submit_portal_note" as any, {
      p_token: token,
      p_note: note.trim(),
      p_customer_name: name.trim() || null,
      p_ip: null,
      p_user_agent: navigator.userAgent,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    setNote("");
    toast.success("تم استلام ملاحظتك");
  }

  return (
    <Section title="إرسال ملاحظة للورشة" icon={Send}>
      {sent ? (
        <div className="text-xs bg-success/10 border border-success/30 rounded-xl p-3 text-center">
          تم استلام ملاحظتك وستظهر للورشة للمراجعة.
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSent(false)}>
            إرسال ملاحظة أخرى
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسمك (اختياري)"
            className="w-full text-sm bg-background border border-border rounded-xl px-3 py-2"
            maxLength={80}
          />
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="اكتب ملاحظتك هنا..." rows={3} maxLength={2000} />
          <Button onClick={send} disabled={sending || note.trim().length < 2} className="w-full">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "إرسال الملاحظة"}
          </Button>
        </div>
      )}
    </Section>
  );
}
