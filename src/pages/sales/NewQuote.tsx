import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import { useTranslation } from "react-i18next";

export default function NewQuote() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="quote"
      title={isAr ? "إنشاء عرض سعر" : "New quote"}
      backRoute="/sales/quotes"
      detailRoute={(id) => `/sales/quotes/${id}`}
    />
  );
}
