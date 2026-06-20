// شريط إرسال ذكي للعميل — 3 رسائل سريعة (حالة فقط / صورة فقط / كلاهما)
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Image as ImgIcon, Bell, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  jobOrderId: string;          // cloud uuid
  orderNumber: string;
  status: string;
  customerName?: string;
  customerPhone?: string;
}

function buildWaUrl(phone: string, text: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export default function SmartCustomerSendBar({ jobOrderId, orderNumber, status, customerName, customerPhone }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("customer_portal_tokens")
        .select("token")
        .eq("job_order_id", jobOrderId)
        .maybeSingle();
      if (mounted) setToken((data as any)?.token || null);
    })();
    return () => { mounted = false; };
  }, [jobOrderId]);

  function trackUrl() {
    if (!token) return "";
    return `${window.location.origin}/p/${token}`;
  }

  function send(kind: "status" | "photo" | "both") {
    if (!customerPhone) { toast.error("لا يوجد رقم هاتف للعميل"); return; }
    setBusy(kind);
    try {
      const greet = customerName ? `مرحباً ${customerName}،\n` : "";
      let msg = "";
      if (kind === "status") {
        msg = `${greet}تم تحديث حالة أمر العمل ${orderNumber} إلى: *${status}*`;
      } else if (kind === "photo") {
        msg = `${greet}تم إضافة صورة جديدة لمركبتك (${orderNumber}).`;
      } else {
        msg = `${greet}تم إضافة صورة وتحديث الحالة لأمر العمل ${orderNumber}.\nالحالة الحالية: *${status}*`;
      }
      const link = trackUrl();
      if (link) msg += `\n\n🔗 تابع التفاصيل: ${link}`;
      window.open(buildWaUrl(customerPhone, msg), "_blank");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-info/10 border border-info/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Bell size={14} className="text-info" />
        إرسال تحديث للعميل عبر واتساب
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" disabled={busy !== null || !customerPhone} onClick={() => send("status")} className="gap-1">
          {busy === "status" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
          تم تحديث الحالة
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null || !customerPhone} onClick={() => send("photo")} className="gap-1">
          {busy === "photo" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImgIcon size={12} />}
          تم إضافة صورة
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null || !customerPhone} onClick={() => send("both")} className="gap-1">
          {busy === "both" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
          صورة + حالة
        </Button>
      </div>
      {!customerPhone && (
        <p className="text-[10px] text-warning">⚠ لا يوجد رقم هاتف للعميل</p>
      )}
    </div>
  );
}
