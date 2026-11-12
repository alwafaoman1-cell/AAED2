import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import "@/lib/i18n/vehicleCenterMobile";

/**
 * أزرار الرجوع والتقدّم في تاريخ التصفح — تظهر في الشريط العلوي.
 * في RTL: السهم الأيمن = رجوع، الأيسر = للأمام (طبيعي للقارئ العربي).
 * في LTR: السهم الأيسر = رجوع، الأيمن = للأمام.
 */
export default function NavHistoryButtons() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";

  const BackIcon = isRtl ? ChevronRight : ChevronLeft;
  const FwdIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-foreground shadow-none"
        onClick={() => navigate(-1)}
        title={t("vehicleCenterMobile.back")}
        aria-label={t("vehicleCenterMobile.back")}
      >
        <BackIcon size={16} strokeWidth={2} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-foreground shadow-none"
        onClick={() => navigate(1)}
        title={t("vehicleCenterMobile.forward")}
        aria-label={t("vehicleCenterMobile.forward")}
      >
        <FwdIcon size={16} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}
