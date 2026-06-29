import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salesStore } from "@/lib/salesStore";
import UnifiedAddPaymentDialog from "@/components/payments/UnifiedAddPaymentDialog";

export default function CustomerPayments() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const u = salesStore.subscribe(() => force((x) => x + 1));
    return () => { u(); };
  }, []);

  const invoices = salesStore.list({ type: "invoice" });
  const allPayments = useMemo(() => {
    const rows: { id: string; date: string; amount: number; method: string; invoice: string; customer: string }[] = [];
    for (const inv of invoices) {
      for (const p of inv.payments) {
        rows.push({
          id: p.id,
          date: p.date,
          amount: p.amount,
          method: p.method,
          invoice: inv.number,
          customer: inv.customerName,
        });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [invoices]);

  const filtered = allPayments.filter(
    (p) => !q || p.customer.includes(q) || p.invoice.includes(q) || p.method.includes(q)
  );

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
        {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">{isAr ? "لا توجد دفعات" : "No payments"}</div>}
        {filtered.map((p) => (
          <div key={p.id} className="p-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{p.customer}</div>
              <div className="text-xs text-muted-foreground">
                {isAr ? "فاتورة" : "Invoice"} {p.invoice} — {p.method}
              </div>
            </div>
            <div className="text-end">
              <div className="font-mono font-bold">{p.amount.toFixed(3)} ر.ع</div>
              <div className="text-xs text-muted-foreground">{p.date}</div>
            </div>
          </div>
        ))}
      </div>

      <UnifiedAddPaymentDialog open={open} onOpenChange={setOpen} onSaved={() => force((x) => x + 1)} />
    </div>
  );
}
