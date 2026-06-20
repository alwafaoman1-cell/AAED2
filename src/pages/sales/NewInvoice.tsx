import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import { useTranslation } from "react-i18next";

export default function NewInvoice() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="invoice"
      title={isAr ? "إنشاء فاتورة" : "New invoice"}
      backRoute="/sales/invoices"
      detailRoute={(id) => `/sales/invoices/${id}`}
    />
  );
}
