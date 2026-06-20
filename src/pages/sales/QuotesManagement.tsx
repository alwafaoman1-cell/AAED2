import SalesDocList from "@/components/sales/SalesDocList";
import { useTranslation } from "react-i18next";

export default function QuotesManagement() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocList
      type="quote"
      title={isAr ? "إدارة عروض الأسعار" : "Quotes Management"}
      newRoute="/sales/quotes/new"
      detailRoute={(id) => `/sales/quotes/${id}`}
    />
  );
}
