import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Legacy URLs resolve only to the protected vehicle portal, never to a bearer-data API. */
export default function LegacyUnifiedPortalRedirect() {
  const params = useParams();
  const key = params.token || params.id || params.plate || "";
  const { i18n } = useTranslation();
  const en = i18n.language.startsWith("en");
  const [result, setResult] = useState<{ key: string; token: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    if (!key) { setResult({ key, token: null }); return; }
    void supabase.rpc("customer_vehicle_portal_resolve" as any, { p_key: key } as any).then(({ data, error }) => {
      if (!active) return;
      const row = data as unknown as { token?: unknown } | null;
      setResult({ key, token: !error && typeof row?.token === "string" && row.token ? row.token : null });
    }, () => { if (active) setResult({ key, token: null }); });
    return () => { active = false; };
  }, [key]);
  if (result?.key === key && result.token) return <Navigate to={`/customer/vehicle/${encodeURIComponent(result.token)}`} replace />;
  const loading = result?.key !== key;
  return <main className="min-h-screen bg-background p-6 flex items-center justify-center" dir={en ? "ltr" : "rtl"}>
    <section className="max-w-md rounded-xl border bg-card p-6 text-center space-y-3">
      {loading ? <Loader2 className="mx-auto h-8 w-8 animate-spin"/> : <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground"/>}
      <h1 className="text-xl font-semibold">{en ? "Protected customer portal" : "بوابة العميل المحمية"}</h1>
      <p role="status">{loading ? (en ? "Checking the customer link…" : "جارٍ التحقق من رابط العميل…") : (en ? "This link is unavailable. Ask the workshop for the current customer portal link." : "هذا الرابط غير متاح. اطلب من الورشة رابط بوابة العميل الحالي.")}</p>
      <p className="text-sm text-muted-foreground flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4"/>{en ? "Vehicle details require its plate number and letters." : "يتطلب عرض بيانات المركبة رقم لوحتها وحروفها."}</p>
    </section>
  </main>;
}
