import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, AlertTriangle, Merge, Eye, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { smartBack } from "@/lib/smartBack";

interface DupGroup {
  plate_letters: string;
  plate_number: string;
  plate_country: string;
  dup_count: number;
  vehicle_ids: string[];
  vehicle_labels: string[];
}

interface VehicleRow {
  id: string;
  plate_letters: string;
  plate_number: string;
  plate_country: string;
  brand: string;
  model: string;
  year: number | null;
  color: string | null;
  customer_id: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export default function VehiclesCleanup() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, VehicleRow[]>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_duplicates")
      .select("*")
      .order("dup_count", { ascending: false });
    if (error) {
      toast.error("تعذر تحميل قائمة المكررات: " + error.message);
      setLoading(false);
      return;
    }
    const rows = (data as DupGroup[]) || [];
    setGroups(rows);

    // Pre-fetch details for each group
    const allIds = rows.flatMap((g) => g.vehicle_ids);
    if (allIds.length) {
      const { data: vs } = await supabase
        .from("vehicles")
        .select("id, plate_letters, plate_number, plate_country, brand, model, year, color, customer_id, created_at, updated_at, archived")
        .in("id", allIds);
      const map: Record<string, VehicleRow[]> = {};
      rows.forEach((g) => {
        const key = `${g.plate_letters}|${g.plate_number}|${g.plate_country}`;
        map[key] = (vs as VehicleRow[] | null)?.filter((v) => g.vehicle_ids.includes(v.id)) ?? [];
      });
      setDetails(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function mergeInto(keepId: string, dropIds: string[]) {
    if (!dropIds.length) return;
    if (!confirm(
      `سيتم نقل كل أوامر العمل والمطالبات والفواتير من ${dropIds.length} سجل إلى السجل المختار، ثم حذف السجلات الأخرى.\n\nهل أنت متأكد؟`,
    )) return;

    setMerging(keepId);
    try {
      // Reassign all FK references to the kept vehicle
      const tables: Array<{ table: string; col: string }> = [
        { table: "job_orders", col: "vehicle_id" },
        { table: "insurance_claims", col: "vehicle_id" },
        { table: "insurance_estimates", col: "vehicle_id" },
        { table: "inspections", col: "vehicle_id" },
        { table: "damage_markers", col: "vehicle_id" },
      ];
      for (const { table, col } of tables) {
        const { error } = await (supabase as any)
          .from(table)
          .update({ [col]: keepId })
          .in(col, dropIds);
        if (error && !`${error.message}`.includes("does not exist")) {
          console.warn(`[merge] ${table}.${col}`, error);
        }
      }
      // Now delete the duplicate vehicle rows
      const { error: delErr } = await supabase.from("vehicles").delete().in("id", dropIds);
      if (delErr) throw delErr;
      toast.success(`تم دمج ${dropIds.length} سجل بنجاح`);
      await load();
    } catch (e: any) {
      toast.error("فشل الدمج: " + (e?.message ?? e));
    } finally {
      setMerging(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
            <ArrowRight />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">تنظيف المركبات المكررة</h1>
            <p className="text-sm text-muted-foreground">
              مركبات مختلفة بنفس (رقم اللوحة + الحروف + الدولة) — يجب دمجها قبل تفعيل قيد الفرادة الإلزامي.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> تحديث
        </Button>
      </div>

      {loading ? (
        <Card className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={18} /> جاري التحميل...
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <CheckCircle2 size={48} className="mx-auto text-success" />
          <h2 className="text-lg font-semibold">لا توجد مركبات مكررة</h2>
          <p className="text-sm text-muted-foreground">
            النظام نظيف. يمكنك الآن طلب تفعيل قيد الفرادة الإلزامي (UNIQUE constraint) لمنع التكرار مستقبلاً.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 bg-warning/10 border-warning/30 flex items-center gap-3">
            <AlertTriangle className="text-warning shrink-0" />
            <div className="text-sm">
              تم رصد <strong>{groups.length}</strong> مجموعة مكررة (إجمالي{" "}
              <strong>{groups.reduce((s, g) => s + g.dup_count, 0)}</strong> سجل).
              اختر السجل الأساسي ثم اضغط "دمج الباقي" لنقل أوامر العمل والمطالبات إليه ثم حذف المكررات.
            </div>
          </Card>

          {groups.map((g) => {
            const key = `${g.plate_letters}|${g.plate_number}|${g.plate_country}`;
            const rows = details[key] ?? [];
            return (
              <Card key={key} className="overflow-hidden">
                <div className="p-4 border-b border-border bg-secondary/30 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <Badge variant="destructive" className="text-base px-3 py-1">
                      ×{g.dup_count}
                    </Badge>
                    <span className="font-mono text-lg font-semibold" dir="ltr">
                      {g.plate_letters} {g.plate_number}
                    </span>
                    <span className="text-xs text-muted-foreground">{g.plate_country}</span>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {rows.map((v) => {
                    const otherIds = rows.filter((x) => x.id !== v.id).map((x) => x.id);
                    return (
                      <div key={v.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">
                            {v.brand} {v.model} {v.year ? `(${v.year})` : ""} {v.color ? `— ${v.color}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            ID: {v.id.slice(0, 8)} • أُنشئ {new Date(v.created_at).toLocaleDateString("en-GB")}
                            {v.archived && <span className="ms-2 text-warning">• مؤرشف</span>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/vehicles/${encodeURIComponent(v.id)}`)}
                            className="gap-1"
                          >
                            <Eye size={14} /> عرض
                          </Button>
                          <Button
                            size="sm"
                            disabled={merging === v.id || otherIds.length === 0}
                            onClick={() => mergeInto(v.id, otherIds)}
                            className="gap-1"
                          >
                            {merging === v.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Merge size={14} />
                            )}
                            احتفظ بهذا • ادمج الباقي ({otherIds.length})
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
