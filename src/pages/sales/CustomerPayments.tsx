import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { salesStore } from "@/lib/salesStore";

export default function CustomerPayments() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("نقدي");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

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

  function save() {
    if (!invoiceId) { toast.error(isAr ? "اختر الفاتورة" : "Select invoice"); return; }
    if (amount <= 0) { toast.error(isAr ? "أدخل قيمة" : "Enter amount"); return; }
    salesStore.addPayment(invoiceId, { amount, method, date });
    toast.success(isAr ? "تمت الإضافة" : "Saved");
    setOpen(false); setInvoiceId(""); setAmount(0);
  }

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "تسجيل دفعة" : "Record payment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{isAr ? "الفاتورة" : "Invoice"}</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر فاتورة" : "Select invoice"} /></SelectTrigger>
                <SelectContent>
                  {invoices.filter((i) => i.balanceDue > 0).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} — {i.customerName} ({i.balanceDue.toFixed(3)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{isAr ? "القيمة" : "Amount"}</Label><Input type="number" step="0.001" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
            <div><Label>{isAr ? "طريقة الدفع" : "Method"}</Label><Input value={method} onChange={(e) => setMethod(e.target.value)} /></div>
            <div><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={save}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
