// زر/حوار موحّد لمشاركة مستند PDF عبر واتساب من أي مكان في الموقع.
// - يدعم منتقي بادئة الدولة (يُقرأ افتراضياً من الإعدادات).
// - يضع رقم العميل تلقائياً ويسمح بإرسال نفس الرسالة لرقم آخر عبر تبويب.
// - يُحوّل HTML إلى PDF حقيقي ثم يرفعه ويأخذ رابطاً موقّعاً.
// - يحاول الإرسال عبر Meta WhatsApp Cloud إذا كان مفعّلاً، وإلا يفتح wa.me مع الرابط.

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Send, Loader2, Copy, ExternalLink, CheckCircle2, User2, Phone } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription } from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { htmlToPdfBlob, uploadPdfBlob, isMetaWhatsAppEnabled, sendPdfViaMetaCloud, openWhatsAppShareLink } from "@/lib/whatsappShare";
import { normalizePhone } from "@/lib/phoneUtils";
import { COUNTRY_DIALS, getDefaultCountryCode, splitPhone } from "@/lib/countries";

interface Props {
  triggerLabel?: string;
  triggerClassName?: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  iconOnly?: boolean;
  /** HTML to convert to PDF (preferred) */
  htmlContent?: string;
  /** Or pass a ready-made Blob */
  blob?: Blob;
  fileBaseName: string;
  subFolder?: string;
  /** رقم العميل المرتبط بالمستند — تُستخرج منه البادئة والرقم تلقائياً */
  defaultPhone?: string;
  defaultMessage?: string;
  recipientName?: string;
  title?: string;
}

type Mode = "customer" | "other";

function PhoneRow({
  country, setCountry, local, setLocal, dir = "ltr",
}: {
  country: string; setCountry: (v: string) => void;
  local: string; setLocal: (v: string) => void; dir?: "ltr" | "rtl";
}) {
  return (
    <div className="flex gap-2" dir="ltr">
      <Select value={country} onValueChange={setCountry}>
        <SelectTrigger className="w-[120px] bg-secondary border-border text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {COUNTRY_DIALS.map(c => (
            <SelectItem key={c.iso} value={c.code} className="text-xs">
              <span className="me-1">{c.flag}</span>+{c.code} <span className="text-muted-foreground ms-1">{c.nameAr}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        dir="ltr"
        inputMode="tel"
        placeholder="رقم بدون البادئة"
        value={local}
        onChange={(e) => setLocal(e.target.value.replace(/\D/g, ""))}
        className="bg-secondary border-border flex-1"
      />
    </div>
  );
}

export default function WhatsAppShareButton({
  triggerLabel,
  triggerClassName,
  triggerVariant = "outline",
  size = "sm",
  iconOnly = false,
  htmlContent,
  blob,
  fileBaseName,
  subFolder = "shared",
  defaultPhone = "",
  defaultMessage = "",
  recipientName,
  title = "إرسال عبر واتساب",
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("customer");

  // Customer phone (from prop)
  const [custCountry, setCustCountry] = useState<string>(getDefaultCountryCode());
  const [custLocal, setCustLocal] = useState<string>("");
  // Other phone
  const [otherCountry, setOtherCountry] = useState<string>(getDefaultCountryCode());
  const [otherLocal, setOtherLocal] = useState<string>("");

  const [msg, setMsg] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [metaReady, setMetaReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    const split = splitPhone(defaultPhone);
    setCustCountry(split.country);
    setCustLocal(split.local);
    setOtherCountry(getDefaultCountryCode());
    setOtherLocal("");
    setMsg(defaultMessage);
    setDoneUrl(null);
    setMode(split.local ? "customer" : "other");
  }, [open, defaultPhone, defaultMessage]);

  useEffect(() => { if (open) isMetaWhatsAppEnabled().then(setMetaReady); }, [open]);

  const phoneClean = useMemo(() => {
    const c = mode === "customer" ? custCountry : otherCountry;
    const l = mode === "customer" ? custLocal : otherLocal;
    if (!l) return "";
    return normalizePhone(`+${c}${l.replace(/^0+/, "")}`);
  }, [mode, custCountry, custLocal, otherCountry, otherLocal]);

  async function buildBlob(): Promise<Blob | null> {
    if (blob) return blob;
    if (htmlContent) {
      try { return await htmlToPdfBlob(htmlContent, fileBaseName); }
      catch (e: any) { toast.error("فشل توليد PDF: " + (e?.message || "خطأ")); return null; }
    }
    toast.error("لا يوجد محتوى لإرساله");
    return null;
  }

  async function handleSend(useMeta: boolean) {
    setBusy(true);
    try {
      const b = await buildBlob();
      if (!b) return;
      const uploaded = await uploadPdfBlob(b, fileBaseName, subFolder);
      if (!uploaded?.url) { toast.error("تعذّر رفع الملف"); return; }
      setDoneUrl(uploaded.url);

      if (useMeta) {
        if (!phoneClean) { toast.error("أدخل رقم هاتف صحيح للإرسال عبر Meta Cloud"); return; }
        const r = await sendPdfViaMetaCloud({
          to: phoneClean, pdfUrl: uploaded.url, fileName: uploaded.fileName,
          caption: msg || undefined,
        });
        if (!r.ok) { toast.error("فشل إرسال Meta: " + (r.error || "")); return; }
        toast.success(`تم إرسال PDF إلى ${recipientName || phoneClean} عبر واتساب Meta ✅`);
      } else {
        openWhatsAppShareLink({ phone: phoneClean || undefined, caption: msg, pdfUrl: uploaded.url });
        toast.success("تم فتح واتساب مع رابط الملف");
      }
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!doneUrl) return;
    navigator.clipboard.writeText(doneUrl);
    toast.success("تم نسخ الرابط");
  }

  const hasCustomerPhone = !!custLocal;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          buttonVariants({ variant: triggerVariant, size }),
          "gap-1.5 text-emerald-600 hover:text-emerald-500 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10",
          triggerClassName,
        )}
        title="إرسال عبر واتساب"
      >
        <MessageCircle size={size === "icon" ? 16 : 14} />
        {!iconOnly && <span>{triggerLabel || "واتساب"}</span>}
      </button>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <MessageCircle size={16} className="text-emerald-500" />
            {title}
          </ResponsiveDialogTitle>
          {recipientName && (
            <ResponsiveDialogDescription>
              العميل: <b>{recipientName}</b>
              {hasCustomerPhone && <> — +{custCountry} {custLocal}</>}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <div className="space-y-3 p-1">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="customer" className="gap-1.5 text-xs">
                <User2 size={12} /> رقم العميل {recipientName ? `(${recipientName})` : ""}
              </TabsTrigger>
              <TabsTrigger value="other" className="gap-1.5 text-xs">
                <Phone size={12} /> رقم آخر
              </TabsTrigger>
            </TabsList>

            <TabsContent value="customer" className="space-y-1.5 mt-3">
              <Label className="text-xs">بادئة الدولة + الرقم</Label>
              <PhoneRow country={custCountry} setCountry={setCustCountry} local={custLocal} setLocal={setCustLocal} />
              {!hasCustomerPhone && (
                <p className="text-[10px] text-amber-500">⚠️ لا يوجد رقم محفوظ لهذا العميل — أدخله يدوياً أو استخدم تبويب «رقم آخر».</p>
              )}
            </TabsContent>

            <TabsContent value="other" className="space-y-1.5 mt-3">
              <Label className="text-xs">إرسال نفس الرسالة لرقم آخر</Label>
              <PhoneRow country={otherCountry} setCountry={setOtherCountry} local={otherLocal} setLocal={setOtherLocal} />
              <p className="text-[10px] text-muted-foreground">
                مفيد للإرسال لمندوب التأمين، أو شخص آخر يتابع نفس المستند.
              </p>
            </TabsContent>
          </Tabs>

          <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px]">
            {phoneClean
              ? <>📲 سيُرسَل إلى: <b dir="ltr">+{phoneClean}</b></>
              : <span className="text-muted-foreground">اتركه فارغاً ليفتح واتساب لاختيار جهة الاتصال يدوياً.</span>}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">رسالة مرافقة (اختياري)</Label>
            <Textarea
              rows={4}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="اكتب رسالة قصيرة لمرافقة الملف…"
              className="bg-secondary border-border text-sm"
              dir="auto"
            />
          </div>

          <div className="rounded-lg border border-border p-2.5 bg-secondary/30 text-[11px] text-muted-foreground space-y-1">
            <div>📄 <b>{fileBaseName}.pdf</b> — سيتم توليده ورفعه تلقائياً قبل الإرسال.</div>
            <div>{metaReady
              ? "✅ Meta WhatsApp Cloud مفعّل — يمكن إرسال الملف مباشرة داخل واتساب."
              : "ℹ️ Meta Cloud غير مفعّل — سيتم فتح واتساب الويب مع الرابط. فعّله من الإعدادات > التكاملات."}
            </div>
          </div>

          {doneUrl && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-500">
              <CheckCircle2 size={14} />
              <span className="flex-1 truncate">تم الرفع: {doneUrl}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={copyLink} title="نسخ"><Copy size={12} /></Button>
              <a href={doneUrl} target="_blank" rel="noopener" className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-emerald-500/20" title="فتح"><ExternalLink size={12} /></a>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">إلغاء</Button>
            <Button
              variant="outline"
              onClick={() => handleSend(false)}
              disabled={busy}
              className="flex-1 gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              فتح واتساب الويب
            </Button>
            {metaReady && (
              <Button
                onClick={() => handleSend(true)}
                disabled={busy || !phoneClean}
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                إرسال عبر Meta Cloud
              </Button>
            )}
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}
