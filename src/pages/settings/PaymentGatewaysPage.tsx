import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, CreditCard, Save, Send, ExternalLink, ShieldAlert, CheckCircle2, XCircle, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Gateway = "stripe" | "thawani" | "myfatoorah" | "paytabs" | "tap";
const PROVIDERS: Gateway[] = ["stripe", "thawani", "myfatoorah", "paytabs", "tap"];

const META: Record<Gateway, {
  title: string; subtitle: string; helpUrl: string; helpText: string;
  config: { key: string; label: string; placeholder?: string; options?: string[] }[];
  secrets: { key: string; label: string; placeholder?: string }[];
}> = {
  stripe: {
    title: "Stripe", subtitle: "عالمي · Apple Pay · Google Pay · Visa/Mastercard",
    helpUrl: "https://dashboard.stripe.com/apikeys",
    helpText: "Dashboard → Developers → API keys",
    config: [],
    secrets: [{ key: "secret_key", label: "Secret Key (sk_live_… أو sk_test_…)", placeholder: "sk_live_..." }],
  },
  thawani: {
    title: "Thawani (عُمان)", subtitle: "الأنسب محلياً — KNET/Visa/Mastercard/Apple Pay",
    helpUrl: "https://merchant.thawani.om/",
    helpText: "Merchant Portal → Developer → API Keys",
    config: [
      { key: "publishable_key", label: "Publishable Key", placeholder: "HGvTMLDssJghr9tlN9gr..." },
      { key: "environment", label: "البيئة", options: ["test", "live"] },
    ],
    secrets: [{ key: "secret_key", label: "Secret Key", placeholder: "rRQ26GcsZzoEhbrP..." }],
  },
  myfatoorah: {
    title: "MyFatoorah", subtitle: "خليجي — KNET · BENEFIT · بطاقات · Apple Pay",
    helpUrl: "https://portal.myfatoorah.com/",
    helpText: "Portal → Integration Settings → API Token",
    config: [
      { key: "region", label: "المنطقة", options: ["sa", "kw", "ae", "eg", "om", "qa", "bh", "jo"] },
      { key: "environment", label: "البيئة", options: ["test", "live"] },
    ],
    secrets: [{ key: "api_token", label: "API Token", placeholder: "rLtt6JWvbUHDDhsZnfpAH..." }],
  },
  paytabs: {
    title: "PayTabs", subtitle: "خليجي/مصر — بطاقات · Apple Pay · STC Pay",
    helpUrl: "https://merchant.paytabs.com/",
    helpText: "Merchant Dashboard → Developers → Profile ID + Server Key",
    config: [
      { key: "profile_id", label: "Profile ID", placeholder: "12345" },
      { key: "region", label: "المنطقة", options: ["ARE","SAU","OMN","EGY","JOR","IRQ","GLOBAL"] },
    ],
    secrets: [{ key: "server_key", label: "Server Key", placeholder: "SXJxxx..." }],
  },
  tap: {
    title: "Tap Payments", subtitle: "خليجي — BENEFIT · KNET · Apple Pay · بطاقات",
    helpUrl: "https://www.tap.company/",
    helpText: "Dashboard → Developers → API Credentials",
    config: [],
    secrets: [{ key: "secret_key", label: "Secret API Key", placeholder: "sk_live_..." }],
  },
};

interface Row {
  enabled: boolean;
  is_default: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>; // write only
  hasSecrets: Record<string, boolean>;
  last_test_status?: string | null;
  last_test_error?: string | null;
}
const EMPTY = (): Row => ({ enabled: false, is_default: false, config: {}, secrets: {}, hasSecrets: {} });

export default function PaymentGatewaysPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Gateway | null>(null);
  const [data, setData] = useState<Record<Gateway, Row>>(
    Object.fromEntries(PROVIDERS.map((p) => [p, EMPTY()])) as any,
  );

  async function load() {
    setLoading(true);
    const providers = PROVIDERS.map((p) => `pg_${p}`);
    const { data: rows } = await supabase
      .from("tenant_integrations")
      .select("provider, enabled, config, secrets, last_test_status, last_test_error")
      .in("provider", providers);
    const next: Record<Gateway, Row> = Object.fromEntries(PROVIDERS.map((p) => [p, EMPTY()])) as any;
    (rows || []).forEach((r: any) => {
      const key = r.provider.replace(/^pg_/, "") as Gateway;
      if (!PROVIDERS.includes(key)) return;
      const sec = (r.secrets || {}) as Record<string, string>;
      next[key] = {
        enabled: !!r.enabled,
        is_default: !!(r.config?.is_default),
        config: r.config || {},
        secrets: {},
        hasSecrets: Object.fromEntries(Object.keys(sec).map((k) => [k, !!sec[k]])),
        last_test_status: r.last_test_status,
        last_test_error: r.last_test_error,
      };
    });
    setData(next);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function update(g: Gateway, patch: Partial<Row>) {
    setData((d) => ({ ...d, [g]: { ...d[g], ...patch } }));
  }

  async function save(g: Gateway) {
    setSaving(g);
    try {
      const { data: prof } = await supabase.from("profiles").select("tenant_id")
        .eq("user_id", (await supabase.auth.getUser()).data.user!.id).single();
      const provider = `pg_${g}`;
      const { data: cur } = await supabase.from("tenant_integrations").select("secrets")
        .eq("provider", provider).maybeSingle();
      const existing = (cur?.secrets || {}) as Record<string, string>;
      const newSecrets = { ...existing };
      Object.entries(data[g].secrets).forEach(([k, v]) => { if (v && v.trim()) newSecrets[k] = v.trim(); });

      // If marking this as default, unmark others
      if (data[g].is_default) {
        for (const other of PROVIDERS) {
          if (other === g) continue;
          if (data[other].is_default) {
            await supabase.from("tenant_integrations").update({ config: { ...data[other].config, is_default: false } })
              .eq("provider", `pg_${other}`);
          }
        }
      }

      const finalConfig = { ...data[g].config, is_default: data[g].is_default };
      const { error } = await supabase.from("tenant_integrations").upsert({
        tenant_id: prof!.tenant_id, provider, enabled: data[g].enabled,
        config: finalConfig, secrets: newSecrets,
      }, { onConflict: "tenant_id,provider" });
      if (error) throw error;
      toast.success("تم الحفظ");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setSaving(null); }
  }

  if (loading) return <div className="p-6 text-muted-foreground">جارِ التحميل…</div>;

  const enabledCount = PROVIDERS.filter((p) => data[p].enabled).length;
  const hasDefault = PROVIDERS.some((p) => data[p].is_default && data[p].enabled);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ArrowRight size={14} className="ml-1" /> الإعدادات</Link>
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <CreditCard size={20} className="text-primary" /> بوابات الدفع الإلكتروني
        </h1>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/30">
        <div className="text-sm space-y-1">
          <div>✅ <b>{enabledCount}</b> بوابة مفعّلة من أصل {PROVIDERS.length}</div>
          {!hasDefault && enabledCount > 0 && (
            <div className="text-warning text-xs">⚠️ لم تُحدد بوابة افتراضية — اختر واحدة كافتراضية حتى يظهر زر "إنشاء رابط دفع" تلقائياً.</div>
          )}
          {hasDefault && (
            <div className="text-success text-xs">
              ⭐ الافتراضية: {META[PROVIDERS.find((p) => data[p].is_default)!].title}
            </div>
          )}
        </div>
      </Card>

      {PROVIDERS.map((g) => (
        <GatewayCard
          key={g} gateway={g} meta={META[g]} row={data[g]}
          onChange={(patch) => update(g, patch)}
          onConfigChange={(k, v) => update(g, { config: { ...data[g].config, [k]: v } })}
          onSecretChange={(k, v) => update(g, { secrets: { ...data[g].secrets, [k]: v } })}
          onSave={() => save(g)}
          saving={saving === g}
        />
      ))}

      <Card className="p-4 bg-warning/5 border-warning/30">
        <div className="flex items-start gap-2 text-xs">
          <ShieldAlert size={14} className="text-warning shrink-0 mt-0.5" />
          <div>
            <b>أمان:</b> الأسرار لا تُعرض بعد الحفظ. لاستلام إشعارات الدفع، أضف رابط Webhook في لوحة كل بوابة:
            <code className="block mt-1 ltr text-[10px] bg-card p-1 rounded">
              {`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-webhook?gateway=<اسم_البوابة>`}
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}

function GatewayCard(props: {
  gateway: Gateway;
  meta: typeof META[Gateway];
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  onConfigChange: (k: string, v: string) => void;
  onSecretChange: (k: string, v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { row, meta } = props;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <CreditCard size={16} className="text-primary" /> {meta.title}
            {row.is_default && row.enabled && (
              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1"><Star size={10} /> افتراضية</Badge>
            )}
            {row.last_test_status === "success" && <CheckCircle2 size={14} className="text-success" />}
            {row.last_test_status === "failed" && <XCircle size={14} className="text-destructive" />}
          </h2>
          <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">افتراضية</Label>
            <Switch checked={row.is_default} onCheckedChange={(v) => props.onChange({ is_default: v })} disabled={!row.enabled} />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">تفعيل</Label>
            <Switch checked={row.enabled} onCheckedChange={(v) => props.onChange({ enabled: v })} />
          </div>
        </div>
      </div>

      <a href={meta.helpUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 underline">
        {meta.helpText} <ExternalLink size={10} />
      </a>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {meta.config.map((f) => (
          <div key={f.key}>
            <Label className="text-xs">{f.label}</Label>
            {f.options ? (
              <Select value={row.config[f.key] || f.options[0]} onValueChange={(v) => props.onConfigChange(f.key, v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input dir="ltr" value={row.config[f.key] || ""} placeholder={f.placeholder}
                onChange={(e) => props.onConfigChange(f.key, e.target.value)} />
            )}
          </div>
        ))}
        {meta.secrets.map((f) => {
          const stored = row.hasSecrets[f.key];
          return (
            <div key={f.key}>
              <Label className="text-xs">{f.label} {stored && <span className="text-success">(محفوظ)</span>}</Label>
              <Input dir="ltr" type="password" value={row.secrets[f.key] || ""}
                placeholder={stored ? "اتركه فارغاً للإبقاء على الحالي" : f.placeholder}
                onChange={(e) => props.onSecretChange(f.key, e.target.value)} />
            </div>
          );
        })}
      </div>

      {row.last_test_error && (
        <div className="text-[11px] text-destructive bg-destructive/10 rounded p-2">آخر خطأ: {row.last_test_error}</div>
      )}

      <Button onClick={props.onSave} disabled={props.saving} className="gap-2">
        <Save size={14} /> {props.saving ? "جارِ الحفظ…" : "حفظ"}
      </Button>
    </Card>
  );
}
