import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Key, CheckCircle2, AlertTriangle, ExternalLink, Loader2, Copy, Save, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

type AiProvider = "openai" | "gemini" | "anthropic" | "custom";

type ProviderUiState = {
  configured: boolean;
  enabled: boolean;
  maskedKey: string | null;
  model: string;
  baseUrl: string;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
};

type ProviderStatus = {
  activeProvider: AiProvider | "none";
  providers: Record<AiProvider, ProviderUiState>;
  fallback?: Record<string, boolean>;
};

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-3-5-haiku-latest",
  custom: "",
};

const PROVIDER_META: Record<AiProvider, { name: string; url: string; note: string; keyHint: string }> = {
  openai: {
    name: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    note: "مناسب للكتابة، الترجمة، OCR، واستخراج البيانات.",
    keyHint: "sk-...",
  },
  gemini: {
    name: "Google Gemini",
    url: "https://aistudio.google.com/apikey",
    note: "بديل اقتصادي ويدعم الرؤية واستخراج البيانات.",
    keyHint: "AIza...",
  },
  anthropic: {
    name: "Anthropic Claude",
    url: "https://console.anthropic.com/settings/keys",
    note: "مناسب للكتابة والتحليل، ويدعم الرؤية عبر دوال الخادم.",
    keyHint: "sk-ant-...",
  },
  custom: {
    name: "Custom OpenAI-compatible",
    url: "https://platform.openai.com/docs/api-reference/chat",
    note: "مزود مخصص متوافق مع Chat Completions.",
    keyHint: "API Key",
  },
};

const emptyProvider: ProviderUiState = {
  configured: false,
  enabled: false,
  maskedKey: null,
  model: "",
  baseUrl: "",
  lastTestAt: null,
  lastTestStatus: null,
  lastTestError: null,
};

export default function AiKeysSettingsPage() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [selected, setSelected] = useState<AiProvider>("openai");
  const [form, setForm] = useState({
    enabled: false,
    apiKey: "",
    model: DEFAULT_MODELS.openai,
    baseUrl: "",
  });

  const canManage =
    profile?.role === "admin" ||
    (profile?.role as string | undefined) === "owner" ||
    (profile?.role as string | undefined) === "super_admin" ||
    !!(profile as any)?.is_platform_admin;

  const providerState = status?.providers?.[selected] || emptyProvider;
  const active = status?.activeProvider || "none";

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-provider-status");
      if (error) throw error;
      if (!data?.ok && data?.error) throw new Error(getFunctionErrorMessage(data.error));
      const next = data as ProviderStatus & { ok?: boolean };
      setStatus({
        activeProvider: next.activeProvider || "none",
        providers: {
          openai: next.providers?.openai || emptyProvider,
          gemini: next.providers?.gemini || emptyProvider,
          anthropic: next.providers?.anthropic || emptyProvider,
          custom: next.providers?.custom || emptyProvider,
        },
        fallback: next.fallback,
      });
    } catch (e: any) {
      toast.error(e?.message || "تعذر قراءة حالة مزود AI");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const current = status?.providers?.[selected] || emptyProvider;
    setForm({
      enabled: current.enabled,
      apiKey: "",
      model: current.model || DEFAULT_MODELS[selected],
      baseUrl: current.baseUrl || "",
    });
  }, [selected, status]);

  const selectedMeta = PROVIDER_META[selected];
  const configuredCount = useMemo(
    () => status ? Object.values(status.providers).filter((p) => p.configured).length : 0,
    [status],
  );

  async function saveProvider() {
    if (!canManage) return toast.error("ليست لديك صلاحية إدارة مفاتيح AI");
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("save-ai-provider", {
        body: {
          action: "save",
          provider: selected,
          enabled: form.enabled,
          apiKey: form.apiKey.trim(),
          model: form.model.trim() || DEFAULT_MODELS[selected],
          baseUrl: form.baseUrl.trim(),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(getFunctionErrorMessage(data?.error || data?.message || "server_function_failed"));
      toast.success("تم حفظ مزود الذكاء الاصطناعي");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "تعذر حفظ مزود AI");
    } finally {
      setSaving(false);
    }
  }

  async function testProvider() {
    if (!canManage) return toast.error("ليست لديك صلاحية اختبار مفاتيح AI");
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-ai-provider", {
        body: { provider: selected },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || "Failed");
      toast.success("Connected");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
      await load();
    } finally {
      setTesting(false);
    }
  }

  if (!canManage) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 text-warning" size={32} />
        <p>هذه الصفحة متاحة للـ Owner / Super Admin فقط.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Key className="text-primary" /> مفاتيح الذكاء الاصطناعي (AI Keys)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          إدارة مفاتيح AI لكل ورشة / tenant من الخادم فقط. لا يتم كشف المفتاح للواجهة بعد الحفظ.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">الحالة الحالية</h2>
            <p className="text-xs text-muted-foreground">
              المزود النشط: {active === "none" ? "غير مهيأ" : PROVIDER_META[active]?.name}
              {" "}• مزودات محفوظة: {configuredCount}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1">
            {loading && <Loader2 className="animate-spin" size={14} />} تحديث
          </Button>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" size={16} /> جاري الفحص…
          </div>
        ) : active === "none" ? (
          <div className="mt-4 bg-warning/10 border border-warning/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="text-warning shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-medium">لا يوجد مزود AI نشط لهذا tenant</div>
              <div className="text-sm text-muted-foreground mt-1">
                دوال AI ستستخدم fallback server secrets إن وجدت، وإلا ستعرض رسالة واضحة.
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 bg-success/10 border border-success/30 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="text-success shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-medium text-success">{PROVIDER_META[active].name} نشط لهذا tenant</div>
              <div className="text-sm text-muted-foreground mt-1">الطلبات تذهب عبر Edge Functions فقط.</div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-4">المزودون</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(PROVIDER_META) as AiProvider[]).map((provider) => {
            const meta = PROVIDER_META[provider];
            const p = status?.providers?.[provider] || emptyProvider;
            const isSelected = selected === provider;
            return (
              <button
                key={provider}
                type="button"
                onClick={() => setSelected(provider)}
                className={`text-start rounded-lg border p-4 transition ${isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{meta.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{meta.note}</div>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {active === provider && <Badge className="bg-success text-success-foreground">Active</Badge>}
                    {p.configured ? <Badge variant="outline">Configured</Badge> : <Badge variant="outline">Not Configured</Badge>}
                  </div>
                </div>
                {p.maskedKey && <div className="mt-3 text-xs font-mono text-muted-foreground" dir="ltr">{p.maskedKey}</div>}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">إعداد {selectedMeta.name}</h2>
            <p className="text-xs text-muted-foreground">المفتاح لا يعود للواجهة بعد الحفظ؛ سيظهر masked فقط.</p>
          </div>
          <a href={selectedMeta.url} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm" className="gap-1">
              <ExternalLink size={14} /> الحصول على مفتاح
            </Button>
          </a>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={form.apiKey}
              placeholder={providerState.maskedKey || selectedMeta.keyHint}
              dir="ltr"
              autoComplete="new-password"
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
            {providerState.maskedKey && <p className="text-[11px] text-muted-foreground">Current: <span dir="ltr">{providerState.maskedKey}</span></p>}
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              value={form.model}
              placeholder={DEFAULT_MODELS[selected] || "model-name"}
              dir="ltr"
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </div>
          {selected === "custom" && (
            <div className="space-y-2 md:col-span-2">
              <Label>Base URL</Label>
              <Input
                value={form.baseUrl}
                placeholder="https://provider.example.com/v1/chat/completions"
                dir="ltr"
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div>
            <div className="text-sm font-medium">Active / Disabled</div>
            <div className="text-xs text-muted-foreground">مزود واحد فقط يكون نشطًا لكل tenant.</div>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))} />
        </div>

        {providerState.lastTestAt && (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs">
            آخر اختبار: {new Date(providerState.lastTestAt).toLocaleString("en-GB")}
            {" "}• الحالة: {providerState.lastTestStatus || "-"}
            {providerState.lastTestError ? <div className="mt-1 text-destructive break-words">{providerState.lastTestError}</div> : null}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button onClick={saveProvider} disabled={saving} className="gap-2">
            <Save size={14} /> {saving ? "جارِ الحفظ…" : "حفظ المزود"}
          </Button>
          <Button onClick={testProvider} disabled={testing || !providerState.configured} variant="outline" className="gap-2">
            <Send size={14} /> {testing ? "جارِ الاختبار…" : "Test Connection"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 text-xs leading-6 text-muted-foreground">
        <div className="font-semibold text-foreground mb-2">ملاحظات أمان</div>
        <ul className="list-disc pr-5 space-y-1">
          <li>لا يتم حفظ المفاتيح في LocalStorage ولا يتم إرسالها مباشرة من الواجهة إلى مزود AI.</li>
          <li>الحفظ والاختبار والاستدعاء تتم عبر Edge Functions فقط.</li>
          <li>تفعيل مزود جديد يعطّل باقي مزودات AI لهذا tenant تلقائيًا.</li>
          <li>
            أسماء الأسرار العامة fallback إن احتجتها:{" "}
            {["LOVABLE_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"].map((key) => (
              <button
                key={key}
                type="button"
                className="mx-1 inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono"
                onClick={() => { void navigator.clipboard.writeText(key); toast.success("تم النسخ"); }}
              >
                {key} <Copy size={10} />
              </button>
            ))}
          </li>
        </ul>
      </Card>
    </div>
  );
}
