import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Clock } from "lucide-react";

export default function DateTimeDisplay() {
  const { i18n, t } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const locale = isRtl ? "ar-OM" : "en-OM";

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = now.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });

  const timeStr = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: !isRtl,
  });

  return (
    <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground select-none">
      <div className="flex items-center gap-1" title={t("common.date")}>
        <Calendar className="w-3.5 h-3.5" />
        <span>{dateStr}</span>
      </div>
      <div className="flex items-center gap-1" title={t("common.time")}>
        <Clock className="w-3.5 h-3.5" />
        <span>{timeStr}</span>
      </div>
    </div>
  );
}
