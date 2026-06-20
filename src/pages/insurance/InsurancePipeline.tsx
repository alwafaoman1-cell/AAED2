import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Clock, CheckCircle, XCircle, DollarSign, Ban, Search, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useInsuranceClaims, useUpdateClaimStatus, type InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { toEnglishDigits } from "@/lib/numberUtils";
import { computeDays, durationLevel, durationBadgeClass } from "@/lib/claimDurationStatus";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

type Status = "pending" | "approved" | "paid" | "rejected" | "cancelled";

const COLUMNS: { key: Status; label: string; color: string; icon: typeof Clock }[] = [
  { key: "pending", label: "بانتظار الاعتماد", color: "border-warning/40 bg-warning/5", icon: Clock },
  { key: "approved", label: "معتمدة", color: "border-success/40 bg-success/5", icon: CheckCircle },
  { key: "paid", label: "مدفوعة", color: "border-info/40 bg-info/5", icon: DollarSign },
  { key: "rejected", label: "مرفوضة", color: "border-destructive/40 bg-destructive/5", icon: XCircle },
  { key: "cancelled", label: "ملغاة", color: "border-muted bg-muted/20", icon: Ban },
];

export default function InsurancePipeline() {
  const navigate = useNavigate();
  const { data: claims = [], isLoading } = useInsuranceClaims();
  const updateStatus = useUpdateClaimStatus();
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const filtered = useMemo(() => {
    let result = claims;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.claim_number?.toLowerCase().includes(s) ||
          c.insurance_company?.toLowerCase().includes(s) ||
          (c as any).vehicle_plate?.toLowerCase?.().includes(s) ||
          c.customer?.name?.toLowerCase().includes(s)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom); from.setHours(0,0,0,0);
      result = result.filter((c) => {
        if (!c.workshop_arrival_date) return false;
        const d = new Date(c.workshop_arrival_date);
        return d >= from;
      });
    }
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23,59,59,999);
      result = result.filter((c) => {
        if (!c.workshop_arrival_date) return false;
        const d = new Date(c.workshop_arrival_date);
        return d <= to;
      });
    }
    return result;
  }, [claims, search, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const g: Record<Status, InsuranceClaim[]> = { pending: [], approved: [], paid: [], rejected: [], cancelled: [] };
    for (const c of filtered) {
      const s = (c.status as Status) || "pending";
      if (g[s]) g[s].push(c);
    }
    return g;
  }, [filtered]);

  const onDrop = (target: Status) => {
    if (!dragId) return;
    const claim = claims.find((c) => c.id === dragId);
    setDragId(null);
    if (!claim || claim.status === target) return;

    if (target === "approved" || target === "rejected" || target === "cancelled") {
      updateStatus.mutate(
        { id: claim.id, status: target },
        { onSuccess: () => toast.success(`تم نقل ${claim.claim_number} إلى ${COLUMNS.find((c) => c.key === target)?.label}`) }
      );
    } else if (target === "paid") {
      updateStatus.mutate({ id: claim.id, status: "paid" });
    } else {
      updateStatus.mutate({ id: claim.id, status: target });
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Pipeline المطالبات</h1>
          <p className="text-xs md:text-sm text-muted-foreground">اسحب وأفلت لتغيير حالة المطالبة</p>
        </div>
        <Button onClick={() => navigate("/insurance/new")} className="gap-2">
          <Plus size={16} /> مطالبة جديدة
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>

        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <CalendarDays size={14} />
                {dateFrom ? format(dateFrom, "dd/MM/yyyy", { locale: ar }) : "من تاريخ"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <CalendarDays size={14} />
                {dateTo ? format(dateTo, "dd/MM/yyyy", { locale: ar }) : "إلى تاريخ"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
              <X size={14} /> مسح
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const Icon = col.icon;
            const items = grouped[col.key];
            const total = items.reduce((s, c) => s + Number(c.estimated_amount || 0), 0);
            return (
              <div
                key={col.key}
                className={`rounded-xl border-2 ${col.color} p-3 min-h-[400px] transition`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(col.key)}
              >
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <Icon size={14} />
                    <span className="text-sm font-semibold">{col.label}</span>
                  </div>
                  <Badge variant="outline" className="h-5 text-[10px]">{items.length}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mb-2 font-mono" dir="ltr">
                  {toEnglishDigits(Math.round(total).toLocaleString("en-US"))} OMR
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground/60">— فارغ —</div>
                  ) : (
                    items.map((c) => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={() => setDragId(c.id)}
                        onClick={() => navigate(`/insurance/${c.id}`)}
                        className="bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-md transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-[11px] text-primary group-hover:underline" dir="ltr">{c.claim_number}</span>
                        </div>
                        <div className="text-xs font-medium truncate">{c.insurance_company}</div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {(c as any).vehicle_make} {(c as any).vehicle_model}
                        </div>
                        {((c as any).vehicle_plate) && (
                          <div className="text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded bg-secondary border border-border font-mono" dir="ltr">
                            {(c as any).vehicle_plate}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-1.5">
                          <div className="text-[10px] font-mono text-foreground/80" dir="ltr">
                            {toEnglishDigits(Number(c.estimated_amount).toLocaleString("en-US"))} OMR
                          </div>
                          {(() => {
                            const days = computeDays((c as any).workshop_arrival_date ?? c.created_at, (c as any).delivered_at);
                            const lvl = durationLevel(days);
                            return (
                              <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-semibold ${durationBadgeClass(lvl)}`}>
                                {toEnglishDigits(String(days ?? 0))}d
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
