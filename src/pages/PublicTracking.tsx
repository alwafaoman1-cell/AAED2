import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { CheckCircle2, Clock, Wrench, ShieldCheck, PackageCheck, Car, Calendar, ShieldAlert, Lock, KeyRound, Loader2 } from "lucide-react";
import { getWorkOrderById, STAGE_LABELS, StagePhase } from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getMasterPasswordNormalized } from "@/lib/publicAccessSettingsStore";

/** Public-safe shape — minimal fields returned by RPC OR derived from local store */
interface PublicWO {
  id: string;
  orderNumber?: string;
  status: string;
  entryDate: string;
  customer?: string;
  technician?: string;
  vehicleType?: string;
  model?: string;
  year?: string;
  plate?: string;
  color?: string;
  photos?: Array<{ id: string; phase: StagePhase; dataUrl: string; caption?: string }>;
}

const mask = (v?: string, keepStart = 2, keepEnd = 2): string => {
  if (!v) return "—";
  const s = String(v).trim();
  if (s.length <= keepStart + keepEnd) return "•".repeat(Math.max(3, s.length));
  return s.slice(0, keepStart) + "•".repeat(Math.max(3, s.length - keepStart - keepEnd)) + s.slice(-keepEnd);
};

const normalize = (v: string): string => {
  const s = (v || "").trim();
  if (/[\d\s+()-]+/.test(s) && /\d/.test(s)) return s.replace(/\D/g, "");
  return s.toLowerCase();
};

const STAGE_FLOW: { key: StagePhase; icon: any }[] = [
  { key: "received", icon: Car },
  { key: "inspection", icon: Clock },
  { key: "in_progress", icon: Wrench },
  { key: "quality", icon: ShieldCheck },
  { key: "delivery", icon: PackageCheck },
];

function statusToPhase(status: string): StagePhase {
  if (!status) return "in_progress";
  if (status.includes("استلام") || status.includes("received")) return "received";
  if (status.includes("فحص") || status.includes("inspection")) return "inspection";
  if (status.includes("جودة") || status.includes("quality")) return "quality";
  if (status.includes("جاهز") || status.includes("تسليم") || status.includes("delivered") || status.includes("ready")) return "delivery";
  return "in_progress";
}

const sessionKey = (id: string) => `wo_track_auth_${id}`;

async function fetchPublicWO(key: string, password?: string): Promise<{ wo: PublicWO | null; requiresPassword: boolean; notFound: boolean }> {
  // Try local store first (owner/admin viewing on same device)
  const local = getWorkOrderById(key);
  if (local) {
    return {
      wo: {
        id: local.id,
        orderNumber: local.id,
        status: local.status,
        entryDate: local.entryDate,
        customer: local.customer,
        technician: local.technician,
        vehicleType: local.vehicleType,
        model: local.model,
        year: local.year,
        plate: local.plate,
        color: local.color,
        photos: local.photos,
      },
      requiresPassword: false,
      notFound: false,
    };
  }

  // Fallback to Supabase RPC for public scans
  const { data, error } = await supabase.rpc("get_public_work_order" as any, {
    p_key: key,
    p_password: password ?? null,
  });
  if (error) {
    console.warn("[PublicTracking] RPC error:", error.message);
    return { wo: null, requiresPassword: false, notFound: true };
  }
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row) return { wo: null, requiresPassword: false, notFound: true };

  // Status fields are null when password is required but not provided/correct
  if (!row.status) {
    return { wo: null, requiresPassword: !!row.requires_password, notFound: false };
  }

  return {
    wo: {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      entryDate: row.entry_date || (row.created_at ? String(row.created_at).slice(0, 10) : ""),
      customer: row.customer_name,
      vehicleType: row.vehicle_brand,
      model: row.vehicle_model,
      year: row.vehicle_year ? String(row.vehicle_year) : "",
      plate: row.vehicle_plate,
      color: row.vehicle_color,
    },
    requiresPassword: !!row.requires_password,
    notFound: false,
  };
}

export default function PublicTracking() {
  const { id } = useParams();
  const [wo, setWo] = useState<PublicWO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pwd, setPwd] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      setLoading(true);
      const cached = sessionStorage.getItem(sessionKey(id));
      const res = await fetchPublicWO(id, cached || undefined);
      if (cancelled) return;
      setWo(res.wo);
      setRequiresPassword(res.requiresPassword);
      setNotFound(res.notFound);
      if (res.wo && !res.requiresPassword) setAuthed(true);
      if (res.wo && cached) setAuthed(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function submitPwd(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const entered = normalize(pwd);
    const master = getMasterPasswordNormalized();
    // Master password short-circuit (still requires data)
    if (master && entered === master) {
      const res = await fetchPublicWO(id, ""); // master allows; but server enforces; try without
      // If server still gated, we accept locally as master is system-wide
      if (res.wo) {
        setWo(res.wo);
        setAuthed(true);
        try { sessionStorage.setItem(sessionKey(id), entered); } catch {}
        return;
      }
    }
    const res = await fetchPublicWO(id, entered);
    if (res.notFound) {
      setNotFound(true);
      return;
    }
    if (!res.wo) {
      toast.error("كلمة المرور غير صحيحة");
      return;
    }
    setWo(res.wo);
    setAuthed(true);
    try { sessionStorage.setItem(sessionKey(id), entered); } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">أمر العمل غير موجود</h1>
          <p className="text-sm text-muted-foreground">تأكد من صحة الرابط أو الرمز / Work Order Not Found</p>
        </div>
      </div>
    );
  }

  if (!authed || !wo) {
    return (
      <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-7 max-w-sm w-full shadow-card">
          <div className="text-center mb-5">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-3">
              <Lock size={22} className="text-primary" />
            </div>
            <h1 className="text-lg font-bold text-foreground">صفحة محمية</h1>
            <p className="text-xs text-muted-foreground mt-1">
              لمتابعة الطلب أدخل كلمة المرور (رقم هاتف العميل المسجّل افتراضياً).
            </p>
          </div>
          <form onSubmit={submitPwd} className="space-y-3">
            <div className="relative">
              <KeyRound size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="كلمة المرور / رقم هاتف العميل"
                className="pr-9"
                autoFocus
                inputMode="text"
              />
            </div>
            <Button type="submit" className="w-full gradient-gold text-primary-foreground">دخول</Button>
          </form>
          <p className="text-[10px] text-muted-foreground text-center mt-4">
            شركة الوفاء للأعمال — Alwafa Integrated Services
          </p>
        </div>
      </div>
    );
  }

  const currentPhase = statusToPhase(wo.status);
  const currentIdx = STAGE_FLOW.findIndex((s) => s.key === currentPhase);
  const photosByPhase = (wo.photos || []).reduce<Record<StagePhase, NonNullable<PublicWO["photos"]>>>((acc, p) => {
    if (!acc[p.phase]) acc[p.phase] = [];
    acc[p.phase]!.push(p);
    return acc;
  }, { received: [], inspection: [], in_progress: [], quality: [], delivery: [] });

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="bg-gradient-to-l from-primary/20 via-card to-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">شركة الوفاء للأعمال</h1>
              <p className="text-xs text-muted-foreground">Alwafa Integrated Services — Vehicle Tracking</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">رقم أمر العمل</p>
              <p className="font-mono text-primary font-bold">{wo.orderNumber || wo.id}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <section className="bg-card border border-border rounded-xl p-5 shadow-card">
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-foreground"><Car size={16} className="text-primary" /><span className="font-bold">{wo.vehicleType} {wo.model} {wo.year}</span></div>
              <div className="text-muted-foreground">رقم اللوحة: <span className="text-foreground font-mono">{wo.plate}</span></div>
              <div className="text-muted-foreground">اللون / Color: <span className="text-foreground">{wo.color || '-'}</span></div>
            </div>
            <div className="space-y-2">
              <div className="text-muted-foreground">العميل / Customer: <span className="text-foreground font-medium">{mask(wo.customer, 2, 1)}</span></div>
              <div className="flex items-center gap-2 text-muted-foreground"><Calendar size={14} /><span className="text-foreground">دخول / In: {wo.entryDate}</span></div>
              {wo.technician && (
                <div className="text-muted-foreground">الفني / Technician: <span className="text-foreground">{mask(wo.technician, 2, 1)}</span></div>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 bg-info/5 border border-info/20 rounded-lg p-2">
            <ShieldAlert size={14} className="text-info shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              لحماية خصوصية العميل، تم إخفاء بعض البيانات الحساسة (الهاتف، VIN، التفاصيل المالية).
              <br />
              <span className="text-[9px]">For privacy, sensitive data (phone, VIN, financials) is hidden in the public view.</span>
            </p>
          </div>
        </section>

        <section className="bg-card border border-border rounded-xl p-5 shadow-card">
          <h2 className="text-sm font-bold text-foreground mb-4">مراحل الإصلاح / Repair Timeline</h2>
          <div className="relative flex items-start justify-between gap-2">
            <div className="absolute top-5 right-5 left-5 h-0.5 bg-border" />
            <div className="absolute top-5 right-5 h-0.5 bg-primary transition-all" style={{ width: `calc(${(currentIdx / (STAGE_FLOW.length - 1)) * 100}% - 2.5rem)` }} />
            {STAGE_FLOW.map((stage, idx) => {
              const Icon = stage.icon;
              const done = idx < currentIdx;
              const active = idx === currentIdx;
              return (
                <div key={stage.key} className="relative z-10 flex flex-col items-center gap-2 flex-1">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${done ? "bg-success border-success text-success-foreground" : active ? "bg-primary border-primary text-primary-foreground animate-pulse" : "bg-card border-border text-muted-foreground"}`}>
                    {done ? <CheckCircle2 size={18} /> : <Icon size={16} />}
                  </div>
                  <div className="text-center">
                    <p className={`text-[11px] font-medium ${active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>{STAGE_LABELS[stage.key].ar}</p>
                    <p className="text-[9px] text-muted-foreground">{STAGE_LABELS[stage.key].en}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 text-center bg-primary/10 border border-primary/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">الحالة الحالية / Current Status</p>
            <p className="text-base font-bold text-primary">{wo.status}</p>
          </div>
        </section>

        {(wo.photos || []).length > 0 && (
          <section className="bg-card border border-border rounded-xl p-5 shadow-card">
            <h2 className="text-sm font-bold text-foreground mb-4">معرض الصور / Photo Gallery</h2>
            <div className="space-y-4">
              {STAGE_FLOW.map((s) => {
                const photos = photosByPhase[s.key] || [];
                if (photos.length === 0) return null;
                return (
                  <div key={s.key}>
                    <h3 className="text-xs font-semibold text-primary mb-2">{STAGE_LABELS[s.key].ar} / {STAGE_LABELS[s.key].en}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {photos.map((p) => (
                        <div key={p.id} className="aspect-square rounded-lg overflow-hidden border border-border bg-secondary/30">
                          <img src={p.dataUrl} alt={p.caption || ""} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <footer className="text-center pt-4 pb-8">
          <Link to="/" className="text-xs text-muted-foreground hover:text-primary">شركة الوفاء للأعمال — جميع الحقوق محفوظة</Link>
        </footer>
      </main>
    </div>
  );
}
