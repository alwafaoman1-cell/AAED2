import SalesDocList from "@/components/sales/SalesDocList";
import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import SalesDocDetailPage from "@/components/sales/SalesDocDetailPage";
import { useTranslation } from "react-i18next";

export function RecurringInvoices() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocList
      type="recurring_invoice"
      title={isAr ? "الفواتير الدورية" : "Recurring Invoices"}
      newRoute="/sales/recurring/new"
      detailRoute={(id) => `/sales/recurring/${id}`}
    />
  );
}

export function NewRecurring() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="recurring_invoice"
      title={isAr ? "إنشاء فاتورة دورية" : "New recurring invoice"}
      backRoute="/sales/recurring"
      detailRoute={(id) => `/sales/recurring/${id}`}
    />
  );
}

export function RecurringDetail() {
  return (
    <SalesDocDetailPage
      type="recurring_invoice"
      backRoute="/sales/recurring"
      editRoute={(id) => `/sales/recurring/${id}/edit`}
      listRoute="/sales/recurring"
    />
  );
}
