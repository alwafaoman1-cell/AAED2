// Detailed archive card extension: shows related work orders, insurance claims,
// and any uploaded/generated claim documents tied to the vehicle's plate.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, FolderOpen, ShieldCheck, Wrench, Download, ExternalLink, ChevronDown, ChevronUp, Camera } from "lucide-react";
import { getWorkOrders, subscribeWorkOrders, STAGE_LABELS, type StagePhase } from "@/lib/workOrdersStore";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { refreshSignedUrls } from "@/lib/refreshSignedUrls";
import { formatMoney } from "@/lib/pdfGenerator";
import PhotoLightbox, { type LightboxPhoto } from "@/components/vehicles/PhotoLightbox";

interface ClaimRow {
  id: string;
  claim_number: string;
  insurance_company: string | null;
  status: string;
  estimated_amount: number | null;
  approved_amount: number | null;
  paid_at: string | null;
  created_at: string;
  incident_date: string | null;
  vehicle_plate: string | null;
}

interface DocRow {
  id: string;
  claim_id: string;
  category: string;
  file_path: string;
  file_name: string;
  url: string;
  created_at: string;
}

interface Props {
  plate: string;
}

const normPlate = (p: string) => (p || "").trim().toLowerCase().replace(/\s+/g, " ");

export default function ArchivedVehicleDetails({ plate }: Props) {
  const [orders, setOrders] = useState(getWorkOrders());
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbStart, setLbStart] = useState(0);

  useEffect(() => subscribeWorkOrders(() => setOrders(getWorkOrders())), []);

  // Work orders linked to this plate
  const related = useMemo(() => {
    const np = normPlate(plate);
    return orders.filter((o) => normPlate(o.plate) === np);
  }, [orders, plate]);

  const stats = useMemo(() => {
    const visits = related.length;
    const total = related.reduce((s, o) => s + (Number(o.totalCost) || 0), 0);
    const last = related.map((o) => o.entryDate).filter(Boolean).sort().slice(-1)[0] || "—";
    return { visits, total, last };
  }, [related]);

  // Aggregate stage photos from ALL related work orders
  const stagePhotos = useMemo<LightboxPhoto[]>(() => {
    const all: LightboxPhoto[] = [];
    for (const o of related) {
      for (const p of (o.photos || [])) {
        all.push({
          id: p.id,
          dataUrl: p.dataUrl,
          caption: p.caption,
          phase: p.phase,
          phaseLabel: STAGE_LABELS[p.phase as StagePhase]?.ar || p.phase,
          orderId: o.id,
          date: o.entryDate,
        });
      }
    }
    return all;
  }, [related]);

  // Fetch claims + documents for this plate
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const tid = await getCurrentTenantId();
        if (!tid) return;
        const { data: cs } = await supabase
          .from("insurance_claims")
          .select("id, claim_number, insurance_company, status, estimated_amount, approved_amount, paid_at, created_at, incident_date, vehicle_plate")
          .eq("tenant_id", tid)
          .ilike("vehicle_plate", plate)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        const claimsList = (cs || []) as ClaimRow[];
        setClaims(claimsList);

        if (claimsList.length === 0) {
          setDocs([]);
          return;
        }
        const ids = claimsList.map((c) => c.id);
        const { data: ds } = await supabase
          .from("claim_audit_logs")
          .select("id, claim_id, category, file_path, details, created_at")
          .in("claim_id", ids)
          .eq("action", "document_generated")
          .order("created_at", { ascending: false });
        const rows = (ds || []) as any[];
        const fresh = await refreshSignedUrls(
          "insurance-docs",
          rows.map((r) => r.file_path).filter(Boolean),
        );
        if (cancelled) return;
        setDocs(rows.map((r) => ({
          id: r.id,
          claim_id: r.claim_id,
          category: r.category || "claim_summary",
          file_path: r.file_path || "",
          file_name: r.details?.file_name || r.file_path?.split("/").pop() || "document.pdf",
          url: fresh.get(r.file_path) || r.details?.url || "",
          created_at: r.created_at,
        })));
      } catch (e) {
        console.warn("[ArchivedVehicleDetails] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [plate]);

  const docsByClaim = useMemo(() => {
    const m = new Map<string, DocRow[]>();
    for (const d of docs) {
      const arr = m.get(d.claim_id) || [];
      arr.push(d);
      m.set(d.claim_id, arr);
    }
    return m;
  }, [docs]);

  return (
    <div onClick={(e) => e.stopPropagation()} className="border-t border-border pt-3 mt-1 space-y-3">
      {/* Computed totals strip (overrides empty store values) */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Stat icon={<Wrench size={11} />} label="أوامر العمل" value={String(stats.visits)} />
        <Stat icon={<ShieldCheck size={11} />} label="إجمالي الإنفاق" value={formatMoney(stats.total)} highlight />
        <Stat label="آخر زيارة" value={stats.last} />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary border border-border text-foreground"
      >
        <span className="flex items-center gap-2 font-semibold">
          <FolderOpen size={13} className="text-primary" />
          سجل تفصيلي ({related.length} أمر • {claims.length} مطالبة • {docs.length} ملف • {stagePhotos.length} صورة)
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Work orders */}
          <Section icon={<Wrench size={12} />} title={`أوامر العمل (${related.length})`}>
            {related.length === 0 ? (
              <Empty text="لا توجد أوامر عمل مرتبطة" />
            ) : (
              <div className="space-y-1.5">
                {related.map((o) => (
                  <Link
                    key={o.id}
                    to={`/work-orders/${encodeURIComponent(o.id)}`}
                    className="flex items-center justify-between gap-2 text-[11px] bg-card border border-border rounded px-2.5 py-1.5 hover:border-primary/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-foreground">{o.displayNumber || o.id}</span>
                      <span className="text-muted-foreground truncate">{o.entryDate}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border whitespace-nowrap">{o.status}</span>
                    </div>
                    <span className="text-primary font-semibold whitespace-nowrap">{formatMoney(o.totalCost || 0)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Insurance claims with documents */}
          <Section icon={<ShieldCheck size={12} />} title={`مطالبات التأمين (${claims.length})`}>
            {loading ? (
              <Empty text="جاري التحميل…" />
            ) : claims.length === 0 ? (
              <Empty text="لا توجد مطالبات تأمين لهذه المركبة" />
            ) : (
              <div className="space-y-2">
                {claims.map((c) => {
                  const cdocs = docsByClaim.get(c.id) || [];
                  return (
                    <div key={c.id} className="bg-card border border-border rounded p-2 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link to={`/insurance/${c.id}`} className="font-mono text-primary hover:underline">{c.claim_number}</Link>
                          <span className="text-muted-foreground truncate">{c.insurance_company || "—"}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{c.status}</span>
                        </div>
                        <span className="text-foreground whitespace-nowrap">{formatMoney(c.approved_amount ?? c.estimated_amount ?? 0)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        {c.incident_date && <span>الحادث: {c.incident_date}</span>}
                        <span>أُنشئت: {new Date(c.created_at).toLocaleDateString("en-GB")}</span>
                        {c.paid_at && <span className="text-emerald-500">مدفوعة: {new Date(c.paid_at).toLocaleDateString("en-GB")}</span>}
                      </div>
                      {cdocs.length > 0 && (
                        <div className="border-t border-border pt-1.5 mt-1 space-y-1">
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1"><FileText size={10} /> المستندات ({cdocs.length})</div>
                          <div className="flex flex-wrap gap-1.5">
                            {cdocs.map((d) => (
                              <a
                                key={d.id}
                                href={d.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-secondary hover:bg-secondary/80 border border-border text-foreground"
                                title={d.file_name}
                              >
                                <Download size={10} /> {d.category}
                                <ExternalLink size={9} className="opacity-50" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Stage photos aggregated from all related work orders */}
          <Section icon={<Camera size={12} />} title={`صور المراحل (${stagePhotos.length})`}>
            {stagePhotos.length === 0 ? (
              <Empty text="لا توجد صور مراحل" />
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                {stagePhotos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setLbStart(i); setLbOpen(true); }}
                    className="aspect-square rounded-md overflow-hidden border border-border bg-card relative group cursor-zoom-in hover:border-primary transition"
                    title={`${p.phaseLabel || ""} — ${p.orderId}`}
                  >
                    <img src={p.dataUrl} alt={p.caption || p.phase || ""} className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/95 to-transparent px-1 py-0.5">
                      <div className="text-[8px] font-semibold text-foreground truncate">{p.phaseLabel}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      <PhotoLightbox open={lbOpen} onOpenChange={setLbOpen} photos={stagePhotos} startIndex={lbStart} />
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon?: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-secondary/30 border border-border/60 rounded-lg px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground mb-0.5 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-[11px] font-semibold truncate ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">{icon} {title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[10px] text-muted-foreground italic px-1">{text}</div>;
}
