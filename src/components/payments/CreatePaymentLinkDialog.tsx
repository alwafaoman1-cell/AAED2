// زر "إنشاء رابط دفع" يُستخدم في صفحات الفواتير
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription } from "@/components/ui/responsive-dialog";
import { CreditCard, Copy, MessageCircle, Mail, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openWhatsApp } from "@/lib/phoneUtils";

type Gateway = "stripe" | "thawani" | "myfatoorah" | "paytabs" | "tap";
const LABELS: Record<Gateway, string> = {
  stripe: "Stripe", thawani: "Thawani (عُمان)", myfatoorah: "MyFatoorah",
  paytabs: "PayTabs", tap: "Tap Payments",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amount: number;
  currency?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  sourceType: "invoice" | "insurance_invoice" | "quote";
  sourceId: string;
  sourceReference?: string;
  description?: string;
}

export default function CreatePaymentLinkDialog(props: Props) {
  const [available, setAvailable] = useState<{ gateway: Gateway; isDefault: boolean }[]>([]);
  const [gateway, setGateway] = useState<Gateway | "">("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ url: string; id: string } | null>(null);

  useEffect(() => {
    if (!props.open) { setLink(null); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("tenant_integrations")
        .select("provider, enabled, config")
        .like("provider", "pg_%").eq("enabled", true);
      const list = (data || []).map((r: any) => ({
        gateway: r.provider.replace(/^pg_/, "") as Gateway,
        isDefault: !!r.config?.is_default,
      }));
      setAvailable(list);
      const def = list.find((x) => x.isDefault) || list[0];
      if (def) setGateway(def.gateway);
      setLoading(false);
    })();
  }, [props.open]);

  async function create() {
    if (!gateway) { toast.error("اختر بوابة"); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment-link", {
        body: {
          gateway,
          amount: props.amount,
          currency: props.currency || "OMR",
          customer_name: props.customerName,
          customer_phone: props.customerPhone,
          customer_email: props.customerEmail,
          source_type: props.sourceType,
          source_id: props.sourceId,
          source_reference: props.sourceReference,
          description: props.description,
        },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "فشل");
      setLink({ url: (data as any).url, id: (data as any).id });
      toast.success("تم إنشاء رابط الدفع ✅");
    } catch (e: any) {
      toast.error(e.message || "فشل إنشاء الرابط");
    } finally {
      setCreating(false);
    }
  }

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link.url);
    toast.success("نُسخ الرابط");
  }
  function shareWa() {
    if (!link) return;
    const msg = `مرحباً ${props.customerName}،\nرابط دفع فاتورتك ${props.sourceReference || ""} بقيمة ${props.amount} ${props.currency || "OMR"}:\n${link.url}\nشكراً — ورشة الوفاء`;
    openWhatsApp(msg, props.customerPhone);
  }
  function shareEmail() {
    if (!link || !props.customerEmail) { toast.error("لا يوجد بريد للعميل"); return; }
    const subject = encodeURIComponent(`رابط دفع الفاتورة ${props.sourceReference || ""}`);
    const body = encodeURIComponent(`مرحباً ${props.customerName}،\n\nيمكنكم دفع المبلغ ${props.amount} ${props.currency || "OMR"} عبر الرابط:\n${link.url}\n\nشكراً.`);
    window.open(`mailto:${props.customerEmail}?subject=${subject}&body=${body}`);
  }

  return (
    <ResponsiveDialog open={props.open} onOpenChange={props.onOpenChange}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>إنشاء رابط دفع إلكتروني</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          المبلغ: {props.amount} {props.currency || "OMR"} — العميل: {props.customerName}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="space-y-4 p-1">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline" /> جارِ التحميل…</div>
        ) : available.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-muted-foreground">لا توجد بوابة دفع مفعّلة.</p>
            <Button asChild size="sm" variant="outline">
              <a href="/settings/payment-gateways"><ExternalLink size={14} className="ml-1" /> فتح إعدادات البوابات</a>
            </Button>
          </div>
        ) : !link ? (
          <>
            <div>
              <Label className="text-xs">البوابة</Label>
              <Select value={gateway} onValueChange={(v) => setGateway(v as Gateway)}>
                <SelectTrigger><SelectValue placeholder="اختر بوابة" /></SelectTrigger>
                <SelectContent>
                  {available.map((a) => (
                    <SelectItem key={a.gateway} value={a.gateway}>
                      {LABELS[a.gateway]} {a.isDefault && "⭐"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">المبلغ:</span> <b>{props.amount} {props.currency || "OMR"}</b></div>
              <div><span className="text-muted-foreground">العميل:</span> <b>{props.customerName}</b></div>
              {props.customerPhone && <div><span className="text-muted-foreground">جوال:</span> {props.customerPhone}</div>}
              {props.customerEmail && <div><span className="text-muted-foreground">بريد:</span> {props.customerEmail}</div>}
            </div>
            <Button onClick={create} disabled={creating || !gateway} className="w-full gap-2">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
              {creating ? "جارِ إنشاء الرابط…" : "إنشاء رابط الدفع"}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="bg-success/10 border border-success/30 rounded p-3 flex items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-success" /> الرابط جاهز للإرسال
            </div>
            <div>
              <Label className="text-xs">رابط الدفع</Label>
              <div className="flex gap-1">
                <Input dir="ltr" value={link.url} readOnly className="text-xs" />
                <Button size="icon" variant="outline" onClick={copy}><Copy size={14} /></Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={copy} className="gap-1"><Copy size={14} /> نسخ</Button>
              <Button onClick={shareWa} className="gap-1 bg-success hover:bg-success/90"><MessageCircle size={14} /> WhatsApp</Button>
              <Button variant="outline" onClick={shareEmail} className="gap-1"><Mail size={14} /> Email</Button>
            </div>
            <Button variant="ghost" onClick={() => setLink(null)} className="w-full text-xs">إنشاء رابط آخر</Button>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
