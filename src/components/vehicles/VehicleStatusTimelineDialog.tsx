import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Clock, Inbox, Search, Wrench, ShieldCheck, Truck, Calendar } from "lucide-react";
import type { WorkOrder } from "@/lib/workOrdersStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: WorkOrder[];
  plate: string;
}

// Standard 7-stage vehicle journey
const STAGES = [
  { key: "received", label: "الاستلام", en: "Received", icon: Inbox, statusKeywords: ["استلام", "تحت الفحص"] },
  { key: "inspection", label: "الفحص الفني", en: "Inspection", icon: Search, statusKeywords: ["فحص", "تحت الفحص"] },
  { key: "approval", label: "الموافقة / التأمين", en: "Approval", icon: ShieldCheck, statusKeywords: ["بانتظار الموافقة"] },
  { key: "parts", label: "قطع الغيار", en: "Parts", icon: Clock, statusKeywords: ["بانتظار قطع"] },
  { key: "repair", label: "الإصلاح", en: "Repair", icon: Wrench, statusKeywords: ["تحت الإصلاح", "إصلاح"] },
  { key: "quality", label: "ضبط الجودة", en: "Quality", icon: ShieldCheck, statusKeywords: ["ضبط الجودة", "جودة"] },
  { key: "delivery", label: "التسليم", en: "Delivery", icon: Truck, statusKeywords: ["جاهز للتسليم", "تم التسليم", "مغلق"] },
];

function inferStageIndex(status: string): number {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (STAGES[i].statusKeywords.some((k) => status.includes(k))) return i;
  }
  return 0;
}

export default function VehicleStatusTimelineDialog({ open, onOpenChange, orders, plate }: Props) {
  // Use the latest (most recent) order to drive the active stage, but show all order timestamps per stage.
  const sorted = useMemo(
    () => [...orders].sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [orders],
  );
  const latest = sorted[0];
  const currentStageIdx = latest ? inferStageIndex(latest.status) : -1;

  // Build a per-stage timeline: gather all photo timestamps for that phase (proxy for when stage was active)
  // and derive duration between consecutive completed stages.
  const stageData = STAGES.map((stage, i) => {
    // Find earliest photo for this phase across all orders
    const phasePhotos = sorted.flatMap((o) =>
      (o.photos || [])
        .filter((p) => {
          if (stage.key === "approval" || stage.key === "parts") return false;
          return p.phase === stage.key;
        })
        .map((p) => ({ ...p, orderId: o.id, orderDate: o.entryDate })),
    );
    const firstAt = phasePhotos.length
      ? phasePhotos.map((p) => p.uploadedAt).sort()[0]
      : sorted.find((o) => inferStageIndex(o.status) >= i)?.entryDate;
    const isComplete = currentStageIdx >= 0 && i < currentStageIdx;
    const isActive = currentStageIdx === i;
    return { stage, firstAt, isComplete, isActive, photoCount: phasePhotos.length };
  });

  // Compute duration between adjacent timestamps
  function diffHuman(a?: string, b?: string): string | null {
    if (!a || !b) return null;
    const da = new Date(a).getTime();
    const db = new Date(b).getTime();
    if (isNaN(da) || isNaN(db)) return null;
    const ms = Math.abs(db - da);
    const days = Math.floor(ms / 86400000);
    const hrs = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days} يوم${hrs ? ` ${hrs} س` : ""}`;
    if (hrs > 0) return `${hrs} ساعة`;
    const mins = Math.floor(ms / 60000);
    return `${mins} دقيقة`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Truck size={18} className="text-primary" />
            مخطط حالة السيارة — {plate}
          </DialogTitle>
        </DialogHeader>

        {!latest ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            لا توجد أوامر عمل لتعقّب الحالة.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-secondary/30 border border-border rounded-lg p-3 flex flex-wrap gap-3 items-center justify-between">
              <div className="text-xs text-muted-foreground">
                المرحلة الحالية:{" "}
                <span className="text-foreground font-semibold">
                  {currentStageIdx >= 0 ? STAGES[currentStageIdx].label : latest.status}
                </span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                آخر أمر: <span className="font-mono mx-1">{latest.id}</span> • {latest.entryDate}
              </Badge>
            </div>

            {/* Vertical timeline */}
            <div className="relative pr-8">
              <div className="absolute right-3 top-2 bottom-2 w-0.5 bg-border" />
              <div className="space-y-3">
                {stageData.map((s, i) => {
                  const Icon = s.stage.icon;
                  const next = stageData[i + 1];
                  const dur = diffHuman(s.firstAt, next?.firstAt);
                  const dotColor = s.isComplete
                    ? "bg-success border-success/50"
                    : s.isActive
                    ? "bg-primary border-primary/50 animate-pulse"
                    : "bg-secondary border-border";
                  return (
                    <div key={s.stage.key} className="relative">
                      <div
                        className={`absolute -right-[26px] top-1.5 w-6 h-6 rounded-full border-4 flex items-center justify-center ${dotColor}`}
                      >
                        {s.isComplete ? (
                          <CheckCircle2 size={12} className="text-success-foreground" />
                        ) : s.isActive ? (
                          <Circle size={10} className="text-primary-foreground fill-current" />
                        ) : null}
                      </div>
                      <div
                        className={`rounded-lg p-3 border ${
                          s.isActive
                            ? "bg-primary/5 border-primary/40"
                            : s.isComplete
                            ? "bg-success/5 border-success/20"
                            : "bg-secondary/20 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Icon size={14} className={s.isComplete ? "text-success" : s.isActive ? "text-primary" : "text-muted-foreground"} />
                            <div>
                              <div className="text-sm font-semibold text-foreground">{s.stage.label}</div>
                              <div className="text-[10px] text-muted-foreground">{s.stage.en}</div>
                            </div>
                          </div>
                          <div className="text-left">
                            {s.firstAt ? (
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Calendar size={10} />
                                <span dir="ltr">{new Date(s.firstAt).toLocaleString("ar-OM", { dateStyle: "short", timeStyle: "short" })}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">لم تبدأ بعد</span>
                            )}
                            {s.photoCount > 0 && (
                              <div className="text-[10px] text-primary mt-0.5">{s.photoCount} صورة</div>
                            )}
                          </div>
                        </div>
                        {dur && next?.firstAt && (
                          <div className="mt-2 text-[10px] text-muted-foreground border-t border-border/50 pt-1.5">
                            ⏱ مدة المرحلة حتى التالية: <span className="text-foreground font-medium">{dur}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
              يتم استنتاج توقيت كل مرحلة من حالات أوامر العمل وأوقات رفع صور المراحل.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
