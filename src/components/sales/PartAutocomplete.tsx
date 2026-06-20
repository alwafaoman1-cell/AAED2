import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Package, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { inventoryStore, type Part } from "@/lib/inventoryStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  value: string;
  partId?: string;
  onChange: (value: string) => void;
  onSelect: (part: Part) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Autocomplete للبنود مرتبط بالمخزن.
 * - عند الكتابة (اسم أو رقم القطعة) تظهر قائمة من المخزون.
 * - عند الاختيار يتم تعبئة الاسم وإرجاع كامل بيانات القطعة (للسعر).
 * - عند عدم وجود مطابق: يظهر زر "إضافة منتج جديد للمخزن" بدلاً من الحفظ التلقائي.
 */
export default function PartAutocomplete({
  value,
  partId,
  onChange,
  onSelect,
  placeholder,
  className,
}: Props) {
  const [parts, setParts] = useState<Part[]>(() => inventoryStore.getAll());
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newPart, setNewPart] = useState({ partNumber: "", sellPrice: 0, buyPrice: 0, stock: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return inventoryStore.subscribe(() => setParts([...inventoryStore.getAll()]));
  }, []);

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return parts.slice(0, 8);
    return parts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.partNumber.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [value, parts]);

  const linkedPart = partId ? parts.find((p) => p.id === partId) : undefined;
  const lowStock = linkedPart && linkedPart.stock <= 0;
  const warnStock = linkedPart && linkedPart.stock > 0 && linkedPart.stock <= linkedPart.minStock;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && matches[highlight]) {
      e.preventDefault();
      pick(matches[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function pick(p: Part) {
    onSelect(p);
    setOpen(false);
    setShowCreate(false);
  }

  function handleCreate() {
    const name = value.trim();
    if (!name) {
      toast.error("أدخل اسم المنتج أولاً");
      return;
    }
    const id = `PRT-${Date.now().toString(36).toUpperCase()}`;
    const part: Part = {
      id,
      name,
      partNumber: newPart.partNumber.trim() || id,
      supplier: "—",
      buyPrice: Number(newPart.buyPrice) || 0,
      sellPrice: Number(newPart.sellPrice) || 0,
      stock: Number(newPart.stock) || 0,
      minStock: 0,
      sold: 0,
      status: "active",
    };
    inventoryStore.add(part);
    toast.success(`تمت إضافة "${name}" إلى المخزن`);
    setNewPart({ partNumber: "", sellPrice: 0, buyPrice: 0, stock: 0 });
    setShowCreate(false);
    pick(part);
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <Search size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
            setShowCreate(false);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "ابحث برقم القطعة أو الاسم..."}
          className={cn(
            "h-9 pr-7",
            (lowStock || warnStock) && "border-warning",
          )}
        />
      </div>

      {linkedPart && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px]",
            lowStock ? "text-destructive" : warnStock ? "text-warning" : "text-muted-foreground",
          )}
        >
          {(lowStock || warnStock) && <AlertTriangle size={10} />}
          <Package size={10} />
          <span>
            متوفر: {linkedPart.stock} • الحد الأدنى: {linkedPart.minStock}
            {lowStock && " • نفذ من المخزن"}
            {warnStock && " • كمية منخفضة"}
          </span>
        </div>
      )}

      {open && matches.length > 0 && !showCreate && (
        <div className="absolute z-50 mt-1 w-[min(32rem,92vw)] right-0 bg-popover border border-border rounded-md shadow-lg max-h-96 overflow-y-auto">
          {matches.map((p, idx) => {
            const out = p.stock <= 0;
            const low = p.stock > 0 && p.stock <= p.minStock;
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setHighlight(idx)}
                className={cn(
                  "w-full text-right px-3 py-2 text-xs border-b border-border/50 last:border-0 flex items-center justify-between gap-3",
                  highlight === idx ? "bg-secondary" : "hover:bg-secondary/50",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-foreground font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {p.partNumber} • {p.supplier}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-primary font-semibold">{p.sellPrice.toFixed(3)} ر.ع</div>
                  <div
                    className={cn(
                      "text-[10px]",
                      out ? "text-destructive" : low ? "text-warning" : "text-success",
                    )}
                  >
                    {out ? "نفذ" : `${p.stock} متوفر`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && value.trim() && matches.length === 0 && !showCreate && (
        <div className="absolute z-50 mt-1 w-[min(28rem,92vw)] right-0 bg-popover border border-border rounded-md shadow-lg p-3 space-y-2">
          <div className="text-[11px] text-muted-foreground">
            لا توجد قطع مطابقة في المخزن. هل تريد إضافة "{value}" كمنتج جديد؟
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full gap-1 h-8"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={12} /> إضافة منتج جديد للمخزن
          </Button>
          <div className="text-[10px] text-muted-foreground text-center">
            أو تابع تعبئة الوصف والسعر لحفظ البند يدوياً فقط (دون إضافته للمخزن).
          </div>
        </div>
      )}

      {open && showCreate && (
        <div className="absolute z-50 mt-1 w-[min(28rem,92vw)] right-0 bg-popover border border-border rounded-md shadow-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-foreground">إضافة منتج جديد للمخزن</div>
          <div className="text-[11px] text-muted-foreground truncate">الاسم: {value}</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">رقم القطعة</label>
              <Input
                value={newPart.partNumber}
                onChange={(e) => setNewPart({ ...newPart, partNumber: e.target.value })}
                className="h-8 text-xs"
                placeholder="تلقائي"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">سعر البيع (ر.ع)</label>
              <Input
                type="number"
                step="0.001"
                value={newPart.sellPrice}
                onChange={(e) => setNewPart({ ...newPart, sellPrice: Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">سعر التكلفة</label>
              <Input
                type="number"
                step="0.001"
                value={newPart.buyPrice}
                onChange={(e) => setNewPart({ ...newPart, buyPrice: Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">الكمية الحالية</label>
              <Input
                type="number"
                value={newPart.stock}
                onChange={(e) => setNewPart({ ...newPart, stock: Number(e.target.value) })}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              className="flex-1 h-8"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
            >
              حفظ وإضافة للبند
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowCreate(false)}
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
