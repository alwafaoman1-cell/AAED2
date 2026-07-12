import { supabase } from "@/integrations/supabase/client";

export interface VehicleStayAlertRow {
  claim_id: string | null;
  work_order_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  vehicle_label: string;
  plate_number: string;
  work_order_number: string | null;
  claim_number: string | null;
  insurance_company: string | null;
  status: string | null;
  received_at: string;
  delivered_at: string | null;
  days_in_workshop: number;
  delay_reason: string | null;
  last_contact_at: string | null;
  alert_level: "day_25" | "day_30" | "day_37" | "day_45" | "weekly";
  recommended_action: string;
  excluded: boolean;
}

const CLOSED_STATUSES = new Set(["delivered", "cancelled", "closed", "paid", "rejected"]);

function daysBetween(startIso: string, end = new Date()) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function alertLevel(days: number): VehicleStayAlertRow["alert_level"] {
  if (days >= 45) return "day_45";
  if (days >= 37) return "day_37";
  if (days >= 30) return "day_30";
  return "day_25";
}

function recommendedAction(days: number) {
  if (days >= 45) return "تصعيد للمدير ومراجعة سبب التأخير";
  if (days >= 37) return "متابعة ثانية مع العميل/التأمين";
  if (days >= 30) return "مراجعة داخلية وتجهيز مسودة رسالة للعميل";
  return "تنبيه داخلي مبكر للموظف المسؤول";
}

export async function getVehiclesOverStayAlerts(minDays = 25): Promise<VehicleStayAlertRow[]> {
  const { data, error } = await supabase
    .from("insurance_claims" as any)
    .select(`
      id,
      claim_number,
      status,
      insurance_company,
      customer_id,
      vehicle_id,
      workshop_arrival_date,
      received_at,
      delivered_at,
      vehicle_stay_delay_reason,
      vehicle_stay_last_contact_at,
      vehicle_stay_alert_excluded,
      customer:customers(id,name,phone),
      vehicle:vehicles(id,brand,model,plate_number)
    `)
    .order("workshop_arrival_date", { ascending: true, nullsFirst: false });
  if (error) throw error;

  const claimIds = (data || []).map((claim: any) => claim.id).filter(Boolean);
  const workOrdersByClaim = new Map<string, any>();
  if (claimIds.length) {
    const { data: workOrders, error: workOrdersError } = await supabase
      .from("job_orders")
      .select("id,order_number,status,claim_id")
      .in("claim_id", claimIds);
    if (workOrdersError) throw workOrdersError;
    for (const workOrder of workOrders || []) {
      if (workOrder.claim_id && !workOrdersByClaim.has(workOrder.claim_id)) {
        workOrdersByClaim.set(workOrder.claim_id, workOrder);
      }
    }
  }

  const now = new Date();
  return (data || [])
    .map((claim: any) => {
      const jobOrder = workOrdersByClaim.get(claim.id);
      const receivedAt = claim.workshop_arrival_date || claim.received_at;
      const deliveredAt = claim.delivered_at;
      const status = String(claim.status || jobOrder?.status || "").toLowerCase();
      const days = receivedAt ? daysBetween(receivedAt, now) : 0;
      const vehicleLabel = [claim.vehicle?.brand, claim.vehicle?.model].filter(Boolean).join(" ") || "—";
      return {
        claim_id: claim.id,
        work_order_id: jobOrder?.id || null,
        customer_id: claim.customer_id,
        vehicle_id: claim.vehicle_id,
        customer_name: claim.customer?.name || "—",
        customer_phone: claim.customer?.phone || null,
        vehicle_label: vehicleLabel,
        plate_number: claim.vehicle?.plate_number || "—",
        work_order_number: jobOrder?.order_number || null,
        claim_number: claim.claim_number || null,
        insurance_company: claim.insurance_company || null,
        status: claim.status || null,
        received_at: receivedAt,
        delivered_at: deliveredAt,
        days_in_workshop: days,
        delay_reason: claim.vehicle_stay_delay_reason || null,
        last_contact_at: claim.vehicle_stay_last_contact_at || null,
        alert_level: alertLevel(days),
        recommended_action: recommendedAction(days),
        excluded: Boolean(claim.vehicle_stay_alert_excluded),
      } as VehicleStayAlertRow;
    })
    .filter((row) => row.received_at && !row.delivered_at)
    .filter((row) => !CLOSED_STATUSES.has(String(row.status || "").toLowerCase()))
    .filter((row) => row.days_in_workshop >= minDays);
}

export function buildVehicleStayCustomerDraft(row: VehicleStayAlertRow) {
  return `عزيزي العميل،
نود إفادتكم بأن مركبتكم موجودة لدى الورشة منذ ${row.days_in_workshop} يومًا. يرجى التواصل معنا لمراجعة حالة المركبة والإجراءات المطلوبة، أو لتنسيق الاستلام عند جاهزيتها.
رقم أمر العمل: ${row.work_order_number || "—"}
رقم المطالبة: ${row.claim_number || "—"}

يمكنكم مراجعة شركة التأمين بشأن استحقاق سيارة بديلة أو بدل إيجار، وفقًا لشروط وثيقة التأمين وموافقة شركة التأمين.

شركة الوفاء للأعمال المتكاملة.`;
}

export async function markVehicleStayContacted(row: VehicleStayAlertRow, note?: string) {
  if (!row.claim_id) throw new Error("لا توجد مطالبة مرتبطة");
  const { error } = await supabase
    .from("insurance_claims" as any)
    .update({
      vehicle_stay_last_contact_at: new Date().toISOString(),
      vehicle_stay_delay_reason: note || row.delay_reason || null,
    } as any)
    .eq("id", row.claim_id);
  if (error) throw error;
}

export async function excludeVehicleStayAlert(row: VehicleStayAlertRow) {
  if (!row.claim_id) throw new Error("لا توجد مطالبة مرتبطة");
  const { error } = await supabase
    .from("insurance_claims" as any)
    .update({ vehicle_stay_alert_excluded: true } as any)
    .eq("id", row.claim_id);
  if (error) throw error;
}
