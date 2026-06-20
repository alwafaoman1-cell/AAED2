import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { customersStore, type Customer } from "@/lib/customersStore";
import { User, Phone, Sparkles } from "lucide-react";

interface Props {
  value: string;
  onChange: (name: string) => void;
  /** Called when user selects an existing customer from the list. */
  onSelect?: (customer: Customer) => void;
  placeholder?: string;
  className?: string;
}

/**
 * حقل اسم العميل مع اقتراحات من سجل العملاء.
 * عند اختيار عميل موجود نمرر بياناته للأعلى ليتم تعبئة الجوال تلقائياً.
 */
export default function CustomerAutocomplete({ value, onChange, onSelect, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => customersStore.subscribe(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    void tick;
    const q = value.trim().toLowerCase();
    const all = customersStore.getAll();
    if (!q) return all.slice(0, 6);
    return all
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) || (c.phone || "").includes(q),
      )
      .slice(0, 8);
  }, [value, tick]);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || "ابحث عن عميل أو أدخل اسماً جديداً"}
        className={className || "bg-secondary border-border text-foreground"}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.name);
                onSelect?.(c);
                setOpen(false);
              }}
              className="w-full text-right px-3 py-2 hover:bg-secondary/60 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <User size={13} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{c.name}</div>
                  {c.phone && (
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1" dir="ltr">
                      <Phone size={9} /> {c.phone}
                    </div>
                  )}
                </div>
              </div>
              {c.tag === "vip" && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary inline-flex items-center gap-1">
                  <Sparkles size={9} /> VIP
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
