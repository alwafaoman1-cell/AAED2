import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { customersStore, type Customer } from "@/lib/customersStore";
import { Phone, User, Building2, UserPlus, CheckCircle2, AlertCircle, Sparkles, X } from "lucide-react";
import NewCustomerDialog from "./NewCustomerDialog";

interface Props {
  /** العميل المختار حالياً (id) أو فارغ. */
  customerId?: string;
  /** يتم استدعاؤه عند اختيار/إنشاء عميل. لو null = إلغاء الاختيار. */
  onSelect: (c: Customer | null) => void;
  /** خفي زر إنشاء عميل جديد (للقراءة فقط). */
  disableCreate?: boolean;
  placeholder?: string;
}

/**
 * نظام موحّد للبحث عن العميل برقم الهاتف.
 * - يبحث فورياً في سجل العملاء.
 * - إذا لم يجد نتائج، يظهر زر «إضافة عميل جديد (إلزامي)» يفتح حواراً.
 * - لا يسمح بإكمال العملية بدون اختيار عميل موجود أو إنشاء جديد.
 */
export default function CustomerPhoneLookup({ customerId, onSelect, disableCreate, placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => customersStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selected = useMemo(() => {
    void tick;
    return customerId ? customersStore.getById(customerId) : undefined;
  }, [customerId, tick]);

  const matches = useMemo(() => {
    void tick;
    const q = query.trim().toLowerCase();
    if (!q) return customersStore.getAll().slice(0, 6);
    return customersStore.getAll()
      .filter((c) => (c.phone || "").includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, tick]);

  // عند اختيار عميل، عرض بطاقة بدلاً من حقل البحث
  if (selected) {
    const isPending = customersStore.isInsurancePending(selected.name);
    return (
      <div className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border ${
        isPending ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {isPending ? <AlertCircle size={16} className="text-amber-500 shrink-0" /> :
            selected.type === "company" ? <Building2 size={16} className="text-emerald-500 shrink-0" /> :
            <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate flex items-center gap-1">
              {selected.name}
              {isPending && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">تأمين معلّق</span>}
              {selected.type === "company" && !isPending && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600">شركة</span>}
            </div>
            {selected.phone && <div className="text-[10px] text-muted-foreground" dir="ltr">{selected.phone}</div>}
          </div>
        </div>
        <Button size="sm" variant="ghost" type="button" onClick={() => { onSelect(null); setQuery(""); }} className="h-7 w-7 p-0">
          <X size={14} />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <div className="relative">
          <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder || "ابحث برقم الهاتف أو اسم العميل"}
            className="bg-secondary border-border text-foreground pr-9"
            autoComplete="off"
            dir="ltr"
          />
        </div>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-72 overflow-y-auto">
            {matches.length > 0 ? (
              matches.map((c) => {
                const isPending = customersStore.isInsurancePending(c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onSelect(c); setOpen(false); setQuery(""); }}
                    className="w-full text-right px-3 py-2 hover:bg-secondary/60 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {c.type === "company" ? <Building2 size={13} className="text-primary shrink-0" /> : <User size={13} className="text-primary shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate flex items-center gap-1">
                          {c.name}
                          {isPending && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-600">تأمين</span>}
                        </div>
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
                );
              })
            ) : (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                لا يوجد عميل بهذا الرقم
              </div>
            )}

            {!disableCreate && (
              <button
                type="button"
                onClick={() => { setShowNewDialog(true); setOpen(false); }}
                className="w-full px-3 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border-t-2 border-primary/30 flex items-center justify-center gap-2 font-medium text-sm"
              >
                <UserPlus size={14} />
                إضافة عميل جديد (إلزامي)
              </button>
            )}
          </div>
        )}
      </div>

      <NewCustomerDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        initialPhone={/^\d/.test(query) ? query : ""}
        initialName={/^\d/.test(query) ? "" : query}
        onCreated={(c) => { onSelect(c); setQuery(""); }}
      />
    </>
  );
}
