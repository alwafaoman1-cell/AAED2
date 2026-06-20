import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileUp, Trash2, Download, Palette, Info } from "lucide-react";
import { toast } from "sonner";

// ملاحظة مهمة: هذه الصفحة لرفع ملف "تحديث القالب/الستايل" فقط.
// لا يتم تطبيق أي تغييرات على البيانات المحفوظة. الملف يُخزَّن محلياً
// لكي يستخدمه المطور (Lovable) لاحقاً عند تطبيق تحديث التصميم.

interface StoredTemplateFile {
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  content: string; // base64 أو نص
  isText: boolean;
  notes?: string;
}

const STORAGE_KEY = "pending_template_update_v1";
const MAX_SIZE = 8 * 1024 * 1024; // 8MB

function readStored(): StoredTemplateFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function TemplateUpdatePage() {
  const [file, setFile] = useState<StoredTemplateFile | null>(null);
  const [notes, setNotes] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const f = readStored();
    setFile(f);
    setNotes(f?.notes || "");
  }, []);

  const onPick = () => inputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_SIZE) {
      toast.error("حجم الملف يجب أن يكون أقل من 8 ميجابايت");
      return;
    }
    const isText = /\.(json|css|html|txt|md|tsx?|jsx?)$/i.test(f.name) ||
      f.type.startsWith("text/") || f.type.includes("json");

    const reader = new FileReader();
    reader.onload = () => {
      const stored: StoredTemplateFile = {
        name: f.name,
        type: f.type || "application/octet-stream",
        size: f.size,
        uploadedAt: new Date().toISOString(),
        content: reader.result as string,
        isText,
        notes,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      setFile(stored);
      toast.success("تم رفع ملف القالب بنجاح — جاهز لتطبيقه لاحقاً");
    };
    reader.onerror = () => toast.error("فشل قراءة الملف");
    if (isText) reader.readAsText(f);
    else reader.readAsDataURL(f);
  };

  const handleDelete = () => {
    localStorage.removeItem(STORAGE_KEY);
    setFile(null);
    setNotes("");
    toast.success("تم حذف الملف");
  };

  const handleSaveNotes = () => {
    if (!file) return;
    const updated = { ...file, notes };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setFile(updated);
    toast.success("تم حفظ الملاحظات");
  };

  const handleDownload = () => {
    if (!file) return;
    const blob = file.isText
      ? new Blob([file.content], { type: file.type })
      : (() => {
          const b64 = file.content.split(",")[1] || "";
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return new Blob([arr], { type: file.type });
        })();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto p-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Palette className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">تحديث القالب والتصميم</h1>
          <p className="text-sm text-muted-foreground">
            ارفع ملف تحديث القالب هنا. لن يتم تغيير أي بيانات محفوظة — فقط الستايل والتصميم.
          </p>
        </div>
      </div>

      <Card className="p-4 border-info/30 bg-info/5">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">كيف يعمل هذا؟</p>
            <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
              <li>ارفع ملف التحديث (JSON / CSS / HTML / ZIP أو أي ملف ستايل).</li>
              <li>سيتم حفظ الملف محلياً في المتصفح فقط — البيانات الفعلية لن تتأثر إطلاقاً.</li>
              <li>اطلب مني لاحقاً «طبّق ملف تحديث القالب» وسأقرأ الملف وأطبّق التصميم.</li>
              <li>الحد الأقصى لحجم الملف: 8 ميجابايت.</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <input
          ref={inputRef}
          type="file"
          accept=".json,.css,.html,.txt,.md,.zip,.tsx,.jsx,.ts,.js,image/*"
          onChange={handleFile}
          className="hidden"
        />

        {!file ? (
          <div
            onClick={onPick}
            className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="font-semibold mb-1">اضغط لاختيار ملف التحديث</p>
            <p className="text-sm text-muted-foreground">
              JSON, CSS, HTML, ZIP, TSX… الحد الأقصى 8 ميجابايت
            </p>
            <Button className="mt-4" type="button">
              <FileUp className="h-4 w-4 ml-2" />
              اختر ملف
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-muted/40 border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileUp className="h-4 w-4 text-primary" />
                  <span className="font-semibold truncate">{file.name}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {(file.size / 1024).toFixed(1)} KB
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  رُفع: {new Date(file.uploadedAt).toLocaleString("en-GB")} • {file.type || "غير محدد"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  <Download className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={onPick}>
                  استبدال
                </Button>
                <Button size="sm" variant="destructive" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold mb-1 block">ملاحظات للمطوّر (اختياري)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="مثال: طبّق الألوان الجديدة على الفواتير فقط، واترك صفحات التأمين كما هي…"
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              />
              <Button size="sm" variant="outline" className="mt-2" onClick={handleSaveNotes}>
                حفظ الملاحظات
              </Button>
            </div>

            {file.isText && (
              <div>
                <label className="text-sm font-semibold mb-1 block">معاينة محتوى الملف</label>
                <pre className="max-h-96 overflow-auto text-xs bg-muted/40 p-3 rounded-md border whitespace-pre-wrap break-all">
                  {file.content.slice(0, 50000)}
                  {file.content.length > 50000 && "\n... (تم اقتطاع المعاينة)"}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">تنويه:</strong> الملف يُخزَّن في متصفحك فقط (localStorage)
        ولا يُرفع إلى أي خادم. عند طلب «تطبيق تحديث القالب» سأقرأ هذا الملف وأستخدمه لتحديث التصميم
        دون المساس بأي بيانات (أوامر عمل، فواتير، عملاء، مخزون… إلخ).
      </Card>

      <AiErrorFixerCard />
      <NewHostingDbCard />
    </div>
  );
}

// ===================== مساعد إصلاح الأخطاء بالذكاء =====================
function AiErrorFixerCard() {
  const [errorText, setErrorText] = useState("");
  const [stack, setStack] = useState("");
  const [ctx, setCtx] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const diagnose = async () => {
    if (!errorText.trim() && !stack.trim()) {
      toast.error("الصق نص الخطأ أو الـ stack أولاً");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("ai-diagnose-error", {
        body: { errorText, stack, url: location.href, context: ctx },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data);
      toast.success("تم التحليل ✓");
    } catch (e: any) {
      toast.error(e?.message || "فشل التحليل");
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = () => {
    if (!result?.lovablePrompt) return;
    navigator.clipboard.writeText(result.lovablePrompt);
    toast.success("تم نسخ التعليمات — الصقها في محادثة Lovable");
  };

  return (
    <Card className="p-6 space-y-4 border-primary/30">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Info className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold">مساعد إصلاح الأخطاء بالذكاء الاصطناعي</h2>
          <p className="text-sm text-muted-foreground">
            الصق أي خطأ يظهر مستقبلاً (Console / Runtime / Build) وسأحلله لك وأُولّد لك تعليمات
            جاهزة للنسخ لإصلاحه عبر Lovable.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <div>
          <label className="text-sm font-semibold mb-1 block">نص الخطأ *</label>
          <textarea
            value={errorText}
            onChange={(e) => setErrorText(e.target.value)}
            rows={3}
            dir="ltr"
            placeholder="TypeError: Cannot read properties of undefined…"
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">Stack Trace (اختياري)</label>
          <textarea
            value={stack}
            onChange={(e) => setStack(e.target.value)}
            rows={3}
            dir="ltr"
            placeholder="at SomeComponent (src/...tsx:42:15)…"
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">سياق إضافي (اختياري)</label>
          <textarea
            value={ctx}
            onChange={(e) => setCtx(e.target.value)}
            rows={2}
            placeholder="ماذا كنت تفعل عند ظهور الخطأ؟ ما الصفحة؟"
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
        </div>
        <Button onClick={diagnose} disabled={busy} className="w-fit">
          {busy ? "جارٍ التحليل…" : "حلّل الخطأ بالذكاء"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3 pt-3 border-t">
          {result.summary && (
            <div>
              <Badge variant="outline" className="mb-1">الملخص</Badge>
              <p className="text-sm">{result.summary}</p>
            </div>
          )}
          {result.rootCause && (
            <div>
              <Badge variant="outline" className="mb-1">السبب الجذري</Badge>
              <p className="text-sm text-muted-foreground">{result.rootCause}</p>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {result.severity && <Badge variant="destructive">خطورة: {result.severity}</Badge>}
            {result.category && <Badge>{result.category}</Badge>}
          </div>
          {Array.isArray(result.likelyFiles) && result.likelyFiles.length > 0 && (
            <div>
              <Badge variant="outline" className="mb-1">ملفات محتملة</Badge>
              <ul className="text-xs font-mono space-y-1">
                {result.likelyFiles.map((f: string, i: number) => <li key={i}>• {f}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(result.fixSteps) && result.fixSteps.length > 0 && (
            <div>
              <Badge variant="outline" className="mb-1">خطوات الإصلاح</Badge>
              <ol className="text-sm space-y-1 list-decimal pr-5">
                {result.fixSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
          {result.lovablePrompt && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge className="bg-primary">تعليمات Lovable</Badge>
                <Button size="sm" variant="outline" onClick={copyPrompt}>نسخ</Button>
              </div>
              <pre className="text-xs bg-muted/40 p-3 rounded-md border whitespace-pre-wrap break-words max-h-72 overflow-auto">
                {result.lovablePrompt}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ===================== ربط قاعدة بيانات استضافة جديدة =====================
interface NewDbConfig {
  hostingProvider: string;
  newSupabaseUrl: string;
  newAnonKey: string;
  newServiceRoleKey: string;
  newDbUrl: string;
  oldDbUrl: string;
  savedAt: string;
}
const DB_CFG_KEY = "new_hosting_db_config_v1";

function NewHostingDbCard() {
  const [cfg, setCfg] = useState<NewDbConfig>(() => {
    try {
      const raw = localStorage.getItem(DB_CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      hostingProvider: "Supabase Self-hosted",
      newSupabaseUrl: "",
      newAnonKey: "",
      newServiceRoleKey: "",
      newDbUrl: "",
      oldDbUrl: "",
      savedAt: "",
    };
  });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  const set = (k: keyof NewDbConfig, v: string) => setCfg((p) => ({ ...p, [k]: v }));

  const save = () => {
    const updated = { ...cfg, savedAt: new Date().toISOString() };
    localStorage.setItem(DB_CFG_KEY, JSON.stringify(updated));
    setCfg(updated);
    toast.success("تم حفظ إعدادات الاستضافة الجديدة محلياً");
  };

  const testConnection = async () => {
    if (!cfg.newSupabaseUrl || !cfg.newAnonKey) {
      toast.error("املأ URL والمفتاح العام أولاً");
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const resp = await fetch(`${cfg.newSupabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
        headers: { apikey: cfg.newAnonKey },
      });
      if (resp.ok) setTestMsg({ ok: true, msg: "الاتصال ناجح — الخادم يستجيب ✓" });
      else setTestMsg({ ok: false, msg: `الخادم رد بـ ${resp.status}` });
    } catch (e: any) {
      setTestMsg({ ok: false, msg: e?.message || "فشل الاتصال" });
    } finally {
      setTesting(false);
    }
  };

  const migrationScript = `# 1) تصدير البيانات من القاعدة الحالية
export OLD_DB_URL='${cfg.oldDbUrl || "<DB_URL_للقاعدة_الحالية>"}'
export NEW_DB_URL='${cfg.newDbUrl || "<DB_URL_للقاعدة_الجديدة>"}'

pg_dump "$OLD_DB_URL" \\
  --data-only --schema=public --no-owner --no-privileges \\
  --disable-triggers --column-inserts -f ./data.sql

# 2) استيراد البيانات للقاعدة الجديدة
psql "$NEW_DB_URL" -f ./data.sql

# 3) بعد نقل البيانات، حدّث متغيرات البيئة في الاستضافة الجديدة:
VITE_SUPABASE_URL=${cfg.newSupabaseUrl || "<URL>"}
VITE_SUPABASE_PUBLISHABLE_KEY=${cfg.newAnonKey || "<ANON_KEY>"}
VITE_SUPABASE_PROJECT_ID=<PROJECT_ID>

# 4) أعد بناء التطبيق ونشره.`;

  const lovablePrompt = `أريد نقل التطبيق إلى استضافة جديدة:
- المزود: ${cfg.hostingProvider}
- Supabase URL الجديد: ${cfg.newSupabaseUrl}
- Anon Key الجديد: ${cfg.newAnonKey ? cfg.newAnonKey.slice(0, 20) + "…" : "(غير مُدخل)"}
- DB URL الجديد: ${cfg.newDbUrl ? "مُدخل" : "غير مُدخل"}

المطلوب:
1) حدّث ملف src/integrations/supabase/client.ts ليستخدم القيم الجديدة من متغيرات البيئة.
2) تحقق من سلامة جميع الاستدعاءات (supabase.from, supabase.functions, supabase.storage).
3) أعد نشر edge functions على الاستضافة الجديدة.
4) أعطني أوامر psql لاستيراد البيانات بأمان.`;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("تم النسخ ✓");
  };

  return (
    <Card className="p-6 space-y-4 border-info/30">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0">
          <Palette className="h-5 w-5 text-info" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold">ربط قاعدة البيانات بالاستضافة الجديدة</h2>
          <p className="text-sm text-muted-foreground">
            احفظ بيانات الاستضافة الجديدة هنا، اختبر الاتصال، ثم احصل على سكربت جاهز لنقل البيانات
            وتعليمات Lovable لإعادة الربط.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-sm font-semibold mb-1 block">مزود الاستضافة</label>
          <input
            value={cfg.hostingProvider}
            onChange={(e) => set("hostingProvider", e.target.value)}
            placeholder="Supabase Self-hosted / Hostinger / DigitalOcean…"
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm font-semibold mb-1 block">Supabase URL الجديد</label>
          <input
            value={cfg.newSupabaseUrl}
            onChange={(e) => set("newSupabaseUrl", e.target.value)}
            dir="ltr"
            placeholder="https://xxxx.supabase.co"
            className="w-full rounded-md border border-input bg-background p-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">Anon / Publishable Key</label>
          <input
            value={cfg.newAnonKey}
            onChange={(e) => set("newAnonKey", e.target.value)}
            dir="ltr"
            type="password"
            placeholder="eyJhbGciOi..."
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">Service Role Key (سري)</label>
          <input
            value={cfg.newServiceRoleKey}
            onChange={(e) => set("newServiceRoleKey", e.target.value)}
            dir="ltr"
            type="password"
            placeholder="eyJhbGciOi..."
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">DB URL القديم</label>
          <input
            value={cfg.oldDbUrl}
            onChange={(e) => set("oldDbUrl", e.target.value)}
            dir="ltr"
            type="password"
            placeholder="postgresql://..."
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-sm font-semibold mb-1 block">DB URL الجديد</label>
          <input
            value={cfg.newDbUrl}
            onChange={(e) => set("newDbUrl", e.target.value)}
            dir="ltr"
            type="password"
            placeholder="postgresql://..."
            className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>حفظ محلياً</Button>
        <Button variant="outline" onClick={testConnection} disabled={testing}>
          {testing ? "جارٍ الاختبار…" : "اختبار الاتصال"}
        </Button>
        {cfg.savedAt && (
          <span className="text-xs text-muted-foreground self-center">
            آخر حفظ: {new Date(cfg.savedAt).toLocaleString("en-GB")}
          </span>
        )}
      </div>

      {testMsg && (
        <div className={`text-sm p-2 rounded-md border ${testMsg.ok ? "bg-success/10 border-success/30 text-success" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
          {testMsg.msg}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Badge>سكربت نقل البيانات</Badge>
          <Button size="sm" variant="outline" onClick={() => copy(migrationScript)}>نسخ</Button>
        </div>
        <pre dir="ltr" className="text-xs bg-muted/40 p-3 rounded-md border whitespace-pre-wrap break-all max-h-64 overflow-auto">
          {migrationScript}
        </pre>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Badge className="bg-primary">تعليمات Lovable للنقل</Badge>
          <Button size="sm" variant="outline" onClick={() => copy(lovablePrompt)}>نسخ</Button>
        </div>
        <pre className="text-xs bg-muted/40 p-3 rounded-md border whitespace-pre-wrap break-words max-h-64 overflow-auto">
          {lovablePrompt}
        </pre>
      </div>

      <p className="text-xs text-muted-foreground">
        🔒 جميع المفاتيح تُخزَّن في متصفحك فقط (localStorage) ولا تُرسل لأي خادم.
      </p>
    </Card>
  );
}

