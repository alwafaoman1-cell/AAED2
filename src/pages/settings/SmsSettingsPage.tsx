import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, MessageSquare, Save, Send, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SmsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [fromNumber, setFromNumber] = useState("");

  const [testTo, setTestTo] = useState("");
  const [testBody, setTestBody] = useState("رسالة تجريبية من نظام الورشة ✅");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tenant_sms_settings")
        .select("account_sid, auth_token, from_number, enabled")
        .maybeSingle();
      if (data) {
        setEnabled(!!data.enabled);
        setAccountSid(data.account_sid || "");
        setFromNumber(data.from_number || "");
        setHasToken(!!data.auth_token);
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!accountSid.trim() || !fromNumber.trim()) {
      toast.error("Account SID ورقم الإرسال مطلوبان");
      return;
    }
    if (!hasToken && !authToken.trim()) {
      toast.error("Auth Token مطلوب");
      return;
    }
    setSaving(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", (await supabase.auth.getUser()).data.user!.id)
        .single();

      const payload: any = {
        tenant_id: profile!.tenant_id,
        account_sid: accountSid.trim(),
        from_number: fromNumber.trim(),
        enabled,
        provider: "twilio",
      };
      if (authToken.trim()) payload.auth_token = authToken.trim();

      const { error } = await supabase
        .from("tenant_sms_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
      toast.success("تم الحفظ");
      setAuthToken("");
      setHasToken(true);
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testTo.trim() || !testBody.trim()) {
      toast.error("أدخل الرقم ونص الرسالة");
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { to: testTo.trim(), message: testBody.trim(), test: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("تم الإرسال — SID: " + ((data as any)?.sid || ""));
    } catch (e: any) {
      toast.error(e.message || "فشل الإرسال");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">جارِ التحميل…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ArrowRight size={14} className="ml-1" /> الإعدادات</Link>
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquare size={20} className="text-success" /> إعدادات SMS (Twilio)
        </h1>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">تفعيل إرسال SMS</Label>
            <p className="text-xs text-muted-foreground">عند الإيقاف لن يُرسل أي SMS من النظام.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Account SID</Label>
            <Input
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-xs">Auth Token {hasToken && <span className="text-success">(محفوظ)</span>}</Label>
            <Input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder={hasToken ? "اتركه فارغاً للإبقاء على الحالي" : "أدخل Auth Token"}
              dir="ltr"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">رقم الإرسال (From — بصيغة E.164)</Label>
            <Input
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              placeholder="+15017122661"
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-xs">
          <ShieldAlert size={14} className="text-warning shrink-0 mt-0.5" />
          <div>
            احصل على البيانات من <a className="underline" href="https://console.twilio.com/" target="_blank" rel="noreferrer">Twilio Console</a>.
            ننصح بتفعيل <b>SMS Pumping Protection</b> و<b>Geo Permissions</b> لمنع الاحتيال.
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save size={14} /> {saving ? "جارِ الحفظ…" : "حفظ"}
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold text-sm">إرسال رسالة تجريبية</h2>
        <Input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="+9689xxxxxxx"
          dir="ltr"
        />
        <Textarea
          value={testBody}
          onChange={(e) => setTestBody(e.target.value)}
          rows={3}
          dir="auto"
        />
        <Button onClick={handleTest} disabled={testing} variant="outline" className="gap-2">
          <Send size={14} /> {testing ? "جارِ الإرسال…" : "إرسال تجريبي"}
        </Button>
      </Card>
    </div>
  );
}
