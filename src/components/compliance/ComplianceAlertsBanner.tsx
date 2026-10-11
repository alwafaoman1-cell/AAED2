import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useComplianceAlerts } from "@/hooks/useComplianceAlerts";
import { daysUntilExpiry } from "@/lib/compliance/complianceService";

export default function ComplianceAlertsBanner() {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const enabled = profile?.role === "admin" || profile?.role === "manager";
  const { alerts, total, isError } = useComplianceAlerts(profile?.tenant_id, enabled);
  if (!enabled) return null;
  if (isError) return <Link to="/compliance" className="flex items-center gap-2 rounded-lg border border-amber-500/60 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
    <AlertTriangle className="h-4 w-4 shrink-0"/>{isAr ? "تعذر فحص مواعيد انتهاء التراخيص والعقود — افتح السجل للتحقق." : "Could not check licence and contract expiries — open the register to verify."}
  </Link>;
  if (!total) return null;
  const hasExpired = alerts.some((item) => daysUntilExpiry(item.expiresOn) < 0);
  return <Link to="/compliance" className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-500/15 dark:text-amber-200">
    <span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0"/>{isAr ? `${total} ترخيص/عقد يحتاج متابعة خلال ثلاثة أشهر${hasExpired ? "؛ بينها منتهية" : ""}` : `${total} licences/contracts need attention within three months${hasExpired ? "; some are expired" : ""}`}</span>
    <span className="shrink-0 underline">{isAr ? "عرض" : "View"}</span>
  </Link>;
}
