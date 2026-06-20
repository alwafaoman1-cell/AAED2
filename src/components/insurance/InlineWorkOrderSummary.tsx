// عرض ملخّص أمر العمل (من Supabase job_orders) داخل تبويب المطالبة
// — للقراءة فقط مع زر فتح الصفحة الكاملة. يجلب البيانات الأساسية + السيارة + العميل.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, Car, User, Calendar, FileText, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Props {
  workOrderId: string;
}

const STATUS_AR: Record<string, string> = {
  received: "مستلم",
  diagnosing: "قيد الفحص",
  awaiting_parts: "بانتظار قطع",
  in_progress: "تحت الإصلاح",
  quality_check: "ضبط الجودة",
  ready: "جاهز للتسليم",
  delivered: "تم التسليم",
  closed: "مغلق",
};

const STATUS_COLOR: Record<string, string> = {
  received: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  diagnosing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  awaiting_parts: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  quality_check: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  delivered: "bg-emerald-600/20 text-emerald-300 border-emerald-600/40",
  closed: "bg-muted text-muted-foreground border-border",
};

export default function InlineWorkOrderSummary({ workOrderId }: Props) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["job_order_inline", workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select(`
          id, order_number, status, description, diagnosis,
          labor_cost, parts_cost, final_total, created_at,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, year, color)
        `)
        .eq("id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  if (isLoading) {
    return (
      <Card className="p-6 flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" /> جاري تحميل أمر العمل…
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-6 text-center text-muted-foreground text-sm">
        لم يتم العثور على أمر العمل
      </Card>
    );
  }

  const vehicle = data.vehicle
    ? `${data.vehicle.brand || ""} ${data.vehicle.model || ""} ${data.vehicle.year || ""}`.trim()
    : "—";
  const plate = data.vehicle?.plate_number || "—";
  const customer = data.customer?.name || "—";
  const total = Number(data.final_total) || (Number(data.labor_cost) || 0) + (Number(data.parts_cost) || 0);

  return (
    <Card className="p-5 border-blue-500/40 bg-gradient-to-bl from-blue-500/5 to-transparent">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center">
            <Wrench size={18} />
          </div>
          <div>
            <div className="font-bold text-foreground flex items-center gap-2">
              أمر العمل
              <span className="font-mono text-sm text-muted-foreground">#{data.order_number}</span>
            </div>
            <Badge variant="outline" className={`mt-1 text-[10px] ${STATUS_COLOR[data.status] || ""}`}>
              {STATUS_AR[data.status] || data.status}
            </Badge>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => navigate(`/work-orders/${data.id}`)}
          className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <ExternalLink size={13} /> فتح الصفحة الكاملة
        </Button>
      </div>

      {/* Info grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1"><User size={10} /> العميل</div>
          <div className="font-medium truncate" title={customer}>{customer}</div>
          {data.customer?.phone && (
            <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">{data.customer.phone}</div>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Car size={10} /> السيارة</div>
          <div className="font-medium truncate" title={vehicle}>{vehicle}</div>
          <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">{plate}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Calendar size={10} /> تاريخ الإنشاء</div>
          <div className="font-mono text-[12px]" dir="ltr">{new Date(data.created_at).toLocaleString("en-GB")}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground">الإجمالي التقديري</div>
          <div className="font-bold text-emerald-400 font-mono" dir="ltr">{total.toFixed(3)} OMR</div>
        </div>
      </div>

      {/* Description / Diagnosis */}
      {(data.description || data.diagnosis) && (
        <div className="mt-4 pt-3 border-t border-border space-y-2">
          {data.description && (
            <div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                <FileText size={10} /> الوصف
              </div>
              <p className="text-xs text-foreground leading-relaxed">{data.description}</p>
            </div>
          )}
          {data.diagnosis && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">التشخيص</div>
              <p className="text-xs text-foreground leading-relaxed">{data.diagnosis}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
