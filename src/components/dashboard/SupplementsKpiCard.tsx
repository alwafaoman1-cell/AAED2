// بطاقة مؤشرات الأعمال الإضافية للوحات
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { FileEdit, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Stats {
  pending: number; approved: number; rejected: number; approvedValue: number;
}

export default function SupplementsKpiCard() {
  const [s, setS] = useState<Stats>({ pending: 0, approved: 0, rejected: 0, approvedValue: 0 });
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("work_order_supplements")
        .select("status,quantity,unit_price");
      if (!data) return;
      const stats: Stats = { pending: 0, approved: 0, rejected: 0, approvedValue: 0 };
      data.forEach((r: any) => {
        if (r.status === "pending_customer") stats.pending++;
        else if (r.status === "approved" || r.status === "executed") {
          stats.approved++;
          stats.approvedValue += Number(r.quantity || 0) * Number(r.unit_price || 0);
        } else if (r.status === "rejected") stats.rejected++;
      });
      setS(stats);
    })();

    const ch = supabase.channel("wos-kpi")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_order_supplements" }, () => {
        // refetch on change
        supabase.from("work_order_supplements").select("status,quantity,unit_price").then(({ data }) => {
          if (!data) return;
          const stats: Stats = { pending: 0, approved: 0, rejected: 0, approvedValue: 0 };
          data.forEach((r: any) => {
            if (r.status === "pending_customer") stats.pending++;
            else if (r.status === "approved" || r.status === "executed") { stats.approved++; stats.approvedValue += Number(r.quantity || 0) * Number(r.unit_price || 0); }
            else if (r.status === "rejected") stats.rejected++;
          });
          setS(stats);
        });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <Card className="p-4" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileEdit size={16} className="text-primary"/> الأعمال الإضافية
        </h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <div className="bg-warning/10 rounded p-2">
          <Clock className="mx-auto text-warning" size={18}/>
          <div className="text-xl font-bold text-warning mt-1">{s.pending}</div>
          <div className="text-[10px] text-muted-foreground">بانتظار الموافقة</div>
        </div>
        <div className="bg-success/10 rounded p-2">
          <CheckCircle2 className="mx-auto text-success" size={18}/>
          <div className="text-xl font-bold text-success mt-1">{s.approved}</div>
          <div className="text-[10px] text-muted-foreground">معتمدة</div>
        </div>
        <div className="bg-destructive/10 rounded p-2">
          <XCircle className="mx-auto text-destructive" size={18}/>
          <div className="text-xl font-bold text-destructive mt-1">{s.rejected}</div>
          <div className="text-[10px] text-muted-foreground">مرفوضة</div>
        </div>
        <div className="bg-primary/10 rounded p-2">
          <div className="text-lg font-bold text-primary mt-2">{s.approvedValue.toFixed(3)}</div>
          <div className="text-[10px] text-muted-foreground">قيمة المعتمد (ر.ع)</div>
        </div>
      </div>
    </Card>
  );
}
