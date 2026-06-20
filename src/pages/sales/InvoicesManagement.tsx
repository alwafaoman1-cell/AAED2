import SalesDocList from "@/components/sales/SalesDocList";
import { useTranslation } from "react-i18next";

export default function InvoicesManagement() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocList
      type="invoice"
      title={isAr ? "إدارة الفواتير" : "Invoices Management"}
      newRoute="/sales/invoices/new"
      detailRoute={(id) => `/sales/invoices/${id}`}
    />
  );
}
