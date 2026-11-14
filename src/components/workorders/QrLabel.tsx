import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { Printer, X, Lock, Copy, ExternalLink, Download, Shield, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WorkOrder } from "@/lib/workOrdersStore";
import { openAndPrintWindow } from "@/lib/safePdfWindow";
import { resolveWorkOrderType, workOrderTypeLabel } from "@/lib/workOrderType";
import { toast } from "sonner";
import { buildCustomerPortalUrl } from "@/lib/customerPortalTokens";
import { useWorkOrderPortalToken } from "@/hooks/useWorkOrderPortalToken";
import { escapeHtml } from "@/lib/safeHtml";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onClose: () => void;
}

export default function QrLabel({ order, open, onClose }: Props) {
  const portal = useWorkOrderPortalToken(open ? order?.cloudId || "" : "");
  const { i18n } = useTranslation(); const en = i18n.language.startsWith("en");
  const prepareLabel = en ? "Prepare customer portal QR" : "تجهيز رمز بوابة العميل";
  const unavailableLabel = en ? "The customer portal is unavailable" : "بوابة العميل غير متاحة";
  const passwordHint = en ? "The customer opens the portal using the vehicle plate number and letters. English letters are accepted. The plate password is never sent in the invitation." : "يفتح العميل البوابة برقم لوحة المركبة وحروفها، ويمكنه كتابة الحروف بالإنجليزية. لا تُرسل بيانات اللوحة في دعوة البوابة.";
  const expiryHint = en ? "Available during the workshop visit, then for 10 days after final delivery. Only a manager can pause or reactivate access." : "متاحة أثناء وجود المركبة بالورشة، ثم لمدة 10 أيام من التسليم النهائي. المدير وحده يستطيع إيقاف الوصول وإعادة تفعيله.";
  const words = en ? { title: "QR Label", close: "Close", brand: "Alwafa Integrated Services", scan: "Scan to open your customer portal", copy: "Copy", open: "Open", download: "Download", password: "Customer portal access", print: "Print Label" }
    : { title: "ملصق QR", close: "إغلاق", brand: "شركة الوفاء للأعمال", scan: "امسح الرمز لفتح بوابة العميل", copy: "نسخ", open: "فتح", download: "تحميل", password: "الدخول إلى بوابة العميل", print: "طباعة الملصق" };

  async function prepare() {
    try {
      const info = await portal.ensure();
      if (info.enabled === false || (info.expires_at && !(Date.parse(info.expires_at) > Date.now()))) throw new Error(unavailableLabel);
    } catch (error) { toast.error(error instanceof Error ? error.message : unavailableLabel); }
  }

  if (!order) return null;
  const orderType = resolveWorkOrderType(order);
  const info = portal.data;
  const activePortal = info?.token && info.enabled !== false && (!info.expires_at || Date.parse(info.expires_at) > Date.now());
  const trackUrl = activePortal ? buildCustomerPortalUrl(info.token) : "";
  const typeColor = orderType === "insurance" ? "#0369a1" : "#047857";
  const typeLabel = en ? workOrderTypeLabel(orderType) : orderType === "insurance" ? "تأمين" : "عميل عام";
  const TypeIcon = orderType === "insurance" ? Shield : Car;

  function handlePrint() {
    if (!trackUrl) {
      toast.error("رمز التتبع الآمن غير متوفر. طبّق migration ثم حدّث الصفحة.");
      return;
    }
    const html = `<!DOCTYPE html><html dir="${en ? "ltr" : "rtl"}"><head><meta charset="utf-8"><title>QR ${escapeHtml(order!.id)}</title>
    <style>
      @page { size: 80mm 110mm; margin: 4mm; }
      body { font-family: 'Tahoma', sans-serif; margin: 0; padding: 8px; text-align: center; }
      .brand { font-size: 11px; font-weight: bold; color: #b8860b; margin-bottom: 4px; }
      .id { font-family: monospace; font-size: 14px; font-weight: bold; margin: 4px 0; }
      .vehicle { font-size: 12px; color: #333; margin-bottom: 8px; }
      .plate { display: inline-block; border: 2px solid #000; padding: 2px 8px; font-weight: bold; font-size: 13px; margin-bottom: 6px; }
      .qr { margin: 6px 0; }
      .url { font-size: 8px; color: #666; word-break: break-all; margin-top: 4px; }
      .footer { font-size: 9px; color: #999; margin-top: 6px; border-top: 1px dashed #ccc; padding-top: 4px; }
      .pwd { font-size: 9px; color: #555; margin-top: 4px; border: 1px dashed #888; padding: 3px 6px; display: inline-block; }
      .type { display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid ${typeColor};color:${typeColor};font-size:9px;font-weight:bold;margin:3px 0; }
    </style></head><body>
      <div class="brand">${words.brand}</div>
      <div class="id">${escapeHtml(order!.id)}</div>
      <div class="type">${typeLabel}</div>
      <div class="vehicle">${escapeHtml(order!.vehicleType)} ${escapeHtml(order!.model)} ${escapeHtml(order!.year)}</div>
      <div class="plate">${escapeHtml(order!.plate)}</div>
      <div class="qr">${document.getElementById('qr-svg-' + order!.id)?.outerHTML || ''}</div>
      <div class="footer">${words.scan}</div>
      <div class="url">${escapeHtml(trackUrl)}</div>
      <div class="pwd">${en ? "Use your vehicle plate number and letters" : "استخدم رقم لوحة مركبتك وحروفها"}</div>
    </body></html>`;
    openAndPrintWindow(html);
  }

  async function copyLink() {
    if (!trackUrl) return;
    await navigator.clipboard.writeText(trackUrl);
    toast.success("تم نسخ رابط المتابعة الآمن");
  }

  function downloadQr() {
    if (!trackUrl) return;
    const svg = document.getElementById(`qr-svg-${order.id}`);
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `QR-${order.displayNumber || order.id}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent dir={en ? "ltr" : "rtl"} className="max-w-sm bg-card border-border">
        <div className="flex items-center justify-between mb-2">
          <DialogTitle className="text-sm font-bold text-foreground">{words.title}</DialogTitle>
          <button onClick={onClose} aria-label={words.close} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X size={16} /></button>
        </div>
        <div className="bg-white text-black rounded-lg p-4 text-center space-y-2">
          <div className="text-[11px] font-bold text-amber-600">{words.brand}</div>
          <div className="font-mono text-sm font-bold">{order.id}</div>
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold" style={{ color: typeColor, borderColor: typeColor }}>
              <TypeIcon size={11} /> {typeLabel}
            </span>
          </div>
          <div className="text-xs">{order.vehicleType} {order.model} {order.year}</div>
          <div className="inline-block border-2 border-black px-3 py-0.5 font-bold text-sm">{order.plate}</div>
          <div className="flex justify-center py-2">
            {trackUrl ? (
              <QRCodeSVG id={`qr-svg-${order.id}`} value={trackUrl} size={180} level="M" includeMargin />
            ) : (
              <div className="flex h-[180px] w-[180px] items-center justify-center rounded border border-dashed border-red-300 bg-red-50 p-4 text-xs text-red-700">
                {unavailableLabel}
              </div>
            )}
          </div>
          <div className="text-[10px] text-gray-500">{words.scan}</div>
          <div className="text-[8px] text-gray-400 break-all">{trackUrl}</div>
        </div>

        {!trackUrl && <Button onClick={prepare} disabled={!order.cloudId || portal.creating}>{prepareLabel}</Button>}

        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={copyLink} className="gap-1 text-xs"><Copy size={13} /> {words.copy}</Button>
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={() => window.open(trackUrl, "_blank", "noopener,noreferrer")} className="gap-1 text-xs"><ExternalLink size={13} /> {words.open}</Button>
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={downloadQr} className="gap-1 text-xs"><Download size={13} /> {words.download}</Button>
        </div>

        <div className="bg-secondary/40 border border-border rounded-lg p-3 space-y-2">
          <div className="text-xs text-foreground flex items-center gap-1.5">
            <Lock size={13} className="text-primary" /> {words.password}
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{passwordHint}</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{expiryHint}</p>
          {info?.expires_at && <p className="text-[10px] text-muted-foreground">{new Date(info.expires_at).toLocaleString(en ? "en-GB" : "ar-OM")}</p>}
        </div>

        <Button onClick={handlePrint} disabled={!trackUrl} className="gradient-gold text-primary-foreground gap-2 hover:opacity-90"><Printer size={14} /> {words.print}</Button>
      </DialogContent>
    </Dialog>
  );
}
