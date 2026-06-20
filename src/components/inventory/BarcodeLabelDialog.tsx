import { useEffect, useState } from "react";
import { Printer, Barcode as BarcodeIcon, Download } from "lucide-react";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { printBarcodeLabels } from "@/lib/inventoryExports";
import type { Part } from "@/lib/inventoryStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  part: Part | null;
}

export default function BarcodeLabelDialog({ open, onOpenChange, part }: Props) {
  const [copies, setCopies] = useState(12);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showPartNumber, setShowPartNumber] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !part?.barcode) {
      setPreviewUrl(null);
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, part.barcode, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 6,
      });
      setPreviewUrl(canvas.toDataURL("image/png"));
    } catch {
      setPreviewUrl(null);
    }
  }, [open, part]);

  function runLabels(mode: "print" | "download") {
    if (!part) return;
    if (!part.barcode) {
      toast.error("هذا المنتج ليس له باركود — أضفه من نموذج التعديل");
      return;
    }
    if (copies < 1 || copies > 500) {
      toast.error("عدد النسخ يجب أن يكون بين 1 و 500");
      return;
    }
    try {
      printBarcodeLabels(part, copies, { showName, showPrice, showPartNumber, mode });
      toast.success(mode === "print" ? `جاري طباعة ${copies} ملصق` : `تم تنزيل ${copies} ملصق`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "فشل التنفيذ");
    }
  }

  if (!part) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <BarcodeIcon size={18} className="text-primary" /> طباعة ملصق باركود
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* معلومات المنتج */}
          <div className="bg-secondary/40 rounded-lg p-3 text-sm">
            <p className="text-foreground font-semibold">{part.name}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{part.partNumber}</p>
            <p className="text-xs text-muted-foreground mt-1">
              السعر: <span className="text-foreground font-bold">{part.sellPrice} ر.ع</span>
            </p>
          </div>

          {/* معاينة الباركود */}
          {previewUrl ? (
            <div className="border border-border rounded-lg p-4 bg-white flex justify-center">
              <img src={previewUrl} alt="barcode" className="max-h-20" />
            </div>
          ) : (
            <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 text-center text-sm text-destructive">
              لا يوجد باركود لهذا المنتج. يرجى إضافته من نموذج تعديل المنتج أولاً.
            </div>
          )}

          {/* الخيارات */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">عدد النسخ</label>
              <Input
                type="number"
                min={1}
                max={500}
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value))}
                className="bg-secondary border-border"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                32 ملصق/صفحة A4 ({Math.ceil(copies / 32)} {Math.ceil(copies / 32) === 1 ? "صفحة" : "صفحات"})
              </p>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">يظهر على الملصق:</p>
              <CheckboxRow checked={showName} onChange={setShowName} label="اسم المنتج" />
              <CheckboxRow checked={showPartNumber} onChange={setShowPartNumber} label="رقم القطعة" />
              <CheckboxRow checked={showPrice} onChange={setShowPrice} label="السعر" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button
              onClick={() => runLabels("print")}
              disabled={!previewUrl}
              className="gradient-gold text-primary-foreground flex-1 gap-2"
            >
              <Printer size={16} /> طباعة {copies}
            </Button>
            <Button
              onClick={() => runLabels("download")}
              disabled={!previewUrl}
              variant="secondary"
              className="gap-2"
            >
              <Download size={16} /> تنزيل PDF
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CheckboxRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}
