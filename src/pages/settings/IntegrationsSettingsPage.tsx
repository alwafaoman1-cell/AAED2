import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plug, Save, Send, MessageCircle, Mail, ShieldAlert, ExternalLink, CheckCircle2, XCircle, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

type Provider = "twilio_whatsapp" | "meta_whatsapp" | "gmail";

interface IntegrationRow {
  provider: Provider;
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>; // write-only on UI; never displayed
  last_test_at?: string | null;
  last_test_status?: string | null;
  last_test_error?: string | null;
  hasSecrets: Record<string, boolean>;
}

interface EmailProviderStatus {
  configured: boolean;
  enabled: boolean;
  activeProvider: string | null;
  fromEmail: string;
  fromName: string;
  domain: string;
  maskedKey: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  smtpStatus: "coming_soon";
}

const EMPTY = (p: Provider): IntegrationRow => ({
  provider: p, enabled: false, config: {}, secrets: {}, hasSecrets: {},
});

export default function IntegrationsSettingsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailProviderStatus | null>(null);
  const [emailForm, setEmailForm] = useState({
    enabled: false,
    apiKey: "",
    fromEmail: "",
    fromName: "",
    domain: "",
  });
  const [data, setData] = useState<Record<Provider, IntegrationRow>>({
    twilio_whatsapp: EMPTY("twilio_whatsapp"),
    meta_whatsapp: EMPTY("meta_whatsapp"),
    gmail: EMPTY("gmail"),
  });
  const canManageEmailProvider =
    profile?.role === "admin" ||
    (profile?.role as string | undefined) === "owner" ||
    (profile?.role as string | undefined) === "super_admin" ||
    !!(profile as any)?.is_platform_admin;

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("tenant_integrations")
      .select("provider, enabled, config, secrets, last_test_at, last_test_status, last_test_error")
      .in("provider", ["twilio_whatsapp", "meta_whatsapp", "gmail"]);
    const next = {
      twilio_whatsapp: EMPTY("twilio_whatsapp"),
      meta_whatsapp: EMPTY("meta_whatsapp"),
      gmail: EMPTY("gmail"),
    };
    (rows || []).forEach((r: any) => {
      if (!["twilio_whatsapp","meta_whatsapp","gmail"].includes(r.provider)) return;
      const sec = (r.secrets || {}) as Record<string, string>;
      next[r.provider as Provider] = {
        provider: r.provider,
        enabled: !!r.enabled,
        config: r.config || {},
        secrets: {},
        hasSecrets: Object.fromEntries(Object.keys(sec).map((k) => [k, !!sec[k]])),
        last_test_at: r.last_test_at,
        last_test_status: r.last_test_status,
        last_test_error: r.last_test_error,
      };
    });
    setData(next);
    await loadEmailProviderStatus();
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function loadEmailProviderStatus() {
    const { data: result, error } = await supabase.functions.invoke("save-email-provider", {
      body: { action: "status" },
    });
    if (error || result?.ok === false) {
      toast.error(getFunctionErrorMessage(error, result));
      return;
    }
    const status = result.status as EmailProviderStatus;
    setEmailStatus(status);
    setEmailForm({
      enabled: !!status.enabled,
      apiKey: "",
      fromEmail: status.fromEmail || "",
      fromName: status.fromName || "",
      domain: status.domain || "",
    });
  }

  async function saveEmailProvider() {
    if (!canManageEmailProvider) {
      toast.error("هذه الإعدادات متاحة للمالك أو Super Admin فقط");
      return;
    }
    setEmailBusy(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("save-email-provider", {
        body: { action: "save", ...emailForm },
      });
      if (error || result?.ok === false) {
        toast.error(getFunctionErrorMessage(error, result));
        return;
      }
      toast.success("تم حفظ مزود البريد");
      const status = result.status as EmailProviderStatus;
      setEmailStatus(status);
      setEmailForm({
        enabled: !!status.enabled,
        apiKey: "",
        fromEmail: status.fromEmail || "",
        fromName: status.fromName || "",
        domain: status.domain || "",
      });
    } finally {
      setEmailBusy(false);
    }
  }

  async function testEmailProvider() {
    if (!canManageEmailProvider) {
      toast.error("هذه الإعدادات متاحة للمالك أو Super Admin فقط");
      return;
    }
    setEmailTesting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("test-email-provider", {
        body: { provider: "resend_email" },
      });
      if (error || result?.ok === false) {
        toast.error(getFunctionErrorMessage(error, result));
      } else {
        toast.success("Connected — تم إرسال رسالة اختبار إلى بريد المستخدم الحالي");
      }
      await loadEmailProviderStatus();
    } finally {
      setEmailTesting(false);
    }
  }

  function update(p: Provider, patch: Partial<IntegrationRow>) {
    setData((d) => ({ ...d, [p]: { ...d[p], ...patch } }));
  }

  async function save(p: Provider) {
    setSaving(p);
    try {
      const { data: prof } = await supabase
        .from("profiles").select("tenant_id")
        .eq("user_id", (await supabase.auth.getUser()).data.user!.id).single();

      // Merge: only write secret keys with non-empty values; otherwise keep existing
      const { data: cur } = await supabase
        .from("tenant_integrations").select("secrets").eq("provider", p).maybeSingle();
      const existing = (cur?.secrets || {}) as Record<string, string>;
      const newSecrets = { ...existing };
      Object.entries(data[p].secrets).forEach(([k, v]) => { if (v && v.trim()) newSecrets[k] = v.trim(); });

      const { error } = await supabase
        .from("tenant_integrations")
        .upsert({
          tenant_id: prof!.tenant_id,
          provider: p,
          enabled: data[p].enabled,
          config: data[p].config,
          secrets: newSecrets,
        }, { onConflict: "tenant_id,provider" });
      if (error) throw error;
      toast.success("تم الحفظ");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(null);
    }
  }

  async function test(p: Provider) {
    setTesting(p);
    try {
      const { data: r, error } = await supabase.functions.invoke("integration-test", { body: { provider: p } });
      if (error) throw error;
      if ((r as any)?.ok) toast.success("✅ " + ((r as any).info || "نجح الاتصال"));
      else toast.error("❌ " + ((r as any)?.error || (r as any)?.info || "فشل الاتصال"));
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل الاختبار");
    } finally {
      setTesting(null);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">جارِ التحميل…</div>;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ArrowRight size={14} className="ml-1" /> الإعدادات</Link>
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Plug size={20} className="text-primary" /> التكاملات والمزامنة
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        كل ورشة تُدخل بياناتها الخاصة لمزوّداتها (Twilio / Meta WhatsApp / Gmail). البيانات معزولة بين المستأجرين.
      </p>

      <Card className="p-4 space-y-4 border-primary/25">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h2 className="font-semibold flex items-center gap-2">
              <KeyRound size={18} className="text-primary" /> Email & OTP Provider
            </h2>
            <p className="text-xs text-muted-foreground">
              يستخدم OTP مزود البريد النشط لكل ورشة أولًا، ثم fallback إلى secrets الخادم إن وجدت.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {emailStatus?.configured ? (
              <Badge variant="outline" className="border-success/40 text-success">Configured</Badge>
            ) : (
              <Badge variant="outline" className="border-destructive/40 text-destructive">Not Configured</Badge>
            )}
            {emailStatus?.lastTestStatus === "success" && <Badge variant="outline" className="border-success/40 text-success">Connected</Badge>}
            {emailStatus?.lastTestStatus === "failed" && <Badge variant="outline" className="border-destructive/40 text-destructive">Failed</Badge>}
          </div>
        </div>

        {!canManageEmailProvider && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            إدارة مزود البريد متاحة للمالك أو Super Admin فقط. يمكنك عرض الحالة دون تعديل الأسرار.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Resend API Key {emailStatus?.maskedKey && <span className="text-success">({emailStatus.maskedKey})</span>}</Label>
            <Input
              dir="ltr"
              type="password"
              disabled={!canManageEmailProvider}
              value={emailForm.apiKey}
              placeholder={emailStatus?.maskedKey ? "اتركه فارغاً للإبقاء على المفتاح الحالي" : "re_xxxxxxxxxxxxx"}
              onChange={(e) => setEmailForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">From Email</Label>
            <Input
              dir="ltr"
              disabled={!canManageEmailProvider}
              value={emailForm.fromEmail}
              placeholder="otp@yourdomain.com"
              onChange={(e) => setEmailForm((f) => ({ ...f, fromEmail: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">From Name</Label>
            <Input
              disabled={!canManageEmailProvider}
              value={emailForm.fromName}
              placeholder="AAED2 Security"
              onChange={(e) => setEmailForm((f) => ({ ...f, fromName: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Domain</Label>
            <Input
              dir="ltr"
              disabled={!canManageEmailProvider}
              value={emailForm.domain}
              placeholder="yourdomain.com"
              onChange={(e) => setEmailForm((f) => ({ ...f, domain: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div>
            <div className="text-sm font-medium">Active / Disabled</div>
            <div className="text-xs text-muted-foreground">مزود واحد فقط يكون نشطًا لكل tenant.</div>
          </div>
          <Switch
            checked={emailForm.enabled}
            disabled={!canManageEmailProvider}
            onCheckedChange={(enabled) => setEmailForm((f) => ({ ...f, enabled }))}
          />
        </div>

        <div className="rounded-lg border border-muted bg-secondary/20 p-3 text-xs leading-6">
          <b>دليل Resend السريع:</b>
          <ol className="list-decimal pr-5 mt-1 space-y-1">
            <li>أنشئ حسابًا في Resend.</li>
            <li>أضف الدومين الخاص بك ووثّقه.</li>
            <li>أضف DNS records المطلوبة من Resend في مزود الدومين.</li>
            <li>أنشئ API Key يبدأ بـ <span dir="ltr">re_</span>.</li>
            <li>أدخل From Email من دومين موثق، ثم اضغط Test Connection.</li>
            <li>الدومين غير الموثق قد يمنع وصول الرسائل أو يرسلها إلى Spam.</li>
          </ol>
        </div>

        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          SMTP: Coming Soon — غير مفعّل الآن حتى يتم تنفيذه server-side بشكل آمن.
        </div>

        {emailStatus?.lastTestAt && (
          <div className="text-[11px] text-muted-foreground">
            آخر اختبار: {new Date(emailStatus.lastTestAt).toLocaleString("en-GB")}
            {emailStatus.lastTestError ? ` — ${emailStatus.lastTestError}` : ""}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button onClick={saveEmailProvider} disabled={emailBusy || !canManageEmailProvider} className="gap-2">
            <Save size={14} /> {emailBusy ? "جارِ الحفظ…" : "حفظ مزود البريد"}
          </Button>
          <Button onClick={testEmailProvider} disabled={emailTesting || !canManageEmailProvider || !emailStatus?.configured} variant="outline" className="gap-2">
            <Send size={14} /> {emailTesting ? "جارِ الاختبار…" : "Test Connection"}
          </Button>
        </div>
      </Card>

      {/* Twilio WhatsApp */}
      <ProviderCard
        title="WhatsApp عبر Twilio"
        icon={<MessageCircle size={18} className="text-success" />}
        row={data.twilio_whatsapp}
        onToggle={(v) => update("twilio_whatsapp", { enabled: v })}
        onSave={() => save("twilio_whatsapp")}
        onTest={() => test("twilio_whatsapp")}
        saving={saving === "twilio_whatsapp"}
        testing={testing === "twilio_whatsapp"}
        helpUrl="https://console.twilio.com/"
        helpText="أنشئ حساب Twilio + فعّل WhatsApp Sender (Sandbox مجاناً للتجربة)."
        fields={[
          { key: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxx", isSecret: false },
          { key: "from_number", label: "From WhatsApp Number", placeholder: "whatsapp:+14155238886", isSecret: false },
          { key: "auth_token", label: "Auth Token", placeholder: "********", isSecret: true },
        ]}
        onChange={(k, v, isSecret) => {
          const r = data.twilio_whatsapp;
          if (isSecret) update("twilio_whatsapp", { secrets: { ...r.secrets, [k]: v } });
          else update("twilio_whatsapp", { config: { ...r.config, [k]: v } });
        }}
      />

      {/* Meta WhatsApp Cloud */}
      <ProviderCard
        title="WhatsApp Cloud API (Meta)"
        icon={<MessageCircle size={18} className="text-primary" />}
        row={data.meta_whatsapp}
        onToggle={(v) => update("meta_whatsapp", { enabled: v })}
        onSave={() => save("meta_whatsapp")}
        onTest={() => test("meta_whatsapp")}
        saving={saving === "meta_whatsapp"}
        testing={testing === "meta_whatsapp"}
        helpUrl="https://developers.facebook.com/apps/"
        helpText="أنشئ تطبيق Meta + WhatsApp Product → Phone Number ID + Permanent Access Token."
        fields={[
          { key: "phone_number_id", label: "Phone Number ID", placeholder: "123456789012345", isSecret: false },
          { key: "business_account_id", label: "WhatsApp Business Account ID (اختياري)", placeholder: "123456789012345", isSecret: false },
          { key: "access_token", label: "Permanent Access Token", placeholder: "EAAG...", isSecret: true },
        ]}
        onChange={(k, v, isSecret) => {
          const r = data.meta_whatsapp;
          if (isSecret) update("meta_whatsapp", { secrets: { ...r.secrets, [k]: v } });
          else update("meta_whatsapp", { config: { ...r.config, [k]: v } });
        }}
      />

      {/* Gmail */}
      <ProviderCard
        title="Gmail (Google)"
        icon={<Mail size={18} className="text-destructive" />}
        row={data.gmail}
        onToggle={(v) => update("gmail", { enabled: v })}
        onSave={() => save("gmail")}
        onTest={() => test("gmail")}
        saving={saving === "gmail"}
        testing={testing === "gmail"}
        helpUrl="https://console.cloud.google.com/apis/credentials"
        helpText="Google Cloud → OAuth Client (Desktop/Web) + اطلب scope https://www.googleapis.com/auth/gmail.send، ثم احصل على refresh_token عبر OAuth Playground."
        fields={[
          { key: "from_email", label: "البريد المرسل (From)", placeholder: "you@yourdomain.com", isSecret: false },
          { key: "client_id", label: "OAuth Client ID", placeholder: "xxxxx.apps.googleusercontent.com", isSecret: false },
          { key: "client_secret", label: "OAuth Client Secret", placeholder: "********", isSecret: true },
          { key: "refresh_token", label: "Refresh Token", placeholder: "1//0g...", isSecret: true },
        ]}
        onChange={(k, v, isSecret) => {
          const r = data.gmail;
          if (isSecret) update("gmail", { secrets: { ...r.secrets, [k]: v } });
          else update("gmail", { config: { ...r.config, [k]: v } });
        }}
      />

      <Card className="p-4 bg-warning/5 border-warning/30">
        <div className="flex items-start gap-2 text-xs">
          <ShieldAlert size={14} className="text-warning shrink-0 mt-0.5" />
          <div>
            <b>للأمان:</b> لا تُعرض الأسرار بعد حفظها. اترك الحقل فارغاً للإبقاء على القيمة الحالية، أو أدخل قيمة جديدة لاستبدالها.
          </div>
        </div>
      </Card>
    </div>
  );
}

interface FieldDef { key: string; label: string; placeholder?: string; isSecret: boolean; }

function ProviderCard(props: {
  title: string;
  icon: React.ReactNode;
  row: IntegrationRow;
  fields: FieldDef[];
  helpUrl: string;
  helpText: string;
  onToggle: (v: boolean) => void;
  onChange: (key: string, value: string, isSecret: boolean) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
}) {
  const { row } = props;
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {props.icon}
          <h2 className="font-semibold">{props.title}</h2>
          {row.last_test_status === "success" && (
            <Badge variant="outline" className="border-success/40 text-success gap-1">
              <CheckCircle2 size={11} /> متصل
            </Badge>
          )}
          {row.last_test_status === "failed" && (
            <Badge variant="outline" className="border-destructive/40 text-destructive gap-1">
              <XCircle size={11} /> فشل
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">تفعيل</Label>
          <Switch checked={row.enabled} onCheckedChange={props.onToggle} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {props.helpText}
        <a href={props.helpUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5 text-primary">
          فتح الكونسول <ExternalLink size={10} />
        </a>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {props.fields.map((f) => {
          const stored = f.isSecret ? row.hasSecrets[f.key] : !!row.config[f.key];
          const value = f.isSecret ? (row.secrets[f.key] ?? "") : (row.config[f.key] ?? "");
          return (
            <div key={f.key}>
              <Label className="text-xs">
                {f.label} {f.isSecret && stored && <span className="text-success">(محفوظ)</span>}
              </Label>
              <Input
                dir="ltr"
                type={f.isSecret ? "password" : "text"}
                value={value}
                placeholder={f.isSecret && stored ? "اتركه فارغاً للإبقاء على الحالي" : f.placeholder}
                onChange={(e) => props.onChange(f.key, e.target.value, f.isSecret)}
              />
            </div>
          );
        })}
      </div>

      {row.last_test_error && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
          آخر خطأ: {row.last_test_error}
        </div>
      )}
      {row.last_test_at && (
        <div className="text-[10px] text-muted-foreground">آخر اختبار: {new Date(row.last_test_at).toLocaleString("en-GB")}</div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button onClick={props.onSave} disabled={props.saving} className="gap-2">
          <Save size={14} /> {props.saving ? "جارِ الحفظ…" : "حفظ"}
        </Button>
        <Button onClick={props.onTest} disabled={props.testing} variant="outline" className="gap-2">
          <Send size={14} /> {props.testing ? "جارِ الاختبار…" : "اختبار الاتصال"}
        </Button>
      </div>
    </Card>
  );
}
