import SalesDocDetailPage from "@/components/sales/SalesDocDetailPage";

export default function QuoteDetail() {
  return (
    <SalesDocDetailPage
      type="quote"
      backRoute="/sales/quotes"
      editRoute={(id) => `/sales/quotes/${id}/edit`}
      listRoute="/sales/quotes"
    />
  );
}
