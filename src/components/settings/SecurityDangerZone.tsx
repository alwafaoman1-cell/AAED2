import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function SecurityDangerZone() {
  const { user, profile } = useAuth();
  const [loginOtpEnabled, setLoginOtpEnabled] = useState(false);
  const [cloudResetEnabled, setCloudResetEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwnerOrSuperAdmin =
    profile?.role === "admin" ||
    (profile?.role as string | undefined) === "owner" ||
    !!(profile as any)?.is_platform_admin;

  useEffect(() => {
    if (!profile?.tenant_id) return;
    void supabase
      .from("tenant_security_settings" as any)
      .select("login_otp_enabled,cloud_reset_enabled")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle()
      .then(({ data }) => {
        setLoginOtpEnabled(!!(data as any)?.login_otp_enabled);
        setCloudResetEnabled(!!(data as any)?.cloud_reset_enabled);
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
    const { error } = await (supabase.from("tenant_security_settings" as any) as any)
      .upsert(payload, { onConflict: "tenant_id" });
    if (error) {
      toast.error(error.message);
      return;
    }
    setLoginOtpEnabled(payload.login_otp_enabled);
    setCloudResetEnabled(payload.cloud_reset_enabled);
    toast.success("تم حفظ إعدادات الأمان");
  }

  async function reauthenticate() {
    if (!user?.email || !password) throw new Error("أدخل كلمة مرور المدير أولاً");
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (error) throw new Error("كلمة مرور المدير غير صحيحة");
  }

  async function requestOtp() {
    if (!isOwnerOrSuperAdmin) return toast.error("هذه العملية متاحة للمالك أو Super Admin فقط");
    setBusy(true);
    try {
      await reauthenticate();
      const { data, error } = await supabase.functions.invoke("request-security-otp", {
        body: { action: "cloud_reset" },
      });
      if (error) throw error;
      if (data?.error === "email_provider_not_configured") {
        toast.error("مزود البريد غير مفعّل على الخادم. أضف RESEND_API_KEY قبل استخدام التهيئة.");
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
    if (!isOwnerOrSuperAdmin) return toast.error("هذه العملية متاحة للمالك أو Super Admin فقط");
    if (!cloudResetEnabled) return toast.error("فعّل خيار تهيئة السحابة أولاً");
    setBusy(true);
    try {
      await reauthenticate();
      const { data, error } = await supabase.functions.invoke("execute-cloud-reset", {
        body: { otp, confirmPhrase, dryRun, reason: "admin settings danger zone" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "فشل تنفيذ العملية");
      toast.success(dryRun ? "تم فحص البيانات المرشحة للحذف" : "تم تنفيذ تهيئة السحابة");
      console.info("[cloud reset result]", data.results);
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
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
          <span>تفعيل OTP بعد تسجيل الدخول</span>
          <Switch checked={loginOtpEnabled} disabled={!isOwnerOrSuperAdmin} onCheckedChange={(v) => void saveSecuritySettings({ login_otp_enabled: v })} />
        </label>
        <label className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
          <span>السماح بتهيئة السحابة من الإعدادات</span>
          <Switch checked={cloudResetEnabled} disabled={!isOwnerOrSuperAdmin} onCheckedChange={(v) => void saveSecuritySettings({ cloud_reset_enabled: v })} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Input type="password" placeholder="كلمة مرور المدير" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input inputMode="numeric" maxLength={6} placeholder="OTP من البريد" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        <Input placeholder="DELETE CLOUD DATA" value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || !isOwnerOrSuperAdmin} onClick={requestOtp} className="gap-2">
          <ShieldCheck size={14} /> إرسال رمز تحقق للبريد
        </Button>
        <Button type="button" variant="outline" disabled={busy || !isOwnerOrSuperAdmin} onClick={() => executeReset(true)}>
          فحص قبل الحذف
        </Button>
        <Button type="button" variant="destructive" disabled={busy || !isOwnerOrSuperAdmin} onClick={() => executeReset(false)} className="gap-2">
          <Trash2 size={14} /> تهيئة وحذف بيانات السحابة
        </Button>
      </div>
    </div>
  );
}
