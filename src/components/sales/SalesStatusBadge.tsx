import { SalesDocStatus, statusLabel } from "@/lib/salesStore";
import { useTranslation } from "react-i18next";

export default function SalesStatusBadge({ status }: { status: SalesDocStatus }) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const s = statusLabel(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${s.cls}`}>
      {isAr ? s.ar : s.en}
    </span>
  );
}
