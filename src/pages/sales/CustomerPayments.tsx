import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCashSalesPaymentsPage, SALES_LIST_PAGE_SIZE } from "@/lib/salesDocumentQueries";
import UnifiedAddPaymentDialog from "@/components/payments/UnifiedAddPaymentDialog";

export default function CustomerPayments() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const tenantId = profile?.tenant_id || "";

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);
  const paymentsQuery = useQuery({
    queryKey: ["cash_sales_payments", tenantId, page, search],
    queryFn: () => fetchCashSalesPaymentsPage(tenantId, page, search),
    enabled: Boolean(tenantId),
    staleTime: 20_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
  const rows = paymentsQuery.data?.rows || [];
  const total = paymentsQuery.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / SALES_LIST_PAGE_SIZE));

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between border-b pb-3">
        <h1 className="text-2xl font-bold">{isAr ? "مدفوعات العملاء" : "Customer Payments"}</h1>
        <Button onClick={() => setOpen(true)} className="gap-2 bg-success hover:bg-success/90">
          <Plus className="h-4 w-4" /> {isAr ? "تسجيل دفعة" : "Record payment"}
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="relative max-w-md">
          <Search className="absolute top-2.5 start-3 h-4 w-4 text-muted-foreground" />
          <Input className="ps-9" placeholder={isAr ? "ابحث عن دفعة" : "Search payments"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {paymentsQuery.isPending && <div className="text-center py-12 text-muted-foreground text-sm">{isAr ? "جارٍ تحميل الدفعات..." : "Loading payments..."}</div>}
        {paymentsQuery.isError && <div className="text-center py-12 text-destructive text-sm">{isAr ? "تعذر تحميل سندات القبض" : "Unable to load payments"}</div>}
        {!paymentsQuery.isPending && !paymentsQuery.isError && rows.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">{isAr ? "لا توجد دفعات" : "No payments"}</div>}
        {rows.map((p) => (
          <div key={p.id} className="p-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{p.customerName}</div>
              <div className="text-xs text-muted-foreground">
                {isAr ? "فاتورة" : "Invoice"} {p.invoiceNumber} — {p.method}
              </div>
            </div>
            <div className="text-end">
              <div className="font-mono font-bold">{p.amount.toFixed(3)} ر.ع</div>
              <div className="text-xs text-muted-foreground">{p.date}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total ? (page - 1) * SALES_LIST_PAGE_SIZE + 1 : 0} - {Math.min(page * SALES_LIST_PAGE_SIZE, total)} {isAr ? "من" : "of"} {total}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || paymentsQuery.isFetching} onClick={() => setPage((value) => value - 1)}>{isAr ? "السابق" : "Previous"}</Button>
          <span>{page} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount || paymentsQuery.isFetching} onClick={() => setPage((value) => value + 1)}>{isAr ? "التالي" : "Next"}</Button>
        </div>
      </div>

      <UnifiedAddPaymentDialog open={open} onOpenChange={setOpen} onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: ["cash_sales_payments", tenantId] });
        void queryClient.invalidateQueries({ queryKey: ["sales_financial_summary", tenantId] });
      }} />
    </div>
  );
}
