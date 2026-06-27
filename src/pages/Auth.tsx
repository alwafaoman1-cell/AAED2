import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, LogIn, Wrench, Mail } from "lucide-react";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@/lib/functionErrors";

function homeForRole(role?: string | null): string {
  if (role === "supervisor") return "/supervisor-app";
  if (role === "technician") return "/tech";
  if (role === "accountant") return "/accountant-app";
  return "/";
}

export default function AuthPage() {
  const { session, profile, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [loginOtpOpen, setLoginOtpOpen] = useState(false);
  const [loginOtp, setLoginOtp] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [checkingOtpSetting, setCheckingOtpSetting] = useState(false);

  useEffect(() => {
    if (!loading && session && profile) {
      if (checkingOtpSetting || loginOtpOpen) return;
      if (!otpVerified) {
        setCheckingOtpSetting(true);
        void (async () => {
          try {
            const { data } = await supabase
              .from("tenant_security_settings" as any)
              .select("login_otp_enabled")
              .eq("tenant_id", profile.tenant_id)
              .maybeSingle();
            if ((data as any)?.login_otp_enabled) {
              const { data: otpData, error: otpError } = await supabase.functions.invoke("request-security-otp", {
                body: { action: "login_otp" },
              });
              if (otpError || otpData?.error || otpData?.ok === false) {
                toast.error(getFunctionErrorMessage(otpError, otpData));
                await supabase.auth.signOut();
                return;
              }
              setLoginOtpOpen(true);
              toast.info("تم إرسال رمز تحقق إلى بريدك");
              return;
            }
            setOtpVerified(true);
            navigate(homeForRole(profile.role), { replace: true });
          } finally {
            setCheckingOtpSetting(false);
          }
        })();
        return;
      }
      navigate(homeForRole(profile.role), { replace: true });
    }
  }, [session, profile, loading, navigate, otpVerified, loginOtpOpen, checkingOtpSetting]);

  if (session && profile && otpVerified) return <Navigate to={homeForRole(profile.role)} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("الرجاء إدخال البريد وكلمة المرور");
      return;
    }
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error(error.includes("Invalid") ? "بيانات الدخول غير صحيحة" : error);
      return;
    }
    toast.success("مرحباً بك");
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
            <Button type="submit" className="w-full" disabled={submitting}>
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
              أدخل رمز OTP المكوّن من 6 أرقام المرسل إلى بريدك الإلكتروني لإكمال تسجيل الدخول.
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
