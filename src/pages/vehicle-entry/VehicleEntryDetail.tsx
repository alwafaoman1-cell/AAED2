import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Edit, FileText, Printer, ShieldCheck, Trash2, Wrench, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildVehicleEntryHtml,
  convertVehicleEntryToClaim,
  createWorkOrderFromVehicleEntry,
  getVehicleEntry,
  issueVehicleEntry,
  softDeleteVehicleEntryMedia,
} from "@/lib/vehicleEntryService";
import { openAndPrintWindow, openSanitizedPdfWindow } from "@/lib/safePdfWindow";
import { toast } from "sonner";

function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cardTitle(ar: string, en: string) {
  return (
    <div>
      <h2 className="text-lg font-bold">{ar}</h2>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{en}</p>
    </div>
  );
}

export default function VehicleEntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [printing, setPrinting] = useState(false);

  const detail = useQuery({
    queryKey: queryKeys.vehicleEntries.detail(id),
    queryFn: () => getVehicleEntry(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  const issueMutation = useMutation({
    mutationFn: () => issueVehicleEntry(id!, user?.id),
    onSuccess: (row) => {
      qc.setQueryData(queryKeys.vehicleEntries.detail(id), row);
      qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      toast.success("تم إصدار استلام المركبة");
    },
    onError: (error: any) => toast.error(error?.message || "تعذر إصدار استلام المركبة"),
  });

  const workOrderMutation = useMutation({
    mutationFn: () => createWorkOrderFromVehicleEntry(id!, user?.id),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(id) });
      toast.success(result.existing ? "يوجد أمر عمل مرتبط مسبقًا" : "تم إنشاء أمر العمل");
      if (result.order_number || result.work_order_id) navigate(`/work-orders/${encodeURIComponent(result.order_number || result.work_order_id)}`);
    },
    onError: (error: any) => toast.error(error?.message || "تعذر إنشاء أمر العمل"),
  });

  const claimMutation = useMutation({
    mutationFn: () => convertVehicleEntryToClaim(id!, user?.id),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(id) });
      toast.success(result.existing ? "توجد مطالبة مرتبطة مسبقًا" : "تم إنشاء المطالبة");
      if (result.claim_id) navigate(`/insurance/${result.claim_id}`);
    },
    onError: (error: any) => toast.error(error?.message || "تعذر إنشاء المطالبة"),
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (mediaId: string) => softDeleteVehicleEntryMedia(id!, mediaId, user?.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(id) });
      toast.success("تم حذف الملف من نموذج الدخول");
    },
    onError: (error: any) => toast.error(error?.message || "تعذر حذف الملف"),
  });

  const entry = detail.data;

  function printEntry() {
    if (!entry) return;
    setPrinting(true);
    try {
      void openAndPrintWindow(buildVehicleEntryHtml(entry));
    } finally {
      setPrinting(false);
    }
  }

  function previewEntry() {
    if (!entry) return;
    openSanitizedPdfWindow(buildVehicleEntryHtml(entry));
  }

  if (detail.isLoading) {
    return <div className="p-6 text-center text-muted-foreground">جاري تحميل استلام المركبة...</div>;
  }

  if (detail.isError || !entry) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center">
          <p className="font-semibold text-destructive">تعذر تحميل استلام المركبة.</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate("/vehicle-entry")}>العودة للقائمة</Button>
        </Card>
      </div>
    );
  }

  const customer = entry.customers || {};
  const vehicle = entry.vehicles || {};
  const insurance = entry.insurance_snapshot || {};
  const deliveredBy = entry.delivered_by_snapshot || {};
  const damageMarks = entry.vehicle_entry_damage_marks || [];
  const media = entry.vehicle_media || [];
  const signatures = entry.vehicle_entry_signatures || [];
  const auditLogs = entry.vehicle_entry_audit_logs || [];

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/vehicle-entry")}><ArrowRight size={18} /></Button>
          <div>
            <h1 className="text-2xl font-bold">استلام مركبة {entry.entry_number}</h1>
            <p className="text-sm text-muted-foreground">Vehicle Entry & Receipt</p>
          </div>
          <Badge variant={entry.status === "Issued" ? "default" : "secondary"}>{entry.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={previewEntry} className="gap-2"><FileText size={16} /> معاينة</Button>
          <Button variant="outline" disabled={printing} onClick={printEntry} className="gap-2"><Printer size={16} /> طباعة</Button>
          {entry.status === "Draft" && (
            <Button variant="outline" disabled={issueMutation.isPending} onClick={() => issueMutation.mutate()} className="gap-2">
              <ShieldCheck size={16} /> إصدار
            </Button>
          )}
          <Button variant="outline" disabled={claimMutation.isPending} onClick={() => claimMutation.mutate()} className="gap-2"><Shield size={16} /> إنشاء/فتح مطالبة</Button>
          <Button variant="outline" disabled={workOrderMutation.isPending} onClick={() => workOrderMutation.mutate()} className="gap-2"><Wrench size={16} /> إنشاء/فتح أمر عمل</Button>
          <Button onClick={() => navigate(`/vehicle-entry/${entry.id}/edit`)} className="gap-2"><Edit size={16} /> تعديل</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 space-y-3">
          {cardTitle("بيانات الاستلام", "Receipt Details")}
          <Info label="رقم الاستلام" value={entry.entry_number} />
          <Info label="تاريخ ووقت الوصول" value={fmtDateTime(entry.arrival_at)} />
          <Info label="طريقة الوصول" value={entry.arrival_method} />
          <Info label="الموقع" value={[entry.vehicle_location_section, entry.vehicle_location_bay].filter(Boolean).join(" / ") || "—"} />
        </Card>
        <Card className="p-4 space-y-3">
          {cardTitle("العميل", "Customer")}
          <Info label="الاسم" value={customer.name || entry.customer_snapshot?.name} />
          <Info label="الهاتف" value={customer.phone || entry.customer_snapshot?.phone} />
          <Info label="الكود" value={customer.customer_code || "—"} />
          <Info label="المستلم من" value={deliveredBy.full_name} />
        </Card>
        <Card className="p-4 space-y-3">
          {cardTitle("المركبة", "Vehicle")}
          <Info label="اللوحة" value={[vehicle.plate_letters || entry.vehicle_snapshot?.plate_letters, vehicle.plate_number || entry.vehicle_snapshot?.plate_number].filter(Boolean).join(" ")} />
          <Info label="المركبة" value={[vehicle.make || entry.vehicle_snapshot?.make, vehicle.model || entry.vehicle_snapshot?.model, vehicle.year || entry.vehicle_snapshot?.year].filter(Boolean).join(" ")} />
          <Info label="VIN" value={vehicle.vin || entry.vehicle_snapshot?.vin || "—"} />
          <Info label="اللون" value={vehicle.color || entry.vehicle_snapshot?.color || "—"} />
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        {cardTitle("بيانات التأمين", "Insurance")}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Info label="شركة التأمين" value={insurance.insurance_company_name || "—"} />
          <Info label="رقم المطالبة" value={insurance.claim_number || "—"} />
          <Info label="رقم الوثيقة" value={insurance.policy_number || "—"} />
          <Info label="تاريخ الحادث" value={insurance.incident_date || "—"} />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        {cardTitle("حالة المركبة والأضرار", "Condition & Damage")}
        <DamageMapPreview marks={damageMarks} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Info label="حالة المركبة" value={entry.condition_snapshot?.condition_description || "—"} />
          <Info label="الأضرار الظاهرة" value={entry.condition_snapshot?.visible_damage || "—"} />
          <Info label="سبب الضرر/الحادث" value={entry.condition_snapshot?.incident_description || "—"} />
          <Info label="ملاحظات" value={entry.notes || "—"} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-right">#</th>
                <th className="p-2 text-right">الجزء</th>
                <th className="p-2 text-right">نوع الضرر</th>
                <th className="p-2 text-right">الوصف</th>
                <th className="p-2 text-right">الإجراء المتوقع</th>
              </tr>
            </thead>
            <tbody>
              {damageMarks.length === 0 ? (
                <tr><td className="p-4 text-center text-muted-foreground" colSpan={5}>لا توجد أضرار مفصلة.</td></tr>
              ) : damageMarks.map((mark: any) => (
                <tr key={mark.id} className="border-b">
                  <td className="p-2">{mark.mark_number}</td>
                  <td className="p-2">{mark.vehicle_part || "—"}</td>
                  <td className="p-2">{mark.damage_type || "—"}</td>
                  <td className="p-2">{mark.description || "—"}</td>
                  <td className="p-2">{mark.expected_action || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        {cardTitle("الصور والمستندات", "Media & Documents")}
        {media.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد صور أو مستندات مرفوعة.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {media.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold truncate">{item.file_name || item.storage_path}</div>
                    <div className="text-xs text-muted-foreground">{item.media_type} • {item.category}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive" disabled={deleteMediaMutation.isPending} onClick={() => deleteMediaMutation.mutate(item.id)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
                {item.public_url && item.media_type === "image" ? (
                  <img src={item.public_url} alt="" className="h-32 w-full rounded object-cover" />
                ) : item.public_url ? (
                  <a href={item.public_url} target="_blank" rel="noreferrer" className="text-primary underline">فتح الملف</a>
                ) : (
                  <span className="text-xs text-muted-foreground">لا يوجد رابط عام للملف</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        {cardTitle("الإقرار والتوقيعات", "Declaration & Signatures")}
        <p className="text-sm leading-7 text-muted-foreground">
          تم استلام المركبة بالحالة الموضحة أعلاه، وتبقى بيانات الاستلام والصور والمستندات مرتبطة بملف المركبة دون نسخ أو تكرار.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
          <SignatureBox label="توقيع المستلم" signature={signatures.find((s: any) => s.signature_role === "receiver")} />
          <SignatureBox label="توقيع العميل/المسلم" signature={signatures.find((s: any) => s.signature_role === "delivered_by")} />
          <SignatureBox label="ختم الورشة" />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        {cardTitle("السجل الزمني / التدقيق", "Timeline / Audit")}
        {auditLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد أحداث مسجلة بعد.</p>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((log: any) => (
              <div key={log.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{log.action}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(log.created_at)}</span>
                </div>
                {log.reason && <div className="text-muted-foreground mt-1">{log.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 font-semibold break-words">{value || "—"}</div>
    </div>
  );
}

function SignatureBox({ label, signature }: { label: string; signature?: any }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-4 min-h-28 flex flex-col items-center justify-end">
      <div className="h-14 w-full flex items-center justify-center">
        {signature?.signature_data_url && <img src={signature.signature_data_url} alt={label} className="max-h-14 max-w-full object-contain" />}
      </div>
      <div className="w-4/5 border-t border-foreground/60 pt-2 text-sm">{label}</div>
    </div>
  );
}

function DamageMapPreview({ marks }: { marks: any[] }) {
  if (!marks.some((mark) => mark.x != null && mark.y != null)) return null;
  return (
    <div className="relative mx-auto h-[300px] max-w-[230px] rounded-[36px] border-2 border-dashed border-primary/40 bg-gradient-to-b from-muted to-background">
      <div className="absolute left-1/2 top-5 h-12 w-24 -translate-x-1/2 rounded-t-full border border-border bg-background/80 text-center text-xs pt-3">Front</div>
      <div className="absolute left-1/2 top-24 h-32 w-32 -translate-x-1/2 rounded-[28px] border border-border bg-background/70" />
      <div className="absolute left-1/2 bottom-6 h-14 w-28 -translate-x-1/2 rounded-b-full border border-border bg-background/80 text-center text-xs pt-5">Rear</div>
      {marks.filter((mark) => mark.x != null && mark.y != null).map((mark) => (
        <div
          key={`${mark.mark_number}-${mark.x}-${mark.y}`}
          className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground"
          style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
        >
          {mark.mark_number}
        </div>
      ))}
    </div>
  );
}
