import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, LogIn, Wrench, Mail, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

function homeForRole(role?: string | null): string {
  if (role === "supervisor") return "/supervisor";
  if (role === "technician") return "/technician";
  if (role === "accountant") return "/accountant";
  return "/";
}

function functionErrorCode(error: unknown, data?: any): string {
  return String(data?.code || data?.error || (error as any)?.code || (error as any)?.message || "").trim();
}

const AUTH_STEP_TIMEOUT_MS = 12_000;

function withAuthStepTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), AUTH_STEP_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function cleanLoginError(error: unknown, fallback = "تعذر تسجيل الدخول. تحقق من الاتصال وحاول مرة أخرى."): string {
  const raw =
    typeof error === "string"
      ? error
      : String((error as any)?.message || (error as any)?.error_description || (error as any)?.error || error || "");
  const message = raw.trim();
  if (!message || message === "{}" || message === "[object Object]") return fallback;
  if (/profile load timeout|otp settings timeout|otp request timeout/i.test(message)) {
    return "تسجيل الدخول نجح، لكن تحميل إعدادات الحساب تأخر. اضغط إعادة المحاولة أو سجّل الخروج ثم ادخل مرة أخرى.";
  }
  return message;
}

export default function AuthPage() {
  const { session, profile, signIn, signOut, refreshProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginStatus, setLoginStatus] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [loginOtpOpen, setLoginOtpOpen] = useState(false);
  const [loginOtp, setLoginOtp] = useState("");
  const [loginOtpNotice, setLoginOtpNotice] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [checkingOtpSetting, setCheckingOtpSetting] = useState(false);

  useEffect(() => {
    if (!loading && session && profile) {
      if (checkingOtpSetting || loginOtpOpen) return;
      if (!otpVerified) {
        setCheckingOtpSetting(true);
        void (async () => {
          try {
            const { data } = await withAuthStepTimeout(
              supabase
                .from("tenant_security_settings" as any)
                .select("login_otp_enabled")
                .eq("tenant_id", profile.tenant_id)
                .maybeSingle(),
              "otp settings timeout",
            );
            if ((data as any)?.login_otp_enabled) {
              const { data: otpData, error: otpError } = await withAuthStepTimeout(
                supabase.functions.invoke("request-security-otp", {
                  body: { action: "login_otp" },
                }),
                "otp request timeout",
              );
              if (otpError || otpData?.error || otpData?.ok === false) {
                const code = functionErrorCode(otpError, otpData);
                const message = cleanLoginError(getFunctionErrorMessage(otpError, otpData), "تعذر إرسال رمز التحقق. حاول مرة أخرى.");
                if (code === "otp_rate_limited") {
                  setLoginOtpNotice("تم طلب رموز كثيرة. إذا كان لديك رمز حديث أدخله هنا، أو انتظر قليلًا ثم حاول طلب رمز جديد.");
                  setLoginOtpOpen(true);
                  toast.error(message);
                  return;
                }
                if (code === "email_provider_not_configured" || code === "server_env_not_configured") {
                  toast.warning(`${message} تم السماح بالدخول مؤقتًا حتى تضبط البريد أو توقف OTP من الإعدادات.`);
                  setOtpVerified(true);
                  navigate(homeForRole(profile.role), { replace: true });
                  return;
                }
                toast.error(message);
                await supabase.auth.signOut();
                return;
              }
              setLoginOtpNotice("");
              setLoginOtpOpen(true);
              setSubmitting(false);
              setLoginStatus("");
              toast.info("تم إرسال رمز تحقق إلى بريدك");
              return;
            }
            setOtpVerified(true);
            navigate(homeForRole(profile.role), { replace: true });
          } catch (error) {
            toast.error(cleanLoginError(error, "تعذر إكمال تسجيل الدخول. تحقق من الاتصال ثم حاول مرة أخرى."));
            setSubmitting(false);
            setLoginStatus("");
            await supabase.auth.signOut();
          } finally {
            setCheckingOtpSetting(false);
          }
        })();
        return;
      }
      navigate(homeForRole(profile.role), { replace: true });
    }
  }, [session, profile, loading, navigate, otpVerified, loginOtpOpen, checkingOtpSetting]);

  useEffect(() => {
    if (session && profile) {
      setLoginStatus("تم تحميل بيانات الحساب، جاري فتح النظام...");
    }
    if (!session) {
      setSubmitting(false);
      setLoginStatus("");
    }
  }, [session, profile]);

  if (session && profile && otpVerified) return <Navigate to={homeForRole(profile.role)} replace />;

  if (session && !loading && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
        <Card className="w-full max-w-lg border-border/60 shadow-xl">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <ShieldAlert className="w-7 h-7 text-amber-600" />
            </div>
            <CardTitle className="text-2xl">تعذر تحميل بيانات الحساب</CardTitle>
            <CardDescription>
              تم تسجيل الدخول، لكن ملف المستخدم أو بيانات الورشة لم تصل من Supabase. تم إيقاف فتح النظام حتى لا يظهر فارغًا.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={() => void refreshProfile()}>
              <RefreshCcw className="w-4 h-4 ml-2" />
              إعادة تحميل بيانات الحساب
            </Button>
            <Button className="w-full" variant="outline" onClick={() => void signOut()}>
              تسجيل الخروج
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("الرجاء إدخال البريد وكلمة المرور");
      return;
    }
    setSubmitting(true);
    setLoginStatus("جاري التحقق من بيانات الدخول...");
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setSubmitting(false);
      setLoginStatus("");
      const message = cleanLoginError(error);
      toast.error(message.includes("Invalid") ? "بيانات الدخول غير صحيحة" : message);
      return;
    }
    setLoginStatus("تم تسجيل الدخول، جاري تحميل بيانات الورشة...");
    toast.success("تم تسجيل الدخول");
    // navigation happens via useEffect once profile is loaded
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail) {
      toast.error("أدخل البريد الإلكتروني");
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingReset(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("تم إرسال رابط استعادة كلمة المرور إلى بريدك");
    setForgotOpen(false);
    setForgotEmail("");
  }

  async function verifyLoginOtp() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-security-otp", {
        body: { action: "login_otp", otp: loginOtp },
      });
      if (error || !data?.ok) throw new Error(getFunctionErrorMessage(error, data));
      setOtpVerified(true);
      setLoginOtpOpen(false);
      toast.success("تم التحقق من رمز الدخول");
      if (profile) navigate(homeForRole(profile.role), { replace: true });
    } catch (error: any) {
      toast.error(error?.message || "رمز التحقق غير صحيح أو منتهي");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md border-border/60 shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Wrench className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">الوفاء للخدمات المتكاملة</CardTitle>
          <CardDescription>تسجيل الدخول للوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">كلمة المرور</Label>
                <button
                  type="button"
                  onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                  className="text-xs text-primary hover:underline"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {loginStatus && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
                <Loader2 className="inline-block w-4 h-4 animate-spin ml-2" />
                {loginStatus}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting || loading || checkingOtpSetting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <LogIn className="w-4 h-4 ml-2" />}
              {submitting ? "جارٍ الدخول..." : "تسجيل الدخول"}
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              التسجيل العام مغلق. تواصل مع المدير لإنشاء حسابك.
            </p>
          </form>
        </CardContent>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>استعادة كلمة المرور</DialogTitle>
            <DialogDescription>
              أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">البريد الإلكتروني</Label>
              <Input
                id="forgot-email"
                type="email"
                dir="ltr"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setForgotOpen(false)}>إلغاء</Button>
              <Button type="submit" disabled={sendingReset}>
                {sendingReset ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Mail className="w-4 h-4 ml-2" />}
                إرسال الرابط
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={loginOtpOpen} onOpenChange={(open) => {
        setLoginOtpOpen(open);
        if (!open && !otpVerified) void supabase.auth.signOut();
      }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>رمز تحقق تسجيل الدخول</DialogTitle>
            <DialogDescription>
              {loginOtpNotice || "أدخل رمز OTP المكوّن من 6 أرقام المرسل إلى بريدك الإلكتروني لإكمال تسجيل الدخول."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              inputMode="numeric"
              maxLength={6}
              value={loginOtp}
              onChange={(e) => setLoginOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              dir="ltr"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => void supabase.auth.signOut()}>إلغاء</Button>
              <Button type="button" disabled={submitting || loginOtp.length !== 6} onClick={verifyLoginOtp}>
                تحقق ودخول
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
