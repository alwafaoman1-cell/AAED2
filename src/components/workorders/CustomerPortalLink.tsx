import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Copy, Link2, MessageCircle, Loader2, ShieldCheck, PenLine, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getWorkOrderById, type WorkItem } from "@/lib/workOrdersStore";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";

interface Props {
  jobOrderId: string;
  customerPhone?: string;
  orderNumber?: string;
  /** local work-order id (display number) — used to fetch work items for the welcome message */
  localOrderId?: string;
  customerName?: string;
}

export default function CustomerPortalLink({ jobOrderId, customerPhone, orderNumber, localOrderId, customerName }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signed, setSigned] = useState<boolean>(false);

  async function loadToken() {
    setLoading(true);
    const { data } = await supabase
      .from("customer_portal_tokens")
      .select("token, signed_at")
      .eq("job_order_id", jobOrderId)
      .maybeSingle();
    if (data?.token) {
      setToken(data.token);
      setSigned(!!data.signed_at);
    }
    setLoading(false);
  }
  useEffect(() => { loadToken(); }, [jobOrderId]);

  const trackUrl = token ? `${window.location.origin}/p/${token}` : "";
  const signUrl = token ? `${window.location.origin}/sign/${token}` : "";

  function copy(text: string, label: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`تم نسخ ${label}`);
  }

  function buildWelcomeMessage(): string {
    const wo = localOrderId ? getWorkOrderById(localOrderId) : null;
    const items: WorkItem[] = wo?.workItems || [];
    const nameLine = customerName ? `مرحباً ${customerName} 👋\n` : "مرحباً 👋\n";
    const orderLine = `تم استلام مركبتك في الورشة. أمر العمل: ${orderNumber || ""}\n`;
    const itemsBlock = items.length > 0
      ? `\n📋 الأعمال المطلوبة:\n${items.map((w, i) => `${i + 1}. ${w.title}${w.note ? ` (${w.note})` : ""}`).join("\n")}\n`
      : "";
    const signLine = `\n✍️ نرجو التكرّم بالتوقيع الإلكتروني على أمر العمل عبر الرابط التالي:\n${signUrl}\n`;
    const trackLine = `\n🔗 لمتابعة حالة الإصلاح في أي وقت:\n${trackUrl}\n`;
    return nameLine + orderLine + itemsBlock + signLine + trackLine + "\nشكراً لثقتك بنا.";
  }

  async function shareWelcomeWhatsApp() {
    if (!token) return;
    const msg = buildWelcomeMessage();
    try {
      await sendWhatsAppMessage({ message: msg, phone: customerPhone, workOrderId: jobOrderId, recipientName: customerName });
      toast.success("تم إرسال رسالة الترحيب");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }

  async function shareTrackOnly() {
    if (!trackUrl) return;
    const msg = `مرحباً، يمكنك متابعة حالة إصلاح مركبتك ${orderNumber ? `(${orderNumber})` : ""} عبر الرابط التالي:\n${trackUrl}`;
    try {
      await sendWhatsAppMessage({ message: msg, phone: customerPhone, workOrderId: jobOrderId, recipientName: customerName });
      toast.success("تم إرسال رابط المتابعة");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground">رابط العميل / Customer Links</h3>
      </div>

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : !token ? (
        <p className="text-xs text-muted-foreground">سيتم إنشاء الرابط تلقائياً بعد مزامنة أمر العمل مع السحابة.</p>
      ) : (
        <>
          {/* SIGN section — primary CTA */}
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PenLine size={14} className="text-primary" />
                <span className="text-sm font-bold text-foreground">رابط التوقيع الإلكتروني</span>
              </div>
              {signed ? (
                <span className="text-[10px] font-bold bg-success/15 text-success border border-success/30 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <CheckCircle2 size={11} /> تم التوقيع
                </span>
              ) : (
                <span className="text-[10px] font-bold bg-warning/15 text-warning border border-warning/30 rounded-full px-2 py-0.5 flex items-center gap-1 animate-pulse">
                  ⚠ لم يوقّع بعد
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5 overflow-hidden">
              <Link2 size={12} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-foreground font-mono truncate" dir="ltr">{signUrl}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={shareWelcomeWhatsApp} className="bg-green-600 hover:bg-green-700 text-white gap-1">
                <MessageCircle size={14} /> إرسال للعميل (ترحيب + توقيع)
              </Button>
              <Button size="sm" variant="outline" onClick={() => copy(signUrl, "رابط التوقيع")} className="gap-1">
                <Copy size={13} /> نسخ
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.open(signUrl, "_blank")}>معاينة</Button>
            </div>
          </div>

          {/* TRACK section */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
            <div className="text-xs font-bold text-foreground">رابط متابعة حالة الإصلاح</div>
            <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1.5 overflow-hidden">
              <Link2 size={12} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-foreground font-mono truncate" dir="ltr">{trackUrl}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={shareTrackOnly} className="gap-1">
                <MessageCircle size={14} /> إرسال
              </Button>
              <Button size="sm" variant="outline" onClick={() => copy(trackUrl, "رابط المتابعة")} className="gap-1">
                <Copy size={13} /> نسخ
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
