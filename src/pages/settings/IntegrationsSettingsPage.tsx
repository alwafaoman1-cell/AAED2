import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Mail,
  MessageCircle,
  Plug,
  Save,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getFunctionErrorMessage } from "@/lib/functionErrors";
import { toast } from "sonner";

type Provider = "twilio_whatsapp" | "meta_whatsapp" | "gmail";

interface IntegrationRow {
  provider: Provider;
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>;
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

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  isSecret: boolean;
}

const EMPTY = (provider: Provider): IntegrationRow => ({
  provider,
  enabled: false,
  config: {},
  secrets: {},
  hasSecrets: {},
});

const DEFAULT_EMAIL_STATUS: EmailProviderStatus = {
  configured: false,
  enabled: false,
  activeProvider: null,
  fromEmail: "",
  fromName: "",
  domain: "",
  maskedKey: null,
  lastTestAt: null,
  lastTestStatus: null,
  lastTestError: null,
  smtpStatus: "coming_soon",
};

export default function IntegrationsSettingsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailProviderStatus>(DEFAULT_EMAIL_STATUS);
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

  async function loadEmailProviderStatus(): Promise<EmailProviderStatus> {
    const { data: result, error } = await supabase.functions.invoke("save-email-provider", {
      body: { action: "status" },
    });
    if (error || result?.ok === false) {
      throw new Error(getFunctionErrorMessage(error, result));
    }
    return { ...DEFAULT_EMAIL_STATUS, ...(result.status as EmailProviderStatus) };
  }

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const { data: rows, error } = await supabase
        .from("tenant_integrations")
        .select("provider, enabled, config, secrets, last_test_at, last_test_status, last_test_error")
        .in("provider", ["twilio_whatsapp", "meta_whatsapp", "gmail"]);
      if (error) throw error;

      const next: Record<Provider, IntegrationRow> = {
        twilio_whatsapp: EMPTY("twilio_whatsapp"),
        meta_whatsapp: EMPTY("meta_whatsapp"),
        gmail: EMPTY("gmail"),
      };
      (rows || []).forEach((row: any) => {
        if (!["twilio_whatsapp", "meta_whatsapp", "gmail"].includes(row.provider)) return;
        const secrets = (row.secrets || {}) as Record<string, string>;
        next[row.provider as Provider] = {
          provider: row.provider,
          enabled: !!row.enabled,
          config: row.config || {},
          secrets: {},
          hasSecrets: Object.fromEntries(Object.keys(secrets).map((key) => [key, !!secrets[key]])),
          last_test_at: row.last_test_at,
          last_test_status: row.last_test_status,
          last_test_error: row.last_test_error,
        };
      });
      setData(next);

      try {
        const status = await loadEmailProviderStatus();
        setEmailStatus(status);
        setEmailForm({
          enabled: !!status.enabled,
          apiKey: "",
          fromEmail: status.fromEmail || "",
          fromName: status.fromName || "",
          domain: status.domain || "",
        });
      } catch (emailError: any) {
        setEmailStatus(DEFAULT_EMAIL_STATUS);
        setLoadError(emailError?.message || "تعذر تحميل حالة مزود البريد");
      }
    } catch (error: any) {
      setLoadError(error?.message || "تعذر تحميل إعدادات التكاملات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function update(provider: Provider, patch: Partial<IntegrationRow>) {
    setData((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
  }

  async function saveEmailProvider() {
    if (!canManageEmailProvider) {
      toast.error("إدارة مزود البريد متاحة للمالك أو Super Admin فقط");
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
      const status = { ...DEFAULT_EMAIL_STATUS, ...(result.status as EmailProviderStatus) };
      setEmailStatus(status);
      setEmailForm({
        enabled: !!status.enabled,
        apiKey: "",
        fromEmail: status.fromEmail || "",
        fromName: status.fromName || "",
        domain: status.domain || "",
      });
      toast.success("تم حفظ مزود البريد");
    } finally {
      setEmailBusy(false);
    }
  }

  async function testEmailProvider() {
    if (!canManageEmailProvider) {
      toast.error("إدارة مزود البريد متاحة للمالك أو Super Admin فقط");
      return;
    }
    setEmailTesting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("test-email-provider", {
        body: { provider: "resend_email" },
      });
      if (error || result?.ok === false) toast.error(getFunctionErrorMessage(error, result));
      else toast.success("Connected — تم إرسال رسالة اختبار إلى بريد المستخدم الحالي");
      const status = await loadEmailProviderStatus();
      setEmailStatus(status);
    } catch (error: any) {
      toast.error(error?.message || "تعذر اختبار مزود البريد");
    } finally {
      setEmailTesting(false);
    }
  }

  async function save(provider: Provider) {
    setSaving(provider);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("not_authenticated");
      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user.id)
        .single();
      if (profileError) throw profileError;

      const { data: current } = await supabase
        .from("tenant_integrations")
        .select("secrets")
        .eq("provider", provider)
        .maybeSingle();
      const mergedSecrets = { ...((current?.secrets || {}) as Record<string, string>) };
      Object.entries(data[provider].secrets).forEach(([key, value]) => {
        if (value && value.trim()) mergedSecrets[key] = value.trim();
      });

      const { error } = await supabase
        .from("tenant_integrations")
        .upsert({
          tenant_id: profileRow!.tenant_id,
          provider,
          enabled: data[provider].enabled,
          config: data[provider].config,
          secrets: mergedSecrets,
        }, { onConflict: "tenant_id,provider" });
      if (error) throw error;
      toast.success("تم الحفظ");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "فشل الحفظ");
    } finally {
      setSaving(null);
    }
  }

  async function test(provider: Provider) {
    setTesting(provider);
    try {
      const { data: result, error } = await supabase.functions.invoke("integration-test", { body: { provider } });
      if (error) throw error;
      if ((result as any)?.ok) toast.success("تم الاتصال بنجاح");
      else toast.error((result as any)?.error || (result as any)?.info || "فشل الاتصال");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "فشل الاختبار");
    } finally {
      setTesting(null);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">جارِ تحميل إعدادات التكاملات…</div>;

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

      {loadError && (
        <Card className="p-3 border-warning/30 bg-warning/10 text-sm">
          <b>تنبيه:</b> {loadError}
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        كل ورشة تُدخل بيانات مزوديها الخاصة. الأسرار لا تظهر بعد الحفظ ولا تُرسل مباشرة من الواجهة إلى المزود.
      </p>

      <Card className="p-4 space-y-4 border-primary/25">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h2 className="font-semibold flex items-center gap-2">
              <KeyRound size={18} className="text-primary" /> Email & OTP Provider
            </h2>
            <p className="text-xs text-muted-foreground">
              يستخدم OTP مزود البريد النشط لكل tenant أولًا، ثم fallback إلى أسرار الخادم إن وجدت.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {emailStatus.configured ? (
              <Badge variant="outline" className="border-success/40 text-success">Configured</Badge>
            ) : (
              <Badge variant="outline" className="border-destructive/40 text-destructive">Not Configured</Badge>
            )}
            {emailStatus.lastTestStatus === "success" && <Badge variant="outline" className="border-success/40 text-success">Connected</Badge>}
            {emailStatus.lastTestStatus === "failed" && <Badge variant="outline" className="border-destructive/40 text-destructive">Failed</Badge>}
          </div>
        </div>

        {!canManageEmailProvider && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            إدارة مزود البريد متاحة للمالك أو Super Admin فقط. يمكنك عرض الحالة دون تعديل الأسرار.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Resend API Key {emailStatus.maskedKey && <span className="text-success">({emailStatus.maskedKey})</span>}</Label>
            <Input
              dir="ltr"
              type="password"
              disabled={!canManageEmailProvider}
              value={emailForm.apiKey}
              placeholder={emailStatus.maskedKey ? "اتركه فارغًا للإبقاء على المفتاح الحالي" : "re_xxxxxxxxxxxxx"}
              onChange={(event) => setEmailForm((form) => ({ ...form, apiKey: event.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">From Email</Label>
            <Input
              dir="ltr"
              disabled={!canManageEmailProvider}
              value={emailForm.fromEmail}
              placeholder="otp@yourdomain.com"
              onChange={(event) => setEmailForm((form) => ({ ...form, fromEmail: event.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">From Name</Label>
            <Input
              disabled={!canManageEmailProvider}
              value={emailForm.fromName}
              placeholder="AAED2 Security"
              onChange={(event) => setEmailForm((form) => ({ ...form, fromName: event.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Domain</Label>
            <Input
              dir="ltr"
              disabled={!canManageEmailProvider}
              value={emailForm.domain}
              placeholder="yourdomain.com"
              onChange={(event) => setEmailForm((form) => ({ ...form, domain: event.target.value }))}
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
            onCheckedChange={(enabled) => setEmailForm((form) => ({ ...form, enabled }))}
          />
        </div>

        <div className="rounded-lg border border-muted bg-secondary/20 p-3 text-xs leading-6">
          <b>دليل Resend السريع:</b>
          <ol className="list-decimal pr-5 mt-1 space-y-1">
            <li>أنشئ حسابًا في Resend.</li>
            <li>أضف الدومين الخاص بك ووثّقه.</li>
            <li>أضف DNS records المطلوبة من Resend.</li>
            <li>أنشئ API Key يبدأ بـ <span dir="ltr">re_</span>.</li>
            <li>أدخل From Email من دومين موثق، ثم اضغط Test Connection.</li>
            <li>الدومين غير الموثق قد يمنع وصول الرسائل أو يرسلها إلى Spam.</li>
          </ol>
        </div>

        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          SMTP: Coming Soon — غير مفعّل الآن حتى يتم تنفيذه server-side بشكل آمن.
        </div>

        {emailStatus.lastTestAt && (
          <div className="text-[11px] text-muted-foreground">
            آخر اختبار: {new Date(emailStatus.lastTestAt).toLocaleString("en-GB")}
            {emailStatus.lastTestError ? ` — ${emailStatus.lastTestError}` : ""}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button onClick={saveEmailProvider} disabled={emailBusy || !canManageEmailProvider} className="gap-2">
            <Save size={14} /> {emailBusy ? "جارِ الحفظ…" : "حفظ مزود البريد"}
          </Button>
          <Button onClick={testEmailProvider} disabled={emailTesting || !canManageEmailProvider || !emailStatus.configured} variant="outline" className="gap-2">
            <Send size={14} /> {emailTesting ? "جارِ الاختبار…" : "Test Connection"}
          </Button>
        </div>
      </Card>

      <ProviderCard
        title="WhatsApp عبر Twilio"
        icon={<MessageCircle size={18} className="text-success" />}
        row={data.twilio_whatsapp}
        onToggle={(value) => update("twilio_whatsapp", { enabled: value })}
        onSave={() => save("twilio_whatsapp")}
        onTest={() => test("twilio_whatsapp")}
        saving={saving === "twilio_whatsapp"}
        testing={testing === "twilio_whatsapp"}
        helpUrl="https://console.twilio.com/"
        helpText="أنشئ حساب Twilio وفعّل WhatsApp Sender. الأسرار تبقى مخفية بعد الحفظ."
        fields={[
          { key: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxx", isSecret: false },
          { key: "from_number", label: "From WhatsApp Number", placeholder: "whatsapp:+14155238886", isSecret: false },
          { key: "auth_token", label: "Auth Token", placeholder: "********", isSecret: true },
        ]}
        onChange={(key, value, isSecret) => {
          const row = data.twilio_whatsapp;
          if (isSecret) update("twilio_whatsapp", { secrets: { ...row.secrets, [key]: value } });
          else update("twilio_whatsapp", { config: { ...row.config, [key]: value } });
        }}
      />

      <ProviderCard
        title="WhatsApp Cloud API (Meta)"
        icon={<MessageCircle size={18} className="text-primary" />}
        row={data.meta_whatsapp}
        onToggle={(value) => update("meta_whatsapp", { enabled: value })}
        onSave={() => save("meta_whatsapp")}
        onTest={() => test("meta_whatsapp")}
        saving={saving === "meta_whatsapp"}
        testing={testing === "meta_whatsapp"}
        helpUrl="https://developers.facebook.com/apps/"
        helpText="Meta App + WhatsApp Product + Phone Number ID + Permanent Access Token."
        fields={[
          { key: "phone_number_id", label: "Phone Number ID", placeholder: "123456789012345", isSecret: false },
          { key: "business_account_id", label: "WhatsApp Business Account ID (اختياري)", placeholder: "123456789012345", isSecret: false },
          { key: "access_token", label: "Permanent Access Token", placeholder: "EAAG...", isSecret: true },
        ]}
        onChange={(key, value, isSecret) => {
          const row = data.meta_whatsapp;
          if (isSecret) update("meta_whatsapp", { secrets: { ...row.secrets, [key]: value } });
          else update("meta_whatsapp", { config: { ...row.config, [key]: value } });
        }}
      />

      <ProviderCard
        title="Gmail (Google)"
        icon={<Mail size={18} className="text-destructive" />}
        row={data.gmail}
        onToggle={(value) => update("gmail", { enabled: value })}
        onSave={() => save("gmail")}
        onTest={() => test("gmail")}
        saving={saving === "gmail"}
        testing={testing === "gmail"}
        helpUrl="https://console.cloud.google.com/apis/credentials"
        helpText="Google Cloud OAuth Client مع refresh_token. إن لم يكن مضبوطًا استخدم Email Provider أعلاه."
        fields={[
          { key: "from_email", label: "البريد المرسل (From)", placeholder: "you@yourdomain.com", isSecret: false },
          { key: "client_id", label: "OAuth Client ID", placeholder: "xxxxx.apps.googleusercontent.com", isSecret: false },
          { key: "client_secret", label: "OAuth Client Secret", placeholder: "********", isSecret: true },
          { key: "refresh_token", label: "Refresh Token", placeholder: "1//0g...", isSecret: true },
        ]}
        onChange={(key, value, isSecret) => {
          const row = data.gmail;
          if (isSecret) update("gmail", { secrets: { ...row.secrets, [key]: value } });
          else update("gmail", { config: { ...row.config, [key]: value } });
        }}
      />

      <Card className="p-4 bg-warning/5 border-warning/30">
        <div className="flex items-start gap-2 text-xs">
          <ShieldAlert size={14} className="text-warning shrink-0 mt-0.5" />
          <div>
            <b>للأمان:</b> لا تُعرض الأسرار بعد حفظها. اترك حقل السر فارغًا للإبقاء على القيمة الحالية، أو أدخل قيمة جديدة لاستبدالها.
          </div>
        </div>
      </Card>
    </div>
  );
}

function ProviderCard(props: {
  title: string;
  icon: React.ReactNode;
  row: IntegrationRow;
  fields: FieldDef[];
  helpUrl: string;
  helpText: string;
  onToggle: (value: boolean) => void;
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
          فتح لوحة المزود <ExternalLink size={10} />
        </a>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {props.fields.map((field) => {
          const stored = field.isSecret ? row.hasSecrets[field.key] : !!row.config[field.key];
          const value = field.isSecret ? (row.secrets[field.key] ?? "") : (row.config[field.key] ?? "");
          return (
            <div key={field.key}>
              <Label className="text-xs">
                {field.label} {field.isSecret && stored && <span className="text-success">(محفوظ)</span>}
              </Label>
              <Input
                dir="ltr"
                type={field.isSecret ? "password" : "text"}
                value={value}
                placeholder={field.isSecret && stored ? "اتركه فارغًا للإبقاء على الحالي" : field.placeholder}
                onChange={(event) => props.onChange(field.key, event.target.value, field.isSecret)}
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
        <div className="text-[10px] text-muted-foreground">
          آخر اختبار: {new Date(row.last_test_at).toLocaleString("en-GB")}
        </div>
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
