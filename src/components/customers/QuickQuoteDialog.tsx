import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { generateQuotePdf, getTemplateSettings } from "@/lib/pdfGenerator";
import { salesStore } from "@/lib/salesStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerName: string;
  customerPhone?: string;
  defaultPlate?: string;
  defaultVehicleInfo?: string;
}

interface Line { description: string; quantity: number; unitPrice: number }

export default function QuickQuoteDialog({ open, onOpenChange, customerName, customerPhone, defaultPlate, defaultVehicleInfo }: Props) {
  const [vehicleInfo, setVehicleInfo] = useState(defaultVehicleInfo || "");
  const [plate, setPlate] = useState(defaultPlate || "");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: 1, unitPrice: 0 }]);

  const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
  const vatRate = getTemplateSettings().vatRate;
  const vat = Math.round(subtotal * (vatRate / 100) * 1000) / 1000;
  const total = subtotal + vat;

  function add() { setLines([...lines, { description: "", quantity: 1, unitPrice: 0 }]); }
  function update(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function remove(i: number) { setLines(lines.filter((_, idx) => idx !== i)); }

  function handleGenerate() {
    const validLines = lines.filter(l => l.description.trim());
    if (validLines.length === 0) { toast.error("أضف بنداً واحداً على الأقل"); return; }
    const quoteNumber = salesStore.nextNumber("quote");
    generateQuotePdf({
      quoteNumber,
      invoiceNumber: quoteNumber,
      date: new Date().toISOString().split("T")[0],
      customerName,
      customerPhone,
      vehicleInfo: vehicleInfo || "-",
      plateNumber: plate || "-",
      items: validLines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.quantity * l.unitPrice,
      })),
      subtotal,
      vat,
      total,
    });
    toast.success(`تم إنشاء عرض السعر ${quoteNumber}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-foreground">عرض سعر سريع لـ {customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">السيارة</label>
              <Input value={vehicleInfo} onChange={e => setVehicleInfo(e.target.value)} placeholder="تويوتا كامري 2023" className="bg-secondary border-border" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">رقم اللوحة</label>
              <Input value={plate} onChange={e => setPlate(e.target.value)} className="bg-secondary border-border" />
            </div>
          </div>
          <div className="border border-border rounded-lg bg-secondary/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-foreground">بنود العرض</h4>
              <Button type="button" size="sm" variant="outline" onClick={add} className="gap-1 h-7 text-xs"><Plus size={12} /> إضافة بند</Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="وصف البند" className="col-span-6 h-9 bg-card text-sm" />
                  <Input type="number" value={l.quantity} onChange={e => update(i, { quantity: Number(e.target.value) })} placeholder="الكمية" className="col-span-2 h-9 bg-card text-sm" />
                  <Input type="number" value={l.unitPrice} onChange={e => update(i, { unitPrice: Number(e.target.value) })} placeholder="السعر" className="col-span-3 h-9 bg-card text-sm" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => remove(i)} className="col-span-1 h-9 w-9 text-destructive"><Trash2 size={14} /></Button>
                </div>
              ))}
            </div>
          </div>
          <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>المجموع الفرعي</span><span>{subtotal.toLocaleString()} ر.ع</span></div>
            <div className="flex justify-between text-muted-foreground"><span>ضريبة ({vatRate}%)</span><span>{vat.toLocaleString()} ر.ع</span></div>
            <div className="flex justify-between text-foreground font-bold border-t border-border pt-1"><span>الإجمالي</span><span className="text-primary">{total.toLocaleString()} ر.ع</span></div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleGenerate} className="gradient-gold text-primary-foreground flex-1">إنشاء PDF</Button>
            <Button onClick={() => onOpenChange(false)} variant="ghost">إلغاء</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
