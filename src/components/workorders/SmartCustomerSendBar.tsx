// شريط إرسال ذكي للعميل — 3 رسائل سريعة (حالة فقط / صورة فقط / كلاهما)
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Send, Image as ImgIcon, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";
import { buildCustomerPortalUrl } from "@/lib/customerPortalTokens";
import { useWorkOrderPortalToken } from "@/hooks/useWorkOrderPortalToken";
import { buildCustomerPortalInvitation } from "@/lib/customerPortalInvitation";

interface Props {
  jobOrderId: string;          // cloud uuid
  orderNumber: string;
  status: string;
  customerName?: string;
  customerPhone?: string;
}

export default function SmartCustomerSendBar({ jobOrderId, customerName, customerPhone }: Props) {
  const portal=useWorkOrderPortalToken(jobOrderId);
  const { i18n } = useTranslation(); const en = i18n.language.startsWith("en");
  const [busy, setBusy] = useState<string | null>(null);

  async function send(kind: "status" | "photo" | "both") {
    if (!customerPhone) { toast.error(en ? "The customer has no phone number" : "لا يوجد رقم هاتف للعميل"); return; }
    setBusy(kind);
    try {
      const info = portal.data?.token ? portal.data : await portal.ensure();
      if (!info.token || info.enabled === false || (info.expires_at && !(Date.parse(info.expires_at) > Date.now()))) throw new Error(en ? "The customer portal is unavailable" : "بوابة العميل غير متاحة");
      const msg = buildCustomerPortalInvitation({ customerName: info.customer_name || customerName,
        vehicleMake: info.vehicle_make, vehicleModel: info.vehicle_model, vehicleYear: info.vehicle_year,
        url: buildCustomerPortalUrl(info.token) }, en ? "en" : "ar");
      await sendWhatsAppMessage({
        message: msg,
        phone: customerPhone,
        workOrderId: jobOrderId,
        kind: "custom",
        recipientName: customerName,
        recipientType: "customer",
      });
      toast.success(en ? "Customer portal update sent via WhatsApp" : "تم إرسال التحديث عبر واتساب");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : en ? "Message could not be sent" : "تعذر إرسال الرسالة");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-info/10 border border-info/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Bell size={14} className="text-info" />
        {en ? "Send customer portal update via WhatsApp" : "إرسال تحديث للعميل عبر واتساب"}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" disabled={busy !== null || !customerPhone} onClick={() => send("status")} className="gap-1">
          {busy === "status" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
          {en ? "Status updated" : "تم تحديث الحالة"}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null || !customerPhone} onClick={() => send("photo")} className="gap-1">
          {busy === "photo" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImgIcon size={12} />}
          {en ? "Photo added" : "تم إضافة صورة"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null || !customerPhone} onClick={() => send("both")} className="gap-1">
          {busy === "both" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
          {en ? "Photo + status" : "صورة + حالة"}
        </Button>
      </div>
      {!customerPhone && (
        <p className="text-[10px] text-warning">⚠ {en ? "The customer has no phone number" : "لا يوجد رقم هاتف للعميل"}</p>
      )}
    </div>
  );
}
