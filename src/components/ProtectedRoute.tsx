import { Navigate, useLocation } from "react-router-dom";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
  roles?: AppRole[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, loading } = useAuth();
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

  if (roles && profile && !roles.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" dir="rtl">
        <div>
          <h2 className="text-xl font-bold mb-2">لا تملك صلاحية الوصول</h2>
          <p className="text-muted-foreground">هذه الصفحة متاحة فقط للأدوار: {roles.join(", ")}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
