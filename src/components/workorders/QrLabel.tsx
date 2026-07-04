import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Printer, X, Lock, Copy, ExternalLink, Download, Shield, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkOrder } from "@/lib/workOrdersStore";
import { openAndPrintWindow } from "@/lib/safePdfWindow";
import { getTrackingUrl } from "@/lib/pdfGenerator";
import { resolveWorkOrderType, workOrderTypeLabel } from "@/lib/workOrderType";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onClose: () => void;
}

export default function QrLabel({ order, open, onClose }: Props) {
  const [portalToken, setPortalToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPortalToken() {
      setPortalToken(null);
      if (!order?.cloudId || !open) return;
      const { data } = await supabase
        .from("customer_portal_tokens")
        .select("token")
        .eq("job_order_id", order.cloudId)
        .maybeSingle();
      if (!cancelled) setPortalToken((data as any)?.token || null);
    }
    loadPortalToken();
    return () => { cancelled = true; };
  }, [order?.cloudId, open]);

  if (!order) return null;
  const orderType = resolveWorkOrderType(order);
  const effectiveTrackingToken = portalToken || order.trackingToken;
  const trackUrl = getTrackingUrl(effectiveTrackingToken);
  const effectivePwd = (order.phone || "").trim();
  const typeColor = orderType === "insurance" ? "#0369a1" : "#047857";
  const TypeIcon = orderType === "insurance" ? Shield : Car;

  function handlePrint() {
    if (!trackUrl) {
      toast.error("رمز التتبع الآمن غير متوفر. طبّق migration ثم حدّث الصفحة.");
      return;
    }
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>QR ${order!.id}</title>
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
      <div class="brand">شركة الوفاء للأعمال<br/>Alwafa Integrated Services</div>
      <div class="id">${order!.id}</div>
      <div class="type">${workOrderTypeLabel(orderType)}</div>
      <div class="vehicle">${order!.vehicleType} ${order!.model} ${order!.year}</div>
      <div class="plate">${order!.plate}</div>
      <div class="qr">${document.getElementById('qr-svg-' + order!.id)?.outerHTML || ''}</div>
      <div class="footer">امسح الرمز لتتبع حالة سيارتك<br/>Scan to track repair status</div>
      <div class="url">${trackUrl}</div>
      ${effectivePwd ? `<div class="pwd">كلمة المرور: ${effectivePwd}</div>` : ''}
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
      <DialogContent dir="rtl" className="max-w-sm bg-card border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-foreground">ملصق QR / QR Label</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X size={16} /></button>
        </div>
        <div className="bg-white text-black rounded-lg p-4 text-center space-y-2">
          <div className="text-[11px] font-bold text-amber-600">شركة الوفاء للأعمال<br/>Alwafa Integrated Services</div>
          <div className="font-mono text-sm font-bold">{order.id}</div>
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold" style={{ color: typeColor, borderColor: typeColor }}>
              <TypeIcon size={11} /> {workOrderTypeLabel(orderType)}
            </span>
          </div>
          <div className="text-xs">{order.vehicleType} {order.model} {order.year}</div>
          <div className="inline-block border-2 border-black px-3 py-0.5 font-bold text-sm">{order.plate}</div>
          <div className="flex justify-center py-2">
            {trackUrl ? (
              <QRCodeSVG id={`qr-svg-${order.id}`} value={trackUrl} size={180} level="M" includeMargin />
            ) : (
              <div className="flex h-[180px] w-[180px] items-center justify-center rounded border border-dashed border-red-300 bg-red-50 p-4 text-xs text-red-700">
                رابط التتبع الآمن غير متوفر
              </div>
            )}
          </div>
          <div className="text-[10px] text-gray-500">امسح الرمز لتتبع حالة سيارتك<br/>Scan to track repair status</div>
          <div className="text-[8px] text-gray-400 break-all">{trackUrl}</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={copyLink} className="gap-1 text-xs"><Copy size={13} /> نسخ</Button>
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={() => window.open(trackUrl, "_blank", "noopener,noreferrer")} className="gap-1 text-xs"><ExternalLink size={13} /> فتح</Button>
          <Button size="sm" variant="outline" disabled={!trackUrl} onClick={downloadQr} className="gap-1 text-xs"><Download size={13} /> تحميل</Button>
        </div>

        <div className="bg-secondary/40 border border-border rounded-lg p-3 space-y-2">
          <div className="text-xs text-foreground flex items-center gap-1.5">
            <Lock size={13} className="text-primary" /> كلمة مرور صفحة التتبع
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            الرابط يستخدم token عشوائيًا ولا يكشف رقم الأمر أو UUID الداخلي. التحقق الإضافي يتم برقم هاتف العميل المسجل.
          </p>
          {effectivePwd && (
            <div className="text-[11px] text-foreground bg-card border border-border rounded px-2 py-1 font-mono" dir="ltr">
              🔑 {effectivePwd.replace(/.(?=.{3})/g, "•")}
            </div>
          )}
          {order.trackingExpiresAt && (
            <p className="text-[10px] text-muted-foreground">انتهاء الرابط: {new Date(order.trackingExpiresAt).toLocaleString("ar-OM")}</p>
          )}
        </div>

        <Button onClick={handlePrint} className="gradient-gold text-primary-foreground gap-2 hover:opacity-90"><Printer size={14} /> طباعة الملصق / Print Label</Button>
      </DialogContent>
    </Dialog>
  );
}
