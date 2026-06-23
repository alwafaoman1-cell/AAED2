import { LockKeyhole } from "lucide-react";
import { useLocation } from "react-router-dom";
import { featureForPath, useFeatures } from "@/contexts/FeatureContext";

export default function FeatureGate({ children, feature }: { children: React.ReactNode; feature?: Parameters<ReturnType<typeof useFeatures>["isEnabled"]>[0] }) {
  const location = useLocation();
  const { loading, isEnabled } = useFeatures();
  const key = feature || featureForPath(location.pathname);
  if (loading || !key || isEnabled(key)) return <>{children}</>;
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-lg items-center justify-center p-6" dir="rtl">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <LockKeyhole className="text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold text-foreground">الميزة غير مفعّلة</h1>
        <p className="mt-2 text-sm text-muted-foreground">يمكن لمدير الورشة تفعيل هذه الميزة من لوحة إدارة SaaS.</p>
      </div>
    </div>
  );
}
