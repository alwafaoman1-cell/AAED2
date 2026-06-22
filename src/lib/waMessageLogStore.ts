import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export type WaMessageKind =
  | "parts_request"
  | "parts_request_supplier"
  | "ready_for_pickup"
  | "payment_followup"
  | "invoice_share"
  | "received"
  | "repair_started"
  | "waiting_parts"
  | "delivered"
  | "custom";

export interface WaMessageLog {
  id: string;
  workOrderId: string;
  kind: WaMessageKind;
  recipientName: string;
  recipientPhone: string;
  recipientType: "customer" | "supplier" | "insurance" | "other";
  preview: string;
  fullText: string;
  sentAt: string;
  sentBy?: string;
  status?: "pending" | "sent" | "failed" | "delivered" | "read";
  errorMessage?: string;
}

let cache: WaMessageLog[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const WA_KIND_LABELS: Record<WaMessageKind, string> = {
  parts_request: "طلب قطع غيار (للعميل)",
  parts_request_supplier: "طلب قطع غيار (للمورد)",
  ready_for_pickup: "إشعار جاهزية السيارة",
  payment_followup: "متابعة دفع/فاتورة",
  invoice_share: "إرسال فاتورة",
  received: "استلام السيارة",
  repair_started: "بدء الإصلاح",
  waiting_parts: "انتظار قطع الغيار",
  delivered: "تم التسليم",
  custom: "رسالة مخصصة",
};

async function refreshWaLogs() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  const { data, error } = await (supabase.from("whatsapp_logs" as any) as any)
    .select("id,job_order_id,message_kind,recipient_name,recipient_phone,recipient_type,message_body,status,error_message,sent_by,sent_at,created_at,job_orders(order_number)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.warn("[whatsappLogs] cloud fetch failed", error);
    return;
  }
  cache = (data || []).map((row: any) => ({
    id: row.id,
    workOrderId: row.job_orders?.order_number || row.job_order_id || "",
    kind: row.message_kind as WaMessageKind,
    recipientName: row.recipient_name || "",
    recipientPhone: row.recipient_phone,
    recipientType: row.recipient_type,
    preview: String(row.message_body || "").slice(0, 120),
    fullText: row.message_body || "",
    sentAt: row.sent_at || row.created_at,
    sentBy: row.sent_by || undefined,
    status: row.status,
    errorMessage: row.error_message || undefined,
  }));
  notify();
}

export function logWaMessage(): never {
  throw new Error("WhatsApp messages must be sent and logged by whatsapp-meta-send");
}

export function getWaLogsForOrder(orderId: string): WaMessageLog[] {
  return cache.filter((message) => message.workOrderId === orderId);
}

export function getAllWaLogs(): WaMessageLog[] {
  return cache;
}

export function deleteWaLog(id: string) {
  cache = cache.filter((message) => message.id !== id);
  notify();
  void (supabase.from("whatsapp_logs" as any) as any).delete().eq("id", id);
}

export function subscribeWaLogs(cb: () => void): () => void {
  listeners.add(cb);
  void refreshWaLogs();
  return () => listeners.delete(cb);
}

if (typeof window !== "undefined") {
  supabase.channel("whatsapp_logs_store_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_logs" }, () => {
      void refreshWaLogs();
    })
    .subscribe();
  supabase.auth.onAuthStateChange((_event, session) => {
    cache = [];
    notify();
    if (session?.user) void refreshWaLogs();
  });
}
