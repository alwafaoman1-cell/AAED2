import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

export default function SecurityDangerZone() {
  const { user, profile } = useAuth();
  const [loginOtpEnabled, setLoginOtpEnabled] = useState(false);
  const [cloudResetEnabled, setCloudResetEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [bypassOtp, setBypassOtp] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [emailProviderStatus, setEmailProviderStatus] = useState<{
    configured: boolean;
    enabled: boolean;
    activeProvider: string | null;
    lastTestAt: string | null;
    lastTestStatus: string | null;
  } | null>(null);

  const isOwnerOrSuperAdmin =
    profile?.role === "admin" ||
    (profile?.role as string | undefined) === "owner" ||
    (profile?.role as string | undefined) === "super_admin" ||
    !!(profile as any)?.is_platform_admin;

  useEffect(() => {
    if (!profile?.tenant_id) return;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("tenant_security_settings" as any)
          .select("login_otp_enabled,cloud_reset_enabled")
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle();
        if (error) {
          toast.error(`تعذر تحميل إعدادات OTP: ${error.message}`);
          return;
        }
        setLoginOtpEnabled(!!(data as any)?.login_otp_enabled);
        setCloudResetEnabled(!!(data as any)?.cloud_reset_enabled);
      } catch (error: any) {
        toast.error(error?.message || "تعذر تحميل إعدادات OTP");
      }
    })();
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    void supabase.functions
      .invoke("save-email-provider", { body: { action: "status" } })
      .then(({ data, error }) => {
        if (!error && data?.ok) setEmailProviderStatus(data.status);
      });
  }, [profile?.tenant_id]);

  async function saveSecuritySettings(next: { login_otp_enabled?: boolean; cloud_reset_enabled?: boolean }) {
    if (!profile?.tenant_id || !isOwnerOrSuperAdmin) return;
    const payload = {
      tenant_id: profile.tenant_id,
      login_otp_enabled: next.login_otp_enabled ?? loginOtpEnabled,
      cloud_reset_enabled: next.cloud_reset_enabled ?? cloudResetEnabled,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      const { data, error } = await (supabase.from("tenant_security_settings" as any) as any)
        .upsert(payload, { onConflict: "tenant_id" })
        .select("login_otp_enabled,cloud_reset_enabled")
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      setLoginOtpEnabled(!!data?.login_otp_enabled);
      setCloudResetEnabled(!!data?.cloud_reset_enabled);
      if (typeof next.login_otp_enabled === "boolean") {
        toast.success(next.login_otp_enabled ? "تم تفعيل OTP لتسجيل الدخول" : "تم إيقاف OTP لتسجيل الدخول");
      } else {
        toast.success("تم حفظ إعدادات الأمان");
      }
    } finally {
      setBusy(false);
    }
  }

  async function reauthenticate() {
    if (!user?.email || !password) throw new Error("أدخل كلمة مرور المدير أولًا");
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (error) throw new Error("كلمة مرور المدير غير صحيحة");
  }

  async function requestOtp() {
    setStatusMessage(null);
    if (!password.trim()) {
      const message = "أدخل كلمة مرور المدير أولًا قبل إرسال OTP.";
      setStatusMessage({ type: "error", text: message });
      toast.error(message);
      return;
    }
    if (!isOwnerOrSuperAdmin) return toast.error("هذه العملية متاحة للمالك أو Super Admin فقط");
    setBusy(true);
    try {
      await reauthenticate();
      const { data, error } = await supabase.functions.invoke("request-security-otp", {
        body: { action: "cloud_reset" },
      });
      if (error || data?.error || data?.ok === false) {
        toast.error(getFunctionErrorMessage(error, data));
        return;
      }
      toast.success("تم إرسال رمز التحقق إلى بريد المدير");
    } catch (error: any) {
      toast.error(error?.message || "تعذر إرسال رمز التحقق");
    } finally {
      setBusy(false);
    }
  }

  async function executeReset(dryRun: boolean) {
    setStatusMessage(null);
    if (!password.trim()) {
      const message = "أدخل كلمة مرور المدير أولًا.";
      setStatusMessage({ type: "error", text: message });
      toast.error(message);
      return;
    }
    if (!dryRun && confirmPhrase.trim() !== "DELETE CLOUD DATA") {
      const message = "اكتب عبارة التأكيد DELETE CLOUD DATA قبل تنفيذ الحذف.";
      setStatusMessage({ type: "error", text: message });
      toast.error(message);
      return;
    }
    if (!dryRun && !bypassOtp && !otp.trim()) {
      const message = "أرسل OTP ثم أدخل الرمز، أو استخدم تجاوز OTP المؤقت بصلاحية المالك عند تعطل البريد.";
      setStatusMessage({ type: "error", text: message });
      toast.error(message);
      return;
    }
    if (!isOwnerOrSuperAdmin) return toast.error("هذه العملية متاحة للمالك أو Super Admin فقط");
    if (!cloudResetEnabled) return toast.error("فعّل خيار تهيئة السحابة أولًا");
    setBusy(true);
    try {
      await reauthenticate();
      const { data, error } = await supabase.functions.invoke("execute-cloud-reset", {
        body: {
          otp,
          skipOtp: bypassOtp,
          confirmPhrase,
          dryRun,
          reason: bypassOtp ? "admin settings danger zone otp bypass" : "admin settings danger zone",
        },
      });
      if (error || !data?.ok) throw new Error(getFunctionErrorMessage(error, data));
      toast.success(dryRun ? "تم فحص البيانات المرشحة للحذف" : "تم تنفيذ تهيئة السحابة");
    } catch (error: any) {
      toast.error(error?.message || "تعذر تنفيذ تهيئة السحابة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-destructive/35 bg-destructive/5 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-destructive mt-0.5" size={20} />
        <div>
          <h3 className="text-sm font-bold text-destructive">منطقة أمان خطرة — تهيئة السحابة</h3>
          <p className="text-xs text-muted-foreground">
            لا يمكن حذف بيانات السحابة إلا بعد كلمة مرور المدير + رمز OTP بالبريد + كتابة DELETE CLOUD DATA.
            يمكن للمالك/Super Admin تجاوز OTP مؤقتًا عند تعطل البريد، مع بقاء كلمة المرور وعبارة التأكيد إلزامية.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3 text-sm md:col-span-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <span className="block font-medium">Email Provider</span>
              <span className="block text-xs text-muted-foreground">
                Active Provider: {emailProviderStatus?.activeProvider || "Not Configured"}
                {emailProviderStatus?.lastTestAt ? ` • Last Test: ${new Date(emailProviderStatus.lastTestAt).toLocaleString("en-GB")}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {emailProviderStatus?.configured && emailProviderStatus?.enabled ? (
                <Badge variant="outline" className="border-success/40 text-success">Configured</Badge>
              ) : (
                <Badge variant="outline" className="border-destructive/40 text-destructive">Not Configured</Badge>
              )}
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/integrations">Configure Email Provider</Link>
              </Button>
            </div>
          </div>
          {loginOtpEnabled && (!emailProviderStatus?.configured || !emailProviderStatus?.enabled) && (
            <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
              OTP مفعّل لكن مزود البريد غير مضبوط. لن تصل رموز الدخول حتى يتم ضبط Email Provider أو fallback server secrets.
            </div>
          )}
        </div>
        {statusMessage && (
          <div
            className={
              statusMessage.type === "success"
                ? "md:col-span-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success"
                : "md:col-span-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            }
          >
            {statusMessage.text}
          </div>
        )}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="space-y-1">
            <span className="block font-medium">OTP تسجيل الدخول</span>
            <span className="block text-xs text-muted-foreground">
              يمكن إيقافه مؤقتًا إذا لم يصل البريد، ثم تفعيله بعد ضبط مزود البريد من إعدادات التكامل.
            </span>
          </span>
          <Switch checked={loginOtpEnabled} disabled={busy || !isOwnerOrSuperAdmin} onCheckedChange={(value) => void saveSecuritySettings({ login_otp_enabled: value })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
          <span>السماح بتهيئة السحابة من الإعدادات</span>
          <Switch checked={cloudResetEnabled} disabled={busy || !isOwnerOrSuperAdmin} onCheckedChange={(value) => void saveSecuritySettings({ cloud_reset_enabled: value })} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Input type="password" placeholder="كلمة مرور المدير" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Input inputMode="numeric" maxLength={6} placeholder={bypassOtp ? "OTP متجاوز مؤقتًا" : "OTP من البريد"} value={otp} disabled={bypassOtp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <Input placeholder="DELETE CLOUD DATA" value={confirmPhrase} onChange={(event) => setConfirmPhrase(event.target.value)} />
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
        <span className="space-y-1">
          <span className="block font-medium">تجاوز OTP مؤقتًا للتهيئة</span>
          <span className="block text-xs text-muted-foreground">
            استخدمه فقط إذا كان البريد/OTP لا يعمل. لا يزال مطلوبًا إدخال كلمة مرور المدير وعبارة DELETE CLOUD DATA.
          </span>
        </span>
        <Switch checked={bypassOtp} disabled={busy || !isOwnerOrSuperAdmin} onCheckedChange={(value) => { setBypassOtp(value); if (value) setOtp(""); }} />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || !isOwnerOrSuperAdmin} onClick={requestOtp} className="gap-2">
          <ShieldCheck size={14} /> إرسال رمز تحقق للبريد
        </Button>
        <Button type="button" variant="outline" disabled={busy || !isOwnerOrSuperAdmin} onClick={() => void executeReset(true)}>
          فحص قبل الحذف
        </Button>
        <Button type="button" variant="destructive" disabled={busy || !isOwnerOrSuperAdmin} onClick={() => void executeReset(false)} className="gap-2">
          <Trash2 size={14} /> تهيئة وحذف بيانات السحابة
        </Button>
      </div>
    </div>
  );
}
