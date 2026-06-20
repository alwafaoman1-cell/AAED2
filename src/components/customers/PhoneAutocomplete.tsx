import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { customersStore, type Customer } from "@/lib/customersStore";
import { Phone, User } from "lucide-react";

interface Props {
  value: string;
  onChange: (phone: string) => void;
  /** Called when user picks an existing customer from suggestions. */
  onSelect?: (customer: Customer) => void;
  placeholder?: string;
  className?: string;
}

/**
 * حقل رقم الهاتف مع اقتراحات من سجل العملاء (بحث بالرقم أو الاسم).
 * عند اختيار عميل موجود نمرر بياناته للأعلى ليتم تعبئة الاسم تلقائياً.
 */
export default function PhoneAutocomplete({ value, onChange, onSelect, placeholder, className }: Props) {
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
    const all = customersStore.getAll().filter((c) => c.phone);
    if (!q) return all.slice(0, 6);
    return all
      .filter(
        (c) =>
          (c.phone || "").includes(q) || c.name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [value, tick]);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || "ابحث برقم الهاتف أو أدخل رقماً جديداً"}
        className={className || "bg-secondary border-border text-foreground"}
        autoComplete="off"
        dir="ltr"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.phone);
                onSelect?.(c);
                setOpen(false);
              }}
              className="w-full text-right px-3 py-2 hover:bg-secondary/60 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Phone size={13} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate" dir="ltr">{c.phone}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <User size={9} /> {c.name}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
