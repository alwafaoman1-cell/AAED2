import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import SalesDocDetailPage from "@/components/sales/SalesDocDetailPage";
import { useTranslation } from "react-i18next";

export function NewCreditNote() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="credit_note"
      title={isAr ? "إنشاء إشعار دائن" : "New credit note"}
      backRoute="/sales/credit-notes"
      detailRoute={(id) => `/sales/credit-notes/${id}`}
    />
  );
}

export function CreditNoteDetail() {
  return (
    <SalesDocDetailPage
      type="credit_note"
      backRoute="/sales/credit-notes"
      editRoute={(id) => `/sales/credit-notes/${id}/edit`}
      listRoute="/sales/credit-notes"
    />
  );
}
