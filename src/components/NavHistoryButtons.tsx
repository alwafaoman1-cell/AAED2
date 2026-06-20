import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * أزرار الرجوع والتقدّم في تاريخ التصفح — تظهر في الشريط العلوي.
 * في RTL: السهم الأيمن = رجوع، الأيسر = للأمام (طبيعي للقارئ العربي).
 * في LTR: السهم الأيسر = رجوع، الأيمن = للأمام.
 */
export default function NavHistoryButtons() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";

  const BackIcon = isRtl ? ChevronRight : ChevronLeft;
  const FwdIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg border-2 border-primary/40 bg-primary/10 shadow-sm">
      <Button
        variant="default"
        size="icon"
        className="h-9 w-9 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:scale-105 transition-transform"
        onClick={() => navigate(-1)}
        title={isRtl ? "رجوع" : "Back"}
        aria-label="back"
      >
        <BackIcon size={20} strokeWidth={2.5} />
      </Button>
      <Button
        variant="default"
        size="icon"
        className="h-9 w-9 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:scale-105 transition-transform"
        onClick={() => navigate(1)}
        title={isRtl ? "للأمام" : "Forward"}
        aria-label="forward"
      >
        <FwdIcon size={20} strokeWidth={2.5} />
      </Button>
    </div>
  );
}
