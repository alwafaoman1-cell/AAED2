// يجمع الإيرادات من مصادر متعددة: أوامر العمل + فواتير التأمين + المدفوعات الفعلية
// يُستخدم في شريط KPI لتوحيد الأرقام بدل الاعتماد على مصدر واحد فقط.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { buildSalesReport, type ReportFilters } from "@/lib/reportsEngine";

interface InsInvoiceRow {
  id: string;
  total: number;
  subtotal: number;
  vat: number;
  paid_amount: number;
  status: string;
  issued_at: string;
}

const inRange = (d: string, from: string, to: string) => {
  if (!d) return false;
  const x = d.slice(0, 10);
  return (!from || x >= from) && (!to || x <= to);
};

export function useUnifiedRevenue(filters: ReportFilters) {
  const { data: insInvoices = [], isLoading } = useQuery({
    queryKey: ["unified_revenue_ins_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_invoices" as any)
        .select("id,total,subtotal,vat,paid_amount,status,issued_at");
      if (error) throw error;
      return (data || []) as unknown as InsInvoiceRow[];
    },
  });

  return useMemo(() => {
    const sales = buildSalesReport(filters);

    const insInRange = insInvoices.filter((i) => inRange(i.issued_at, filters.range.from, filters.range.to));
    const insTotal = insInRange.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const insVat = insInRange.reduce((s, i) => s + (Number(i.vat) || 0), 0);
    const insPaid = insInRange.reduce((s, i) => s + (Number(i.paid_amount) || 0), 0);
    const insPending = Math.max(0, insTotal - insPaid);

    return {
      isLoading,
      // أوامر العمل
      workOrders: sales,
      // التأمين
      insurance: {
        count: insInRange.length,
        total: insTotal,
        vat: insVat,
        paid: insPaid,
        pending: insPending,
      },
      // الإجماليات الموحدة
      unified: {
        totalRevenue: sales.totalRevenue + insTotal,
        paidRevenue: sales.paidRevenue + insPaid,
        pendingRevenue: sales.pendingRevenue + insPending,
        // VAT المحصّلة الفعلية = من قيود اليومية (sales) + من فواتير التأمين (تُسجّل عند الإصدار)
        vatCollected: sales.vatCollected + insVat,
        invoicesCount: sales.count + insInRange.length,
      },
    };
  }, [insInvoices, isLoading, filters]);
}
