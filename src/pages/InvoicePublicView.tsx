import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

interface InvoiceData {
  invoice: {
    invoice_number: string;
    issued_at: string;
    due_date: string | null;
    status: string;
    subtotal: number;
    vat: number;
    total: number;
    paid_amount: number;
    items: any[];
    notes: string | null;
    lpo_number: string | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_plate: string | null;
  };
  claim: { claim_number: string | null };
  company: {
    name: string;
    vat: string | null;
    cr: string | null;
    phone: string | null;
    address: string | null;
  };
  workshop: { name: string };
}

export default function InvoicePublicView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (!token) {
          setError("invalid_token");
          return;
        }
        const { data: rpc, error: rpcErr } = await supabase.rpc(
          "get_public_invoice" as any,
          { p_token: token }
        );
        if (rpcErr) throw rpcErr;
        const res = rpc as any;
        if (res?.error) {
          setError(res.error);
        } else {
          setData(res);
        }
      } catch (e: any) {
        setError(e?.message || "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4" dir="rtl">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">QR غير صالح أو منتهي</h2>
            <p className="text-sm text-muted-foreground">
              لا يمكن عرض هذه الفاتورة. تواصل مع الورشة للحصول على رابط جديد.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inv = data.invoice;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const fmt = (n: number) => Number(n || 0).toFixed(3);
  const dueRemaining = Math.max(0, Number(inv.total) - Number(inv.paid_amount));

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8" dir="rtl">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card className="border-primary/20">
          <CardHeader className="bg-primary/5 border-b">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-2xl">{data.workshop.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">فاتورة ضريبية موثقة</p>
              </div>
              <div className="flex items-center gap-2 text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-sm font-medium">تحقق ناجح</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">رقم الفاتورة</div>
                <div className="font-semibold mt-1">{inv.invoice_number}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">تاريخ الإصدار</div>
                <div className="font-semibold mt-1">{inv.issued_at?.slice(0, 10)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">تاريخ الاستحقاق</div>
                <div className="font-semibold mt-1">{inv.due_date || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">رقم المطالبة</div>
                <div className="font-semibold mt-1">{data.claim.claim_number || "—"}</div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-2">شركة التأمين</h3>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">الاسم:</span> {data.company.name}</div>
                {data.company.vat && <div><span className="text-muted-foreground">الرقم الضريبي:</span> {data.company.vat}</div>}
                {data.company.cr && <div><span className="text-muted-foreground">السجل التجاري:</span> {data.company.cr}</div>}
                {inv.lpo_number && <div><span className="text-muted-foreground">L.P.O:</span> {inv.lpo_number}</div>}
              </div>
            </div>

            {(inv.vehicle_make || inv.vehicle_plate) && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">المركبة</h3>
                <div className="text-sm">
                  {inv.vehicle_make} {inv.vehicle_model} — <span className="font-mono">{inv.vehicle_plate}</span>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-2">البنود</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-right p-2">الوصف</th>
                      <th className="text-center p-2 w-20">الكمية</th>
                      <th className="text-left p-2 w-28">السعر</th>
                      <th className="text-left p-2 w-28">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it: any, i: number) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{it.description}</td>
                        <td className="text-center p-2">{it.quantity}</td>
                        <td className="text-left p-2 font-mono">{fmt(Number(it.unit_price))}</td>
                        <td className="text-left p-2 font-mono">{fmt(Number(it.quantity) * Number(it.unit_price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t pt-4 max-w-sm ms-auto space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">المجموع</span><span className="font-mono">{fmt(inv.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الضريبة</span><span className="font-mono">{fmt(inv.vat)}</span></div>
              <div className="flex justify-between text-base font-bold border-t pt-2"><span>الإجمالي</span><span className="font-mono">{fmt(inv.total)} ر.ع</span></div>
              <div className="flex justify-between text-emerald-600"><span>المدفوع</span><span className="font-mono">{fmt(inv.paid_amount)}</span></div>
              <div className="flex justify-between text-destructive font-semibold"><span>المتبقي</span><span className="font-mono">{fmt(dueRemaining)}</span></div>
            </div>

            {inv.notes && (
              <div className="border-t pt-4 text-sm text-muted-foreground">
                <div className="font-semibold text-foreground mb-1">ملاحظات</div>
                {inv.notes}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          هذه الصفحة محمية برابط آمن مشفّر. لا تشارك الرابط مع أطراف غير مصرّح لها.
        </p>
      </div>
    </div>
  );
}
