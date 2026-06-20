import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Cloud, Database, RefreshCw, Trash2, Upload, CheckCircle2 } from "lucide-react";
import { writeCloudSetting } from "@/lib/cloudSettings";
import { toast } from "sonner";

// Pattern → كل المفاتيح المعروفة و نقصدها كإعدادات
const KNOWN_SETTING_KEYS: Record<string, string> = {
  alwafa_finance_voucher_settings_v1: "إعدادات سندات الصرف",
  alwafa_numbering_settings_v1: "إعدادات الترقيم",
  alwafa_pdf_layout_v1: "تخطيط PDF",
  alwafa_public_access_v1: "الوصول العام",
  alwafa_modules_v1: "الوحدات المفعّلة",
  alwafa_quick_actions_v1: "أزرار الإجراءات السريعة",
  alwafa_monthly_settings_v1: "إعدادات الشهر",
  alwafa_roles_perms_v1: "صلاحيات الأدوار",
  alwafa_expense_categories_v1: "تصنيفات المصروفات",
};

// مفاتيح بيانات تشغيلية (تُستثنى من «إعدادات» لكنها قابلة للمسح)
const OPERATIONAL_KEYS = [
  "alwafa_customers_v1",
  "alwafa_work_orders",
  "alwafa_sales_docs_v1",
  "alwafa_trash_v1",
  "alwafa_wa_message_logs",
];

interface LsEntry {
  key: string;
  label: string;
  bytes: number;
  preview: string;
  parsed: unknown;
  isSetting: boolean;
  isOperational: boolean;
  isCacheArtifact: boolean;
}

function loadAll(): LsEntry[] {
  const out: LsEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const raw = localStorage.getItem(k) || "";
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    out.push({
      key: k,
      label: KNOWN_SETTING_KEYS[k] || k,
      bytes: new Blob([raw]).size,
      preview: raw.length > 120 ? raw.slice(0, 120) + "…" : raw,
      parsed,
      isSetting: !!KNOWN_SETTING_KEYS[k],
      isOperational: OPERATIONAL_KEYS.includes(k),
      isCacheArtifact: k.startsWith("cloud_setting_cache:") || k.startsWith("sb-") || k.startsWith("store:"),
    });
  }
  return out.sort((a, b) => Number(b.isSetting) - Number(a.isSetting) || b.bytes - a.bytes);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function BrowserCacheAuditPage() {
  const [entries, setEntries] = useState<LsEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  function refresh() {
    setEntries(loadAll());
    setSelected(new Set());
  }
  useEffect(() => { refresh(); }, []);

  const totalBytes = useMemo(() => entries.reduce((s, e) => s + e.bytes, 0), [entries]);
  const settings = entries.filter((e) => e.isSetting);
  const operational = entries.filter((e) => e.isOperational);
  const other = entries.filter((e) => !e.isSetting && !e.isOperational);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll(list: LsEntry[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = list.every((e) => next.has(e.key));
      list.forEach((e) => { if (allSelected) next.delete(e.key); else next.add(e.key); });
      return next;
    });
  }

  async function uploadSelectedToCloud() {
    if (selected.size === 0) { toast.error("اختر إعداداً واحداً على الأقل"); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    for (const key of selected) {
      const entry = entries.find((e) => e.key === key);
      if (!entry) continue;
      try {
        await writeCloudSetting(key, entry.parsed);
        ok++;
      } catch (err) {
        console.error("upload failed for", key, err);
        fail++;
      }
    }
    setUploading(false);
    if (ok) toast.success(`تم رفع ${ok} إعداد للسحابة`);
    if (fail) toast.error(`فشل رفع ${fail} عنصر`);
  }

  function clearSelected() {
    if (selected.size === 0) { toast.error("اختر عناصر للمسح"); return; }
    if (!confirm(`مسح ${selected.size} مفتاح من المتصفح؟ سيتم إعادة تحميلها من السحابة عند الحاجة.`)) return;
    selected.forEach((k) => localStorage.removeItem(k));
    toast.success("تم المسح");
    refresh();
  }

  function clearAllAndReload() {
    if (!confirm("⚠️ مسح كل بيانات المتصفح؟ سيتم تسجيل خروجك وإعادة تحميل الصفحة. البيانات السحابية لن تُمَس.")) return;
    try {
      const sbKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-")) sbKeys.push(k);
      }
      localStorage.clear();
      sessionStorage.clear();
      // Keep auth so user doesn't have to re-login? Actually they want clean — log out.
      void sbKeys;
    } catch {}
    window.location.reload();
  }

  function renderSection(title: string, list: LsEntry[], emptyHint: string, accent: string) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className={`text-base font-semibold flex items-center gap-2 ${accent}`}>
            {title} <span className="text-xs text-muted-foreground">({list.length})</span>
          </h3>
          {list.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => toggleAll(list)}>تحديد الكل</Button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        ) : (
          <div className="space-y-2">
            {list.map((e) => (
              <div key={e.key} className="flex items-start gap-3 p-2.5 rounded-md border border-border bg-card hover:bg-secondary/30">
                <Checkbox checked={selected.has(e.key)} onCheckedChange={() => toggle(e.key)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{e.label}</span>
                    {e.isSetting && <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">إعداد</Badge>}
                    {e.isOperational && <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600">بيانات تشغيلية</Badge>}
                    <span className="text-[10px] text-muted-foreground">{formatBytes(e.bytes)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5" dir="ltr">{e.key}</div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5 opacity-60" dir="ltr">{e.preview}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Database size={22} /> صيانة ذاكرة المتصفح
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            راجع البيانات المخزّنة محلياً في متصفحك، ارفع الإعدادات المهمة للسحابة (مصدر وحيد للحقيقة)، وامسح الذاكرة المؤقتة عند الحاجة.
          </p>
        </div>

        {/* Banner */}
        <Card className="p-4 bg-amber-500/5 border-amber-500/30 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div className="text-sm space-y-1">
            <p className="font-medium text-foreground">لماذا تختفي الإعدادات أحياناً؟</p>
            <p className="text-muted-foreground text-xs">
              بعض الإعدادات القديمة محفوظة في متصفحك فقط. لو فتحت النظام من جهاز آخر أو مسحت الكاش، ستختفي.
              ارفعها للسحابة الآن لتظل محفوظة في كل الأجهزة.
            </p>
          </div>
        </Card>

        {/* Summary bar */}
        <Card className="p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-muted-foreground">
            إجمالي المحفوظ: <strong className="text-foreground">{formatBytes(totalBytes)}</strong> ضمن <strong className="text-foreground">{entries.length}</strong> مفتاح
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={refresh} className="gap-1">
              <RefreshCw size={14} /> تحديث
            </Button>
            <Button size="sm" onClick={uploadSelectedToCloud} disabled={uploading || selected.size === 0} className="gap-1">
              <Upload size={14} /> رفع المحدد للسحابة ({selected.size})
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelected} disabled={selected.size === 0} className="gap-1 text-amber-600 border-amber-500/40">
              <Trash2 size={14} /> مسح المحدد
            </Button>
            <Button size="sm" variant="destructive" onClick={clearAllAndReload} className="gap-1">
              <Trash2 size={14} /> مسح الكل وإعادة التحميل
            </Button>
          </div>
        </Card>

        {/* Sections */}
        {renderSection("الإعدادات (يُنصح برفعها للسحابة)", settings,
          "لا توجد إعدادات محلية. كل شيء مزامن.", "text-primary")}

        {renderSection("بيانات تشغيلية (عملاء/أوامر/مبيعات محلية)", operational,
          "لا توجد بيانات تشغيلية محلية.", "text-amber-600")}

        {renderSection("ذاكرة مؤقتة أخرى", other,
          "نظيف.", "text-muted-foreground")}

        <Card className="p-4 bg-emerald-500/5 border-emerald-500/30 flex items-start gap-3">
          <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={20} />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground block mb-1 flex items-center gap-1">
              <Cloud size={14} /> النظام السحابي الجديد
            </strong>
            الإعدادات المرفوعة للسحابة تُخزّن في جدول <code className="font-mono bg-background px-1 rounded">tenant_settings</code> مع رقم إصدار يمنع
            الكتابة فوق نسخة أحدث، ومزامنة لحظية بين كل أجهزتك. بعد الرفع لن تختفي الإعدادات أبداً.
          </div>
        </Card>
      </div>
    </div>
  );
}
