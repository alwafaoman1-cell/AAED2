import SalesDocList from "@/components/sales/SalesDocList";
import { useTranslation } from "react-i18next";

export default function CreditNotes() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocList
      type="credit_note"
      title={isAr ? "إشعارات دائنة" : "Credit Notes"}
      newRoute="/sales/credit-notes/new"
      detailRoute={(id) => `/sales/credit-notes/${id}`}
    />
  );
}
