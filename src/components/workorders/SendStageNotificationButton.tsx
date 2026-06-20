// زر إرسال إشعار للعميل — يظهر تلقائياً حسب حالة أمر العمل الحالية
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface StageAction {
  key: string;
  label: string;
  variant?: "default" | "secondary" | "outline";
}

// خريطة حالة أمر العمل → الإشعارات المنطقية لإرسالها للعميل
const STATUS_ACTIONS: Record<string, StageAction[]> = {
  "تحت الفحص": [
    { key: "received", label: "📥 إشعار: تم استلام السيارة", variant: "outline" },
    { key: "inspection_started", label: "🔍 إشعار: بدأ الفحص" },
  ],
  "بانتظار الموافقة": [
    { key: "waiting_insurance", label: "⏳ إشعار: بانتظار اعتماد التأمين" },
    { key: "insurance_approved", label: "✅ إشعار: تم اعتماد التأمين", variant: "outline" },
  ],
  "بانتظار قطع الغيار": [
    { key: "waiting_parts", label: "📦 إشعار: تم طلب القطع" },
    { key: "parts_arrived", label: "🚚 إشعار: وصلت القطع", variant: "outline" },
  ],
  "تحت الإصلاح": [
    { key: "repair_started", label: "🔧 إشعار: بدأ الإصلاح" },
  ],
  "ضبط الجودة": [
    { key: "repair_started", label: "🔧 إشعار: مرحلة فحص الجودة", variant: "outline" },
  ],
  "جاهز للتسليم": [
    { key: "ready_for_pickup", label: "🛡️ إشعار: السيارة جاهزة للاستلام" },
  ],
  "تم التسليم": [
    { key: "delivered", label: "✅ إشعار: تأكيد التسليم" },
  ],
  "مغلق": [],
};

interface Props {
  jobOrderId: string;
  status?: string;
  tenantId?: string;
  className?: string;
}

export default function SendStageNotificationButton({ jobOrderId, status, tenantId, className }: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const actions = (status && STATUS_ACTIONS[status]) || [];

  async function sendStage(eventType: string) {
    setBusyKey(eventType);
    try {
      let tid = tenantId;
      if (!tid) {
        const { data: u } = await supabase.auth.getUser();
        const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", u.user!.id).maybeSingle();
        tid = prof?.tenant_id;
      }
      if (!tid) throw new Error("missing tenant");

      const { data: notifId, error } = await supabase.rpc("enqueue_customer_notification", {
        p_tenant_id: tid,
        p_job_order_id: jobOrderId,
        p_event_type: eventType,
        p_body: null,
        p_channel: null,
        p_force: true,
      });
      if (error) throw error;
      if (!notifId) {
        toast.error("لم يتم إنشاء الرسالة — تأكد من إعدادات الإشعارات");
        return;
      }

      const { data: sendData, error: sendErr } = await supabase.functions.invoke("send-customer-notification", {
        body: { notification_id: notifId },
      });
      if (sendErr) throw sendErr;
      if ((sendData as any)?.wa_url) {
        window.open((sendData as any).wa_url, "_blank");
        toast.success("تم فتح واتساب — راجع الرسالة قبل الإرسال");
      } else if ((sendData as any)?.ok) {
        toast.success("تم الإرسال ✅");
      } else {
        toast.error((sendData as any)?.error || "فشل الإرسال");
      }
    } catch (e: any) {
      toast.error(e.message || "خطأ");
    } finally {
      setBusyKey(null);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className || ""}`}>
      {actions.map((a) => (
        <Button
          key={a.key}
          size="sm"
          variant={a.variant || "default"}
          disabled={busyKey !== null}
          onClick={() => sendStage(a.key)}
          className="gap-1"
        >
          {busyKey === a.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
          {a.label}
        </Button>
      ))}
    </div>
  );
}
