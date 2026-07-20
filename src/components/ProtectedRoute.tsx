import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { Loader2, ShieldAlert } from "lucide-react";

interface Props {
  children: ReactNode;
  roles?: AppRole[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" dir="rtl">
        <div className="max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h2 className="text-xl font-bold mb-2">تعذر تحميل بيانات الحساب</h2>
          <p className="text-sm text-muted-foreground mb-4">
            لم يتم تحميل ملف المستخدم والورشة من Supabase، لذلك تم منع فتح النظام بدون tenant حتى لا تظهر البيانات فارغة.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => void refreshProfile()}
            >
              إعادة المحاولة
            </button>
            <button
              className="rounded-md border border-border px-4 py-2 text-sm font-medium"
              onClick={() => void signOut()}
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (roles && profile && !roles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" dir="rtl">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="text-xl font-bold mb-2">لا تملك صلاحية الوصول</h2>
          <p className="text-sm text-muted-foreground">
            هذه الصفحة متاحة فقط للأدوار: {roles.join(", ")}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
