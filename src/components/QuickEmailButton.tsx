import { useState } from "react";
import { Mail, Send, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  openQuickEmail,
  buildEmailSubject,
  buildEmailBody,
  type QuickEmailContext,
} from "@/lib/quickEmail";
import { supabase } from "@/integrations/supabase/client";
import { generatePdfFromHtml } from "@/lib/htmlToPdf";

interface Props {
  ctx: QuickEmailContext;
  /** البريد الافتراضي المقترح للمستلم */
  defaultTo?: string;
  /** خصائص الزر */
  buttonLabel?: string;
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  buttonSize?: "sm" | "default" | "lg" | "icon";
  buttonClassName?: string;
}

/**
 * زر "إرسال بالبريد" — يفتح نافذة جميلة فيها معاينة العنوان/الوصف
 * ويسمح بإرسال PDF كمرفق عبر Gmail المربوط، أو يعود لتطبيق البريد الافتراضي.
 */
export default function QuickEmailButton({
  ctx,
  defaultTo = "",
  buttonLabel = "إرسال بالبريد",
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(() => buildEmailSubject(ctx));
  const [body, setBody] = useState(() => buildEmailBody(ctx));
  const [attachPdf, setAttachPdf] = useState(Boolean(ctx.htmlContent));
  const [sending, setSending] = useState(false);

  const canAttachPdf = Boolean(ctx.htmlContent);

  async function blobToBase64(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error("أدخل بريد المستلم");
      return;
    }

    // محاولة إرسال عبر Gmail المربوط (مع مرفق PDF لو متاح)
    if (attachPdf && canAttachPdf) {
      setSending(true);
      try {
        const pdfBlob = await generatePdfFromHtml({
          htmlContent: ctx.htmlContent!,
          fileName: `${ctx.fileBaseName || subject}.pdf`,
          download: false,
        });
        const base64 = await blobToBase64(pdfBlob);
        const { data, error } = await supabase.functions.invoke("gmail-send", {
          body: {
            to,
            subject,
            html: body.replace(/\n/g, "<br>"),
            text: body,
            attachments: [{
              filename: `${ctx.fileBaseName || "document"}.pdf`,
              mimeType: "application/pdf",
              base64,
            }],
          },
        });
        if (error) throw error;
        if (data && data.ok === false) throw new Error(data.error || "send_failed");
        toast.success("تم الإرسال عبر Gmail ✉️ مع المرفق");
        setOpen(false);
        setSending(false);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "send_failed";
        // فشل Gmail — اعرض تنبيه ثم اسقط لـ mailto
        toast.warning(`تعذّر الإرسال عبر Gmail (${msg}) — سيُفتح تطبيق البريد الافتراضي`);
        setSending(false);
      }
    }

    // Fallback: mailto
    const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${
      cc ? `&cc=${encodeURIComponent(cc)}` : ""
    }`;
    window.location.href = `mailto:${encodeURIComponent(to)}?${qs}`;
    toast.success("تم فتح تطبيق البريد ✉️");
    setOpen(false);
  };

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        className={`gap-2 ${buttonClassName}`}
        onClick={(e) => {
          e.stopPropagation();
          // أعد بناء العنوان والوصف من الـ ctx الحالي عند كل فتح
          setSubject(buildEmailSubject(ctx));
          setBody(buildEmailBody(ctx));
          setOpen(true);
        }}
      >
        <Mail size={14} />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Mail className="text-primary" size={20} />
              إرسال بالبريد الإلكتروني
            </DialogTitle>
            <DialogDescription className="text-xs">
              يتم تعبئة العنوان والوصف تلقائياً. عدّل ما تريد ثم اضغط إرسال — سيفتح تطبيق البريد الافتراضي.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">المستلم *</Label>
                <Input
                  type="email"
                  placeholder="recipient@example.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">نسخة (CC)</Label>
                <Input
                  type="email"
                  placeholder="cc@example.com"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">العنوان</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="font-medium"
              />
              <p className="text-[10px] text-muted-foreground">
                يحتوي تلقائياً على ماركة السيارة + رقم اللوحة + رقم المطالبة.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">نص الرسالة</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={9}
                className="font-mono text-sm leading-relaxed"
              />
            </div>

            {canAttachPdf && (
              <label className="flex items-center gap-2 p-2 rounded-md bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors">
                <Checkbox
                  checked={attachPdf}
                  onCheckedChange={(v) => setAttachPdf(Boolean(v))}
                />
                <Paperclip size={14} className="text-primary" />
                <span className="text-xs">
                  إرفاق PDF وإرسال عبر Gmail المربوط (إن فشل، يفتح تطبيق البريد)
                </span>
              </label>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              إلغاء
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending}
              className="gap-2 gradient-gold text-primary-foreground"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "جاري الإرسال..." : attachPdf && canAttachPdf ? "إرسال مع PDF" : "فتح البريد وإرسال"}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </>
  );
}
