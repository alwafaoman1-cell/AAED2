import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X, Lock, Save, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkOrder, updateWorkOrder } from "@/lib/workOrdersStore";
import { openSanitizedPdfWindow, openAndPrintWindow } from "@/lib/safePdfWindow";
import { buildPublicUrl } from "@/lib/publicAccessSettingsStore";
import { toast } from "sonner";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onClose: () => void;
}

export default function QrLabel({ order, open, onClose }: Props) {
  const [customPwd, setCustomPwd] = useState("");

  useEffect(() => {
    if (order) setCustomPwd(order.trackPassword || "");
  }, [order?.id, open]);

  if (!order) return null;
  const trackUrl = buildPublicUrl(`/track/${order.id}`);
  const effectivePwd = (order.trackPassword || order.phone || "").trim();

  function savePwd() {
    if (!order) return;
    const v = customPwd.trim();
    updateWorkOrder(order.id, { trackPassword: v || undefined });
    toast.success(v ? "تم حفظ كلمة المرور المخصصة" : "تمت إزالة الكلمة المخصصة — سيُستخدم رقم هاتف العميل");
  }

  function handlePrint() {
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
    </style></head><body>
      <div class="brand">شركة الوفاء للأعمال<br/>Alwafa Integrated Services</div>
      <div class="id">${order!.id}</div>
      <div class="vehicle">${order!.vehicleType} ${order!.model} ${order!.year}</div>
      <div class="plate">${order!.plate}</div>
      <div class="qr">${document.getElementById('qr-svg-' + order!.id)?.outerHTML || ''}</div>
      <div class="footer">امسح الرمز لتتبع حالة سيارتك<br/>Scan to track repair status</div>
      <div class="url">${trackUrl}</div>
      ${effectivePwd ? `<div class="pwd">كلمة المرور: ${effectivePwd}</div>` : ''}
    </body></html>`;
    openAndPrintWindow(html);
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
          <div className="text-xs">{order.vehicleType} {order.model} {order.year}</div>
          <div className="inline-block border-2 border-black px-3 py-0.5 font-bold text-sm">{order.plate}</div>
          <div className="flex justify-center py-2">
            <QRCodeSVG id={`qr-svg-${order.id}`} value={trackUrl} size={180} level="M" includeMargin />
          </div>
          <div className="text-[10px] text-gray-500">امسح الرمز لتتبع حالة سيارتك<br/>Scan to track repair status</div>
          <div className="text-[8px] text-gray-400 break-all">{trackUrl}</div>
        </div>

        {/* كلمة المرور للصفحة العامة */}
        <div className="bg-secondary/40 border border-border rounded-lg p-3 space-y-2">
          <Label className="text-xs text-foreground flex items-center gap-1.5">
            <Lock size={13} className="text-primary" /> كلمة مرور صفحة التتبع
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={customPwd}
                onChange={(e) => setCustomPwd(e.target.value)}
                placeholder={order.phone ? `الافتراضي: ${order.phone}` : "أدخل كلمة مرور مخصصة"}
                className="pr-7 h-9 text-xs"
              />
            </div>
            <Button onClick={savePwd} size="sm" variant="outline" className="gap-1 h-9">
              <Save size={13} /> حفظ
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            عند فتح الرابط سيُطلب من العميل كلمة المرور.
            إذا تركت الحقل فارغاً ستكون <span className="font-semibold text-foreground">رقم هاتف العميل</span> ({order.phone || "غير مسجّل"}).
          </p>
          {effectivePwd && (
            <div className="text-[11px] text-foreground bg-card border border-border rounded px-2 py-1 font-mono" dir="ltr">
              🔑 {effectivePwd}
            </div>
          )}
        </div>

        <Button onClick={handlePrint} className="gradient-gold text-primary-foreground gap-2 hover:opacity-90"><Printer size={14} /> طباعة الملصق / Print Label</Button>
      </DialogContent>
    </Dialog>
  );
}
