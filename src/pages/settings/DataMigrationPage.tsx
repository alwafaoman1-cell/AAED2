import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Cloud, CheckCircle2, AlertTriangle, Loader2, ArrowUpToLine, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { ENTITY_PLAN, runFullMigration, runFullPull, cloudHasData, type MigrationProgress, type CloudEntity } from "@/lib/cloudSync";

export default function DataMigrationPage() {
  const { profile, hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [progress, setProgress] = useState<Record<string, MigrationProgress>>({});
  const [running, setRunning] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [cloudCounts, setCloudCounts] = useState<Record<string, number>>({});

  async function refreshCloud() {
    try {
      const rows = await cloudHasData();
      const map: Record<string, number> = {};
      rows.forEach((r) => { map[r.entity] = r.count; });
      setCloudCounts(map);
    } catch {}
  }

  useEffect(() => { refreshCloud(); }, []);

  async function start() {
    if (!isAdmin) return toast.error("هذه الأداة للأدمن فقط");
    setRunning(true);
    setProgress({});
    const { ok } = await runFullMigration((p) => {
      setProgress((prev) => ({ ...prev, [p.entity]: p }));
    });
    setRunning(false);
    if (!ok) toast.error("تعذّر العثور على معرّف المنشأة");
    else { toast.success("اكتمل الترحيل"); refreshCloud(); }
  }

  async function startPull() {
    if (!isAdmin) return toast.error("هذه الأداة للأدمن فقط");
    if (!confirm("سيتم استبدال بيانات هذا الجهاز المحلية ببيانات السحابة. متابعة؟")) return;
    setPulling(true);
    setProgress({});
    const { ok } = await runFullPull((p) => {
      setProgress((prev) => ({ ...prev, [p.entity]: p }));
    });
    setPulling(false);
    if (!ok) toast.error("تعذّر الاتصال بالسحابة");
    else { toast.success("تم تنزيل البيانات من السحابة. أعد تحميل الصفحة لرؤيتها."); setTimeout(() => location.reload(), 1500); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-info/10 text-info flex items-center justify-center">
          <Cloud size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">ترحيل البيانات إلى السحابة</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ينقل بيانات هذا الجهاز (المخزنة محلياً) إلى قاعدة البيانات السحابية ليصبح
            بإمكان جميع المستخدمين في منشأتك الوصول إليها من أي جهاز بشكل لحظي.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="text-warning shrink-0" size={20} />
          <div className="text-sm">هذه الأداة متاحة لمستخدم بصلاحية <b>أدمن</b> فقط.</div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-semibold">المنشأة الحالية</div>
            <div className="text-xs text-muted-foreground font-mono">{profile?.tenant_id || "—"}</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={start}
              disabled={!isAdmin || running || pulling}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              {running ? <Loader2 className="animate-spin" size={16} /> : <ArrowUpToLine size={16} />}
              {running ? "جاري الرفع…" : "رفع من هذا الجهاز للسحابة"}
            </button>
            <button
              onClick={startPull}
              disabled={!isAdmin || running || pulling}
              className="bg-success text-success-foreground hover:bg-success/90 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              {pulling ? <Loader2 className="animate-spin" size={16} /> : <ArrowDownToLine size={16} />}
              {pulling ? "جاري التنزيل…" : "تنزيل من السحابة لهذا الجهاز"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-right">
              <th className="p-3 font-semibold">العنصر</th>
              <th className="p-3 font-semibold w-24">محلي</th>
              <th className="p-3 font-semibold w-24">سحابي</th>
              <th className="p-3 font-semibold w-32">الحالة</th>
              <th className="p-3 font-semibold">التقدم</th>
            </tr>
          </thead>
          <tbody>
            {ENTITY_PLAN.map((step) => {
              const p = progress[step.entity];
              const localCount = step.total();
              const cloudCount = cloudCounts[step.entity] ?? 0;
              const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <tr key={step.entity} className="border-t border-border">
                  <td className="p-3">{step.label}</td>
                  <td className="p-3 font-mono">{localCount}</td>
                  <td className="p-3 font-mono">{cloudCount}</td>
                  <td className="p-3">
                    {!p && <span className="text-muted-foreground">—</span>}
                    {p?.status === "running" && <span className="text-info flex items-center gap-1"><Loader2 className="animate-spin" size={14} /> جاري…</span>}
                    {p?.status === "done" && <span className="text-success flex items-center gap-1"><CheckCircle2 size={14} /> تم</span>}
                    {p?.status === "error" && (
                      <span className="text-destructive flex items-center gap-1" title={p.message || ""}>
                        <AlertTriangle size={14} /> خطأ
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {p && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-end">{p.done}/{p.total}</span>
                      </div>
                    )}
                    {p?.status === "error" && p.message && (
                      <div className="mt-1 text-xs text-destructive font-mono break-all">{p.message}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>• يمكنك تشغيل الترحيل عدة مرات؛ السطور التي تم إدراجها سابقاً ستُدرج كنسخ جديدة (لا يوجد منع تكرار بعد).</p>
        <p>• بعد التأكد من ظهور البيانات في السحابة، ستُعدَّل الشاشات في التحديث التالي لتقرأ مباشرة من السحابة وتزامن لحظي.</p>
      </div>
    </div>
  );
}
