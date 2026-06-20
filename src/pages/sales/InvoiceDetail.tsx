import SalesDocDetailPage from "@/components/sales/SalesDocDetailPage";

export default function InvoiceDetail() {
  return (
    <SalesDocDetailPage
      type="invoice"
      backRoute="/sales/invoices"
      editRoute={(id) => `/sales/invoices/${id}/edit`}
      listRoute="/sales/invoices"
    />
  );
}
