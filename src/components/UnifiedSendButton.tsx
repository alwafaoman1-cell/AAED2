// زر إرسال موحّد — قائمة منسدلة تجمع: WhatsApp / Email / SMS / رابط دفع
// يستفيد من المكوّنات والحوارات الحالية بدلاً من إعادة تنفيذها.
import { useState, useEffect, useRef } from "react";
import { Send, MessageCircle, Mail, Smartphone, CreditCard, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import WhatsAppShareButton from "@/components/whatsapp/WhatsAppShareButton";
import SmsDialog from "@/components/customers/SmsDialog";
import CreatePaymentLinkDialog from "@/components/payments/CreatePaymentLinkDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export interface UnifiedSendContext {
  /** اسم العميل أو المستلم */
  recipientName: string;
  /** هاتف العميل (للواتساب وSMS) */
  phone?: string;
  /** بريد العميل (للإيميل) */
  email?: string;
  /** المحتوى HTML الذي يُحوّل لـ PDF عند الإرسال */
  htmlContent?: string;
  /** اسم الملف الأساسي */
  fileBaseName: string;
  /** عنوان الموضوع للإيميل */
  emailSubject?: string;
  /** نص افتراضي للرسائل */
  defaultMessage?: string;
  /** إعدادات رابط الدفع — مرّرها لتفعيل خيار "إرسال رابط دفع" */
  payment?: {
    amount: number;
    currency?: string;
    sourceType: "invoice" | "insurance_invoice" | "quote";
    sourceId: string;
    sourceReference?: string;
    description?: string;
  };
}

interface Props {
  ctx: UnifiedSendContext;
  /** نص الزر */
  label?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
}

export default function UnifiedSendButton({
  ctx,
  label = "إرسال",
  size = "sm",
  variant = "default",
  className = "",
}: Props) {
  const [waOpen, setWaOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // Email state
  const [to, setTo] = useState(ctx.email || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(ctx.emailSubject || `${ctx.fileBaseName}`);
  const [body, setBody] = useState(ctx.defaultMessage || "");

  function handleEmailSend() {
    if (!to.trim()) { toast.error("أدخل بريد المستلم"); return; }
    const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}`;
    window.location.href = `mailto:${encodeURIComponent(to)}?${qs}`;
    toast.success("تم فتح تطبيق البريد ✉️");
    setEmailOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant={variant} className={`gap-1.5 ${className}`}>
            <Send size={14} />
            {label}
            <ChevronDown size={12} className="opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs flex items-center gap-1.5">
            <Send size={12} /> اختر وسيلة الإرسال
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setWaOpen(true)} className="gap-2 cursor-pointer">
            <MessageCircle size={16} className="text-emerald-500" />
            <div className="flex-1">
              <div className="text-sm">WhatsApp</div>
              <div className="text-[10px] text-muted-foreground">يرفع PDF ويفتح المحادثة</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setTo(ctx.email || "");
              setSubject(ctx.emailSubject || ctx.fileBaseName);
              setBody(ctx.defaultMessage || "");
              setEmailOpen(true);
            }}
            className="gap-2 cursor-pointer"
          >
            <Mail size={16} className="text-info" />
            <div className="flex-1">
              <div className="text-sm">Email</div>
              <div className="text-[10px] text-muted-foreground">
                {ctx.email ? ctx.email : "—"}
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setSmsOpen(true)}
            disabled={!ctx.phone}
            className="gap-2 cursor-pointer"
          >
            <Smartphone size={16} className="text-warning" />
            <div className="flex-1">
              <div className="text-sm">SMS</div>
              <div className="text-[10px] text-muted-foreground">
                {ctx.phone || "لا يوجد رقم"}
              </div>
            </div>
          </DropdownMenuItem>
          {ctx.payment && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPayOpen(true)}
                className="gap-2 cursor-pointer bg-success/5 focus:bg-success/15"
              >
                <CreditCard size={16} className="text-success" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">إرسال رابط الدفع</div>
                  <div className="text-[10px] text-muted-foreground">
                    {ctx.payment.amount} {ctx.payment.currency || "OMR"}
                  </div>
                </div>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* WhatsApp — يُفتح يدوياً عبر مرجع داخلي. نضع نسخة مخفية ونفعّلها بـ ref؟ بدلاً من ذلك نضع المكوّن داخل overlay مفتوح */}
      {waOpen && (
        <WhatsAppDialogPortal
          ctx={ctx}
          onClose={() => setWaOpen(false)}
        />
      )}

      {/* SMS */}
      {ctx.phone && (
        <SmsDialog
          open={smsOpen}
          onOpenChange={setSmsOpen}
          customer={{ name: ctx.recipientName, phone: ctx.phone }}
        />
      )}

      {/* Email */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={18} className="text-info" /> إرسال بالبريد
            </DialogTitle>
            <DialogDescription className="text-xs">
              عدّل ما تريد ثم اضغط إرسال — يفتح تطبيق البريد الافتراضي.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">المستلم *</Label>
                <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">نسخة (CC)</Label>
                <Input type="email" value={cc} onChange={(e) => setCc(e.target.value)} dir="ltr" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">العنوان</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="font-medium" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">نص الرسالة</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEmailOpen(false)}>إلغاء</Button>
            <Button onClick={handleEmailSend} className="gap-2">
              <Send size={14} /> فتح البريد وإرسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Link */}
      {ctx.payment && (
        <CreatePaymentLinkDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          amount={ctx.payment.amount}
          currency={ctx.payment.currency}
          customerName={ctx.recipientName}
          customerPhone={ctx.phone}
          customerEmail={ctx.email}
          sourceType={ctx.payment.sourceType}
          sourceId={ctx.payment.sourceId}
          sourceReference={ctx.payment.sourceReference}
          description={ctx.payment.description}
        />
      )}
    </>
  );
}

// Wrapper يضمن فتح حوار WhatsAppShareButton فوراً عند ظهوره ثم إغلاقه عند الانتهاء.
function WhatsAppDialogPortal({
  ctx, onClose,
}: { ctx: UnifiedSendContext; onClose: () => void }) {
  // نستخدم WhatsAppShareButton لكن نخفي زره ونعتمد على الفتح الافتراضي عبر autoOpen.
  // الحل العملي: نعرض زراً مرئياً بسيطاً يفتح مباشرة عند mount.
  // بما أن WhatsAppShareButton يفتح بنقرة، نضيف useEffect لفتحه.
  return (
    <AutoOpenWhatsApp ctx={ctx} onClose={onClose} />
  );
}

function AutoOpenWhatsApp({ ctx, onClose }: { ctx: UnifiedSendContext; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // افتح الحوار تلقائياً عبر نقر زر WhatsAppShareButton الموجود داخل الحاوية
    const btn = ref.current?.querySelector("button");
    btn?.click();
    // اضبط مراقبة الإغلاق: عند إغلاق الحوار، استدعِ onClose
    const observer = new MutationObserver(() => {
      // dialog يتم إزالته من الـ DOM عند الإغلاق
      if (!document.querySelector('[role="dialog"]')) {
        onClose();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [onClose]);
  return (
    <div ref={ref} className="hidden">
      <WhatsAppShareButton
        htmlContent={ctx.htmlContent}
        fileBaseName={ctx.fileBaseName}
        defaultPhone={ctx.phone || ""}
        defaultMessage={ctx.defaultMessage || ""}
        recipientName={ctx.recipientName}
        triggerLabel="WA"
      />
    </div>
  );
}
