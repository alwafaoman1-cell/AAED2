import SalesDocEditorPage from "@/components/sales/SalesDocEditorPage";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { salesStore } from "@/lib/salesStore";
import { useEffect } from "react";

export default function EditInvoice() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  return (
    <SalesDocEditorPage
      type="invoice"
      title={isAr ? "تعديل فاتورة" : "Edit invoice"}
      backRoute="/sales/invoices"
      detailRoute={(id) => `/sales/invoices/${id}`}
    />
  );
}
