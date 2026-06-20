import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Printer, Share2, Download, Link as LinkIcon, ShieldOff, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import { openSanitizedPdfWindow, openAndPrintWindow } from "@/lib/safePdfWindow";
import { buildPublicUrl } from "@/lib/publicAccessSettingsStore";
import { toast } from "sonner";

interface Props {
  vehicle: Vehicle;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export default function ShareVehicleDialog({ vehicle, open, onOpenChange }: Props) {
  const publicUrl = useMemo(
    () => buildPublicUrl(`/v/${encodeURIComponent(vehicle.plate)}`),
    [vehicle.plate],
  );

  // Defaults: enabled = true, hideSensitive = true (تلقائياً عند المشاركة)
  const [enabled, setEnabled] = useState<boolean>(vehicle.publicShareEnabled ?? true);
  const [hideSensitive, setHideSensitive] = useState<boolean>(vehicle.publicShareHideSensitive ?? true);
  const [pwd, setPwd] = useState<string>(vehicle.publicSharePassword || "");

  // Make sure the stored vehicle reflects the auto-hide default the very first time the dialog opens.
  useEffect(() => {
    if (open && vehicle.publicShareHideSensitive === undefined) {
      persist({ publicShareHideSensitive: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function persist(next: Partial<Vehicle>) {
    vehiclesStore.update(vehicle.id, { ...vehicle, ...next });
  }

  function toggleEnabled(v: boolean) {
    setEnabled(v);
    persist({ publicShareEnabled: v });
    toast.success(v ? "تم تفعيل الرابط العام" : "تم تعطيل الرابط العام");
  }

  function toggleHide(v: boolean) {
    setHideSensitive(v);
    persist({ publicShareHideSensitive: v });
  }

  function savePwd() {
    const trimmed = pwd.trim();
    persist({ publicSharePassword: trimmed || undefined });
    toast.success(trimmed ? "تم حفظ كلمة المرور المخصصة" : "تم استخدام رقم هاتف المالك تلقائياً");
  }
  function clearPwd() {
    setPwd("");
    persist({ publicSharePassword: undefined });
    toast.success("تم مسح كلمة المرور — سيُستخدم رقم هاتف المالك تلقائياً");
  }
  const effectivePwd = (vehicle.publicSharePassword || vehicle.ownerPhone || "").trim();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("تم نسخ الرابط");
    } catch {
      toast.error("تعذر النسخ");
    }
  }

  function shareWhatsApp() {
    const text =
      `🚗 *بطاقة السيارة - ${vehicle.plate}*\n` +
      `${vehicle.type}\n` +
      `يمكنك الاطلاع على البطاقة الكاملة (الصور قبل/بعد، سجل الإصلاح، المطالبات) من خلال الرابط:\n${publicUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  function downloadQr() {
    const svg = document.getElementById(`share-qr-${vehicle.id}`);
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `QR-${vehicle.plate}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function printQr() {
    const svgEl = document.getElementById(`share-qr-${vehicle.id}`);
    const svgHtml = svgEl ? svgEl.outerHTML : "";
    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>QR ${vehicle.plate}</title>
    <style>
      @page { size: 80mm 110mm; margin: 4mm; }
      body { font-family: 'Tahoma', sans-serif; margin: 0; padding: 8px; text-align: center; }
      .brand { font-size: 11px; font-weight: bold; color: #b8860b; margin-bottom: 4px; }
      .title { font-size: 10px; color: #444; margin-bottom: 6px; }
      .vehicle { font-size: 12px; color: #333; margin-bottom: 6px; }
      .plate { display: inline-block; border: 2px solid #000; padding: 2px 10px; font-weight: bold; font-size: 14px; margin-bottom: 8px; }
      .qr { margin: 6px 0; }
      .url { font-size: 8px; color: #666; word-break: break-all; margin-top: 4px; }
      .footer { font-size: 9px; color: #999; margin-top: 6px; border-top: 1px dashed #ccc; padding-top: 4px; }
    </style></head><body>
      <div class="brand">شركة الوفاء للأعمال<br/>Alwafa Integrated Services</div>
      <div class="title">بطاقة السيارة العامة / Public Vehicle Card</div>
      <div class="vehicle">${vehicle.type}</div>
      <div class="plate">${vehicle.plate}</div>
      <div class="qr">${svgHtml}</div>
      <div class="footer">امسح الرمز لعرض ملف السيارة الكامل<br/>Scan to view full vehicle profile</div>
      <div class="url">${publicUrl}</div>
      ${effectivePwd ? `<div style="margin-top:6px;font-size:10px;color:#000;border:1px dashed #000;padding:3px 6px;display:inline-block;">كلمة المرور / Password: <b>${effectivePwd}</b></div>` : ""}
    </body></html>`;
    openAndPrintWindow(html);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Share2 size={18} className="text-primary" />
            مشاركة بطاقة السيارة عامة
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            رابط ورمز QR لمشاركة ملف السيارة مع العميل أو شركة التأمين دون الحاجة لتسجيل الدخول.
          </DialogDescription>
        </DialogHeader>

        {/* QR + Brand block */}
        <div className="bg-white text-black rounded-lg p-4 text-center space-y-2">
          <div className="text-[11px] font-bold text-amber-600">
            شركة الوفاء للأعمال
            <br />
            Alwafa Integrated Services
          </div>
          <div className="text-xs text-gray-700">{vehicle.type}</div>
          <div className="inline-block border-2 border-black px-3 py-0.5 font-bold text-sm">
            {vehicle.plate}
          </div>
          <div className="flex justify-center py-2">
            <QRCodeSVG
              id={`share-qr-${vehicle.id}`}
              value={publicUrl}
              size={180}
              level="M"
              includeMargin
            />
          </div>
          <div className="text-[10px] text-gray-500">
            امسح الرمز لعرض ملف السيارة الكامل
            <br />
            Scan to view full vehicle profile
          </div>
        </div>

        {/* Link */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <LinkIcon size={12} /> الرابط العام
          </Label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={publicUrl}
              dir="ltr"
              className="flex-1 bg-secondary/40 border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
            />
            <Button onClick={copyLink} size="sm" variant="outline" className="gap-1.5 shrink-0">
              <Copy size={14} /> نسخ
            </Button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={shareWhatsApp} variant="outline" size="sm" className="gap-1.5">
            <Share2 size={14} /> WhatsApp
          </Button>
          <Button onClick={printQr} variant="outline" size="sm" className="gap-1.5">
            <Printer size={14} /> طباعة QR
          </Button>
          <Button onClick={downloadQr} variant="outline" size="sm" className="gap-1.5">
            <Download size={14} /> تنزيل
          </Button>
        </div>

        {/* Privacy controls */}
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label className="text-xs text-foreground flex items-center gap-1.5">
                {enabled ? <Eye size={13} className="text-success" /> : <EyeOff size={13} className="text-destructive" />}
                تفعيل الرابط العام
              </Label>
              <p className="text-[10px] text-muted-foreground">
                عند التعطيل، الرابط لن يعرض البطاقة لأي شخص.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label className="text-xs text-foreground flex items-center gap-1.5">
                <ShieldOff size={13} className="text-warning" />
                إخفاء البيانات الحساسة
              </Label>
              <p className="text-[10px] text-muted-foreground">
                يخفي اسم وهاتف المالك والأرقام المالية (مفيد لشركة التأمين).
              </p>
            </div>
            <Switch checked={hideSensitive} onCheckedChange={toggleHide} />
          </div>

          {/* Password protection */}
          <div className="space-y-2 bg-secondary/30 border border-border rounded-lg p-3">
            <Label className="text-xs text-foreground flex items-center gap-1.5">
              <KeyRound size={13} className="text-primary" />
              كلمة مرور لحماية الرابط
            </Label>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              يجب على من يفتح الرابط إدخال كلمة مرور قبل عرض البطاقة.
              {vehicle.publicSharePassword
                ? " (مفعّلة بكلمة مخصصة)"
                : vehicle.ownerPhone
                ? ` (افتراضياً: رقم هاتف المالك ${vehicle.ownerPhone})`
                : " (لم يُضبط رقم هاتف المالك — أدخل كلمة مرور يدوية)"}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder={vehicle.ownerPhone ? `اتركه فارغاً لاستخدام ${vehicle.ownerPhone}` : "أدخل كلمة المرور"}
                className="h-9 text-sm"
              />
              <Button onClick={savePwd} size="sm" className="gap-1 shrink-0">حفظ</Button>
              {vehicle.publicSharePassword && (
                <Button onClick={clearPwd} size="sm" variant="outline" className="gap-1 shrink-0" title="مسح كلمة المرور المخصصة">
                  <X size={14} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
