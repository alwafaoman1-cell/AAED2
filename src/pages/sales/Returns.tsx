import SalesDocList from "@/components/sales/SalesDocList";
import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import SalesDocDetailPage from "@/components/sales/SalesDocDetailPage";
import { useTranslation } from "react-i18next";

export function ReturnedInvoices() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocList
      type="return_invoice"
      title={isAr ? "الفواتير المرتجعة" : "Returned Invoices"}
      newRoute="/sales/returns/new"
      detailRoute={(id) => `/sales/returns/${id}`}
    />
  );
}

export function NewReturn() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="return_invoice"
      title={isAr ? "إنشاء فاتورة مرتجعة" : "New return invoice"}
      backRoute="/sales/returns"
      detailRoute={(id) => `/sales/returns/${id}`}
    />
  );
}

export function ReturnDetail() {
  return (
    <SalesDocDetailPage
      type="return_invoice"
      backRoute="/sales/returns"
      editRoute={(id) => `/sales/returns/${id}/edit`}
      listRoute="/sales/returns"
    />
  );
}
