import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Copy, Link2, Loader2, MessageCircle, Pause, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { approveVehicleCustomerPortalDelivery, buildUnifiedVehiclePortalUrl, buildVehiclePortalWhatsAppMessage, ensureVehicleCustomerPortal, getVehicleCustomerPortalContext, setVehicleCustomerPortalEnabled } from "@/lib/unifiedVehiclePortal";

export default function VehicleCustomerPortalPanel({ entryId, customerPhone }: { entryId: string; customerPhone?: string }) {
  const { i18n } = useTranslation();
  const { hasRole, profile } = useAuth();
  const en = !!i18n.language?.startsWith("en");
  const text = (ar: string, english: string) => en ? english : ar;
  const manager = hasRole("admin", "manager");
  const allowed = hasRole("admin", "manager", "supervisor", "insurance");
  const client = useQueryClient();
  const context = useQuery({ queryKey: ["vehicle-customer-portal", profile?.tenant_id, entryId], queryFn: () => getVehicleCustomerPortalContext(entryId), enabled: !!entryId && allowed, retry: false });
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const portal = context.data;
  const url = portal?.token ? buildUnifiedVehiclePortalUrl(portal.token) : "";
  const expiryTime = portal?.expires_at ? Date.parse(portal.expires_at) : null;
  const expired = !!portal?.expires_at && !(expiryTime! > Date.now());
  const shareable = !!portal?.enabled && !expired && !!url;
  const message = portal && url ? buildVehiclePortalWhatsAppMessage(portal, url, en ? "en" : "ar") : "";
  const labels = { copy: text("نسخ الرابط", "Copy link"), copyMessage: text("نسخ رسالة واتساب", "Copy WhatsApp message"), send: text("إرسال الرابط بواتساب", "Send portal by WhatsApp"), prepare: text("تجهيز رابط العميل", "Prepare customer link"), refresh: text("تحديث", "Refresh"), pause: text("إيقاف الرابط", "Pause link"), reactivate: text("إعادة تفعيل الرابط", "Reactivate link"), approve: text("اعتماد إظهار التسليم النهائي للعميل", "Approve final delivery for customer") };

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { await action(); }
    catch { toast.error(text("تعذّر إكمال العملية أو التحقق من حفظها. أعد التحديث والمحاولة.", "The operation or its saved result could not be verified. Refresh and try again.")); }
    finally { working.current = false; setBusy(false); }
  }
  async function verifiedContext() {
    const result = await context.refetch();
    if (result.error || !result.data?.token) throw new Error("context_unverified");
    return result.data;
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success(text("تم النسخ", "Copied"));
  }
  async function freshActivePortal() {
    const fresh = await verifiedContext();
    if (!fresh.enabled || fresh.expires_at && !(Date.parse(fresh.expires_at) > Date.now())) throw new Error("inactive");
    return fresh;
  }
  const copyLink = () => run(async () => { const fresh = await freshActivePortal(); await copy(buildUnifiedVehiclePortalUrl(fresh.token)); });
  const copyMessage = () => run(async () => { const fresh = await freshActivePortal(); await copy(buildVehiclePortalWhatsAppMessage(fresh, buildUnifiedVehiclePortalUrl(fresh.token), en ? "en" : "ar")); });
  const sendInvitation = () => run(async () => {
    const fresh = await freshActivePortal();
    const { sendWhatsAppMessage } = await import("@/lib/partsWhatsApp");
    const result = await sendWhatsAppMessage({ phone: customerPhone, recipientName: fresh.customer_name, recipientType: "customer", kind: "custom", message: buildVehiclePortalWhatsAppMessage(fresh, buildUnifiedVehiclePortalUrl(fresh.token), en ? "en" : "ar") });
    if (!result.ok) throw new Error("send_failed");
    if (["sent", "delivered", "read"].includes(result.status || "")) toast.success(text("تم إرسال رسالة البوابة", "Portal invitation sent"));
    else toast.info(text("تم تسجيل الطلب. لم يتم تأكيد إرسال الرسالة بعد؛ راجع سجل التواصل.", "The request was recorded. Sending is not yet confirmed; check the communication log."));
  });
  const prepare = () => run(async () => { await ensureVehicleCustomerPortal(entryId); await verifiedContext(); toast.success(text("تم تجهيز رابط العميل والتحقق منه", "Customer link prepared and verified")); });
  const refresh = () => run(async () => { const result = await context.refetch(); if (result.error) throw result.error; });
  const toggle = () => run(async () => {
    const enabled = !portal?.enabled || expired;
    await setVehicleCustomerPortalEnabled(entryId, enabled);
    const fresh = await verifiedContext();
    if (fresh.enabled !== enabled || enabled && fresh.expires_at && !(Date.parse(fresh.expires_at) > Date.now())) throw new Error("toggle_unverified");
    toast.success(enabled ? text("تم تفعيل الرابط والتحقق منه", "Link enabled and verified") : text("تم إيقاف الرابط والتحقق منه", "Link paused and verified"));
  });
  const approve = () => run(async () => {
    await approveVehicleCustomerPortalDelivery(entryId);
    const fresh = await verifiedContext();
    if (fresh.pending_handover_id) throw new Error("approval_unverified");
    await client.invalidateQueries({ queryKey: ["vehicle-intake-receipts", entryId] });
    toast.success(text("تم اعتماد إظهار التسليم النهائي للعميل", "Final delivery approved for customer viewing"));
  });
  if (!allowed) return null;
  return <Card dir={en ? "ltr" : "rtl"} className="space-y-3 p-4">
    <h2 className="flex items-center gap-2 text-lg font-bold"><Link2 className="h-5 w-5" />{text("بوابة العميل الموحدة", "Unified customer portal")}</h2>
    <p className="text-sm text-muted-foreground">{text("رابط واحد للدخول والمراجعات وأمر العمل والتسليم. يفتح العميل مستنداته برقم لوحته وحروفها. تبقى التواقيع والنماذج السابقة محفوظة.", "One link for intake, reviews, the work order and delivery. The customer opens their documents using their own plate digits and letters. Previous forms and signatures stay preserved.")}</p>
    {context.isLoading && <p role="status">{text("جارٍ تحميل إعدادات البوابة…", "Loading portal settings…")}</p>}
    {context.error && <p role="alert" className="text-sm text-destructive">{text("تعذّرت قراءة إعدادات البوابة.", "Portal settings could not be read.")}</p>}
    {portal && <>
      <p className="flex items-center gap-2 text-sm"><CheckCircle2 className={`h-4 w-4 ${shareable ? "text-emerald-600" : "text-muted-foreground"}`} />{!portal.enabled ? text("الرابط متوقف بواسطة الإدارة", "Paused by management") : expired ? text("انتهت صلاحية الرابط", "Link expired") : text("الرابط فعال", "Link active")}</p>
      <p className="text-sm text-muted-foreground">{portal.expires_at ? Number.isFinite(expiryTime) ? `${text("تنتهي الصلاحية", "Access expires")}: ${new Date(portal.expires_at).toLocaleString(en ? "en-GB" : "ar-OM")}` : text("انتهت صلاحية الرابط", "Link expired") : text("فعال أثناء وجود المركبة في الورشة، ثم 10 أيام بعد التسليم النهائي.", "Active while the vehicle is in the workshop, then for 10 days after final delivery.")}</p>
      <Input value={url} readOnly dir="ltr" aria-label={text("رابط بوابة العميل", "Customer portal link")} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" disabled={busy || !shareable} onClick={() => void copyLink()}><Copy className="h-4 w-4" />{labels.copy}</Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={busy || !shareable} onClick={() => void copyMessage()}><MessageCircle className="h-4 w-4" />{labels.copyMessage}</Button>
        {customerPhone && <Button size="sm" className="gap-2" disabled={busy || !shareable} onClick={() => void sendInvitation()}><MessageCircle className="h-4 w-4" />{labels.send}</Button>}
      </div>
      <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{text("معاينة رسالة العميل", "Preview customer message")}</summary><p className="mt-2 whitespace-pre-wrap">{message}</p></details>
    </>}
    <div className="flex flex-wrap gap-2">
      {!portal && !context.isLoading && !context.error && <Button disabled={busy} className="gap-2" onClick={() => void prepare()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{labels.prepare}</Button>}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>{labels.refresh}</Button>
      {manager && portal && <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => void toggle()}>{portal.enabled && !expired ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{portal.enabled && !expired ? labels.pause : labels.reactivate}</Button>}
      {manager && portal?.pending_handover_id && <Button size="sm" className="gap-2" disabled={busy} onClick={() => void approve()}><ShieldCheck className="h-4 w-4" />{labels.approve}</Button>}
    </div>
    {!manager && <p className="text-xs text-muted-foreground">{text("المدير فقط يمكنه إيقاف الرابط أو إعادة تفعيله واعتماد إظهار التسليم النهائي.", "Only a manager can pause or reactivate the link and approve final delivery for customer viewing.")}</p>}
  </Card>;
}
