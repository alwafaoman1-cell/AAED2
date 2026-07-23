import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Copy, Mail, MessageCircle, Phone, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildVehicleStayCustomerDraft,
  excludeVehicleStayAlert,
  getVehiclesOverStayAlerts,
  markVehicleStayContacted,
  type VehicleStayAlertRow,
} from "@/lib/vehicleStayAlerts";
import { queryKeys } from "@/lib/queryKeys";

type AgeFilter = "25" | "30" | "45" | "60";

export default function VehiclesOver30Days() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [age, setAge] = useState<AgeFilter>("30");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "not_sent" | "excluded">("all");

  const { data = [], isLoading, error } = useQuery({
    queryKey: queryKeys.reports.vehiclesOverStay(age),
    queryFn: () => getVehiclesOverStayAlerts(Number(age)),
  });

  const contactedMut = useMutation({
    mutationFn: (row: VehicleStayAlertRow) => markVehicleStayContacted(row, row.delay_reason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.reports.vehiclesOverStayAll });
      toast.success("تم تسجيل التواصل");
    },
    onError: (e: any) => toast.error(e?.message || "فشل تسجيل التواصل"),
  });

  const excludeMut = useMutation({
    mutationFn: excludeVehicleStayAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.reports.vehiclesOverStayAll });
      toast.success("تم استثناء المركبة من التنبيه");
    },
    onError: (e: any) => toast.error(e?.message || "فشل الاستثناء"),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return data.filter((row) => {
      if (statusFilter === "excluded" && !row.excluded) return false;
      if (statusFilter === "sent" && !row.last_contact_at) return false;
      if (statusFilter === "not_sent" && row.last_contact_at) return false;
      if (!q) return true;
      return [
        row.customer_name,
        row.plate_number,
        row.work_order_number,
        row.claim_number,
        row.insurance_company,
        row.delay_reason,
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [data, search, statusFilter]);

  function copyDraft(row: VehicleStayAlertRow) {
    navigator.clipboard.writeText(buildVehicleStayCustomerDraft(row));
    toast.success("تم نسخ مسودة الرسالة للمراجعة");
  }

  function whatsapp(row: VehicleStayAlertRow) {
    if (!row.customer_phone) {
      toast.error("لا يوجد رقم عميل");
      return;
    }
    const phone = row.customer_phone.replace(/[^\d+]/g, "");
    const text = encodeURIComponent(buildVehicleStayCustomerDraft(row));
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="text-primary" /> المركبات المتأخرة داخل الورشة
          </h1>
          <p className="text-sm text-muted-foreground">
            التنبيه يبدأ من تاريخ استلام المركبة فعليًا، وليس تاريخ إنشاء المطالبة.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/reports/center")}>مركز التقارير</Button>
      </div>

      <Card className="p-3 grid grid-cols-1 md:grid-cols-[1fr_180px_220px] gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالعميل، اللوحة، أمر العمل، المطالبة، شركة التأمين..." />
        <Select value={age} onValueChange={(v) => setAge(v as AgeFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="25">أكثر من 25 يومًا</SelectItem>
            <SelectItem value="30">أكثر من 30 يومًا</SelectItem>
            <SelectItem value="45">أكثر من 45 يومًا</SelectItem>
            <SelectItem value="60">أكثر من 60 يومًا</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل التنبيهات</SelectItem>
            <SelectItem value="sent">تم التواصل</SelectItem>
            <SelectItem value="not_sent">لم يتم التواصل</SelectItem>
            <SelectItem value="excluded">المستثناة</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">جاري تحميل التقرير...</Card>
      ) : error ? (
        <Card className="p-8 text-center text-destructive">{(error as Error).message}</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد مركبات مطابقة.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="p-2 text-right">الأيام</th>
                <th className="p-2 text-right">المركبة</th>
                <th className="p-2 text-right">العميل</th>
                <th className="p-2 text-right">أمر العمل</th>
                <th className="p-2 text-right">المطالبة</th>
                <th className="p-2 text-right">الحالة</th>
                <th className="p-2 text-right">سبب التأخير</th>
                <th className="p-2 text-right">آخر تواصل</th>
                <th className="p-2 text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={`${row.claim_id}-${row.work_order_id}`} className="border-b align-top">
                  <td className="p-2 font-bold" dir="ltr">{row.days_in_workshop}</td>
                  <td className="p-2">{row.vehicle_label}<div className="text-xs text-muted-foreground">{row.plate_number}</div></td>
                  <td className="p-2">{row.customer_name}<div className="text-xs text-muted-foreground">{row.customer_phone || "لا يوجد رقم"}</div></td>
                  <td className="p-2">{row.work_order_number || "—"}</td>
                  <td className="p-2">{row.claim_number || "—"}<div className="text-xs text-muted-foreground">{row.insurance_company || "—"}</div></td>
                  <td className="p-2"><Badge variant={row.excluded ? "outline" : "secondary"}>{row.excluded ? "مستثناة" : row.status || "—"}</Badge></td>
                  <td className="p-2">{row.delay_reason || row.recommended_action}</td>
                  <td className="p-2">{row.last_contact_at ? new Date(row.last_contact_at).toLocaleString("en-GB") : "لم يتم"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => copyDraft(row)} className="gap-1"><Copy size={12} /> مسودة</Button>
                      <Button size="sm" variant="outline" onClick={() => whatsapp(row)} className="gap-1"><MessageCircle size={12} /> WhatsApp</Button>
                      <Button size="sm" variant="outline" onClick={() => contactedMut.mutate(row)} className="gap-1"><Phone size={12} /> تم التواصل</Button>
                      <Button size="sm" variant="outline" onClick={() => toast.info("Email draft فقط — لا يوجد إرسال تلقائي")} className="gap-1"><Mail size={12} /> Email</Button>
                      <Button size="sm" variant="ghost" onClick={() => excludeMut.mutate(row)} className="gap-1 text-destructive"><ShieldOff size={12} /> استثناء</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
