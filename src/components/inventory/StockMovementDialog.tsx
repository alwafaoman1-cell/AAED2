import { useState } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import {
  applyStockMovement, nextStockMovementId, stockMovementsStore,
  type MovementType, type StockMovementItem,
} from "@/lib/stockMovementsStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultType?: MovementType;
  onSaved?: () => void;
}

export default function StockMovementDialog({ open, onOpenChange, defaultType = "IN", onSaved }: Props) {
  const [type, setType] = useState<MovementType>(defaultType);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<StockMovementItem[]>([]);
  const [search, setSearch] = useState("");

  const allParts = inventoryStore.getAll();
  const filteredParts = search.trim()
    ? allParts.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.partNumber.toLowerCase().includes(search.toLowerCase()) ||
        (p.barcode || "").includes(search),
      ).slice(0, 8)
    : [];

  function reset() {
    setType(defaultType); setDate(new Date().toISOString().slice(0, 10));
    setReference(""); setReason(""); setFromLocation(""); setToLocation("");
    setNotes(""); setItems([]); setSearch("");
  }

  function addPart(p: Part) {
    if (items.some((i) => i.partId === p.id)) {
      toast.warning("الصنف مضاف بالفعل");
      return;
    }
    setItems((prev) => [...prev, {
      partId: p.id,
      partName: p.name,
      partNumber: p.partNumber,
      qty: 1,
      unitCost: p.buyPrice,
    }]);
    setSearch("");
  }

  function updateItem(idx: number, patch: Partial<StockMovementItem>) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    if (items.length === 0) { toast.error("أضف صنفاً واحداً على الأقل"); return; }
    if (!reason.trim()) { toast.error("يرجى ذكر سبب الحركة"); return; }
    if (type === "TRANSFER" && (!fromLocation.trim() || !toLocation.trim())) {
      toast.error("حدد الموقع الأصلي والوجهة"); return;
    }
    if (items.some((i) => i.qty <= 0)) { toast.error("الكميات يجب أن تكون أكبر من صفر"); return; }

    const movement = {
      id: nextStockMovementId(),
      type, date, reference, reason,
      fromLocation: fromLocation || undefined,
      toLocation: toLocation || undefined,
      items, notes,
      createdAt: new Date().toISOString(),
    };

    const result = applyStockMovement(movement);
    if (!result.ok) { toast.error(result.error || "فشل التنفيذ"); return; }

    stockMovementsStore.add(movement);
    toast.success(`تم تسجيل ${movement.id}`);
    reset();
    onOpenChange(false);
    onSaved?.();
  }

  const typeLabel = type === "IN" ? "إذن إدخال" : type === "OUT" ? "إذن إخراج" : "إذن تحويل";
  const typeColor = type === "IN" ? "text-success" : type === "OUT" ? "text-destructive" : "text-info";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${typeColor}`}>
            {typeLabel} جديد
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* النوع + التاريخ + المرجع */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="نوع الحركة *">
              <Select value={type} onValueChange={(v) => setType(v as MovementType)}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">إدخال (IN)</SelectItem>
                  <SelectItem value="OUT">إخراج (OUT)</SelectItem>
                  <SelectItem value="TRANSFER">تحويل (TRANSFER)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="التاريخ *">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border" />
            </Field>
            <Field label="رقم مرجعي">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} className="bg-secondary border-border" placeholder="اختياري" />
            </Field>
          </div>

          {/* المواقع */}
          {(type === "OUT" || type === "TRANSFER") && (
            <Field label={type === "TRANSFER" ? "من موقع *" : "من موقع"}>
              <Input value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} className="bg-secondary border-border" placeholder="مثال: المستودع الرئيسي" />
            </Field>
          )}
          {(type === "IN" || type === "TRANSFER") && (
            <Field label={type === "TRANSFER" ? "إلى موقع *" : "إلى موقع"}>
              <Input value={toLocation} onChange={(e) => setToLocation(e.target.value)} className="bg-secondary border-border" placeholder="مثال: مستودع الورشة" />
            </Field>
          )}

          <Field label="السبب *">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="bg-secondary border-border" placeholder="مثال: استلام بضاعة، صرف للورشة، نقل مخزون..." />
          </Field>

          {/* البنود */}
          <div className="space-y-2 border border-border rounded-lg p-3 bg-background/40">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-foreground">الأصناف ({items.length})</h4>
            </div>

            {/* البحث وإضافة الصنف */}
            <div className="relative">
              <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم/الرقم/الباركود..."
                className="pr-8 bg-secondary border-border h-9 text-sm"
              />
              {filteredParts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredParts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addPart(p)}
                      className="w-full text-right px-3 py-2 hover:bg-secondary flex items-center justify-between text-xs border-b border-border/50 last:border-0"
                    >
                      <span className="text-foreground font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono">{p.partNumber} • {p.stock} متاح</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* جدول البنود */}
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">لم تتم إضافة أصناف بعد</p>
            ) : (
              <div className="space-y-1">
                {items.map((it, idx) => {
                  const part = inventoryStore.getById(it.partId);
                  return (
                    <div key={it.partId} className="grid grid-cols-12 gap-2 items-center bg-secondary/40 rounded-md p-2">
                      <div className="col-span-5 text-xs">
                        <p className="text-foreground font-medium truncate">{it.partName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{it.partNumber} • متاح: {part?.stock ?? 0}</p>
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          value={it.qty}
                          onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })}
                          className="bg-background border-border h-8 text-xs"
                          placeholder="الكمية"
                        />
                      </div>
                      {type === "IN" && (
                        <div className="col-span-3">
                          <Input
                            type="number"
                            value={it.unitCost ?? 0}
                            onChange={(e) => updateItem(idx, { unitCost: Number(e.target.value) })}
                            className="bg-background border-border h-8 text-xs"
                            placeholder="التكلفة"
                          />
                        </div>
                      )}
                      <div className={type === "IN" ? "col-span-1" : "col-span-4 text-left"}>
                        <button
                          onClick={() => removeItem(idx)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Field label="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-secondary border-border" rows={2} />
          </Field>

          <div className="flex gap-2 pt-2 border-t border-border">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground flex-1 gap-2">
              <Plus size={16} /> تسجيل {typeLabel}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">إلغاء</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
