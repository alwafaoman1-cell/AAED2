import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessageCircle, Send, Phone, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toE164, isValidE164 } from "@/lib/phoneUtils";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: { name: string; phone?: string };
}

const TEMPLATES = [
  { label: "تذكير بموعد", text: "مرحباً {name}، نذكركم بموعد الصيانة في ورشة الوفاء. شكراً لاختياركم خدماتنا." },
  { label: "جاهزة للاستلام", text: "السيارة جاهزة للاستلام يا {name}. يمكنكم المرور بالورشة في أي وقت خلال أوقات الدوام." },
  { label: "شكر بعد الخدمة", text: "نشكركم {name} على ثقتكم بخدمات ورشة الوفاء. نرجو تقييم تجربتكم." },
];

export default function SmsDialog({ open, onOpenChange, customer }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  function applyTemplate(t: string) {
    setText(t.replace("{name}", customer.name));
  }

  async function sendWhatsApp() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    if (!text.trim()) { toast.error("اكتب نص الرسالة"); return; }
    try {
      await sendWhatsAppMessage({ message: text, phone: customer.phone, recipientName: customer.name, recipientType: "customer" });
      toast.success("تم إرسال الرسالة عبر واتساب");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }

  function sendSmsNative() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    if (!text.trim()) { toast.error("اكتب نص الرسالة"); return; }
    const phone = customer.phone.replace(/\s/g, "");
    window.location.href = `sms:${phone}?body=${encodeURIComponent(text)}`;
    toast.success("تم فتح تطبيق الرسائل");
    onOpenChange(false);
  }

  async function sendSmsTwilio() {
    if (!customer.phone) { toast.error("لا يوجد رقم جوال"); return; }
    if (!text.trim()) { toast.error("اكتب نص الرسالة"); return; }
    setSending(true);
    try {
      const to = toE164(customer.phone);
      if (!isValidE164(to)) {
        toast.error(`رقم غير صالح: ${to} — استخدم صيغة دولية مثل +9689xxxxxxx`);
        setSending(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { to, message: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("تم إرسال SMS عبر Twilio ✅");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "فشل الإرسال — تحقق من /settings/sms");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle size={18} className="text-primary" /> إرسال رسالة لـ {customer.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {customer.phone && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5" dir="ltr">
              <Phone size={11} className="text-primary" /> {customer.phone}
            </div>
          )}
          <div>
            <Label className="text-xs">قوالب جاهزة</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => applyTemplate(t.text)}
                  className="text-[11px] px-2 py-1 rounded bg-secondary border border-border hover:border-primary/40 transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">نص الرسالة</Label>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك هنا..." />
            <p className="text-[10px] text-muted-foreground mt-1">{text.length} حرف</p>
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button variant="outline" onClick={sendSmsNative} className="gap-1.5">
            <Send size={14} /> SMS تطبيق
          </Button>
          <Button onClick={sendSmsTwilio} disabled={sending} variant="secondary" className="gap-1.5">
            <Zap size={14} /> {sending ? "جارِ الإرسال…" : "SMS تلقائي (Twilio)"}
          </Button>
          <Button onClick={sendWhatsApp} className="gradient-gold text-primary-foreground gap-1.5">
            <MessageCircle size={14} /> WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
