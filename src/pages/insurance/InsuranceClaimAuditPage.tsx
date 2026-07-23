import { useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CarFront, ClipboardList, History, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateLatin } from "@/lib/numberUtils";
import { queryKeys } from "@/lib/queryKeys";

type AuditRow = {
  id: string;
  claim_id: string;
  vehicle_id?: string | null;
  user_id?: string | null;
  action: string;
  category?: string | null;
  file_path?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
};

export default function InsuranceClaimAuditPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: claim, isLoading: claimLoading } = useQuery({
    queryKey: queryKeys.claimAuditHeader(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claims")
        .select(`
          id, claim_number, vehicle_id, job_order_id, status, insurance_company,
          customer:customers(id, name, phone),
          vehicle:vehicles(id, plate_number, plate_code, plate_letters, brand, model, year)
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: rows = [], isLoading: auditLoading } = useQuery({
    queryKey: queryKeys.claimAuditFull(id),
    enabled: !!id,
    queryFn: async () => {
      const result = await supabase
        .from("claim_audit_logs" as any)
        .select("id,claim_id,vehicle_id,user_id,action,category,file_path,details,created_at")
        .eq("claim_id", id)
        .order("created_at", { ascending: false });
      if (!result.error) return (result.data || []) as unknown as AuditRow[];
      if (/vehicle_id|schema cache|column/i.test(String(result.error.message || ""))) {
        const fallback = await supabase
          .from("claim_audit_logs" as any)
          .select("id,claim_id,user_id,action,category,file_path,details,created_at")
          .eq("claim_id", id)
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return (fallback.data || []) as unknown as AuditRow[];
      }
      throw result.error;
    },
  });

  const grouped = useMemo(() => {
    return rows.reduce<Record<string, AuditRow[]>>((acc, row) => {
      const day = String(row.created_at || "").slice(0, 10) || "غير محدد";
      acc[day] = acc[day] || [];
      acc[day].push(row);
      return acc;
    }, {});
  }, [rows]);

  const vehicle = (claim as any)?.vehicle;
  const customer = (claim as any)?.customer;
  const vehicleTitle = [vehicle?.brand, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "—";
  const plate = [vehicle?.plate_code || vehicle?.plate_letters, vehicle?.plate_number].filter(Boolean).join(" ");

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" className="gap-2 px-0" onClick={() => navigate(`/insurance/${id}`)}>
            <ArrowRight size={16} />
            العودة للمطالبة
          </Button>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-foreground">
            <History className="text-primary" />
            سجل الإجراءات الكامل
          </h1>
          <p className="text-sm text-muted-foreground">
            كل الإجراءات محفوظة في Supabase ومربوطة بالمطالبة والمركبة.
          </p>
        </div>
        <Badge variant="outline" className="px-3 py-1 text-sm">{rows.length} إجراء</Badge>
      </div>

      <Card className="grid gap-4 p-5 md:grid-cols-4">
        <SummaryItem icon={<ShieldCheck size={18} />} label="رقم المطالبة" value={(claim as any)?.claim_number || "—"} />
        <SummaryItem icon={<UserRound size={18} />} label="العميل" value={customer?.name || "—"} />
        <SummaryItem icon={<CarFront size={18} />} label="المركبة" value={vehicleTitle} />
        <SummaryItem icon={<ClipboardList size={18} />} label="رقم اللوحة" value={plate || "—"} />
      </Card>

      {(claimLoading || auditLoading) ? (
        <Card className="p-8 text-center text-muted-foreground">جارٍ تحميل السجل...</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد أحداث مسجلة لهذه المطالبة بعد.</Card>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([day, dayRows]) => (
            <Card key={day} className="overflow-hidden">
              <div className="border-b bg-muted/40 px-5 py-3 font-bold text-primary">
                {formatDateLatin(day)}
              </div>
              <div className="divide-y">
                {dayRows.map((row) => (
                  <div key={row.id} className="grid gap-3 p-5 md:grid-cols-[180px_1fr]">
                    <div className="text-sm text-muted-foreground">
                      {formatDateLatin(row.created_at)}
                      <div className="mt-1 text-xs">المستخدم: {row.user_id || "—"}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground">{row.action}</span>
                        <Badge variant="secondary">{row.category || "audit"}</Badge>
                        {row.vehicle_id && <Badge variant="outline">مرتبط بالمركبة</Badge>}
                      </div>
                      {row.file_path && (
                        <div className="rounded-lg border bg-background/70 p-2 text-xs text-muted-foreground">
                          الملف: {row.file_path}
                        </div>
                      )}
                      {row.details && Object.keys(row.details).length > 0 && (
                        <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100 ltr text-left" dir="ltr">
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-bold text-foreground">{value}</div>
      </div>
    </div>
  );
}
