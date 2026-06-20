import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Car, User, X } from "lucide-react";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (vehicle: Vehicle) => void;
  /** فلترة بمالك معيّن (اسم العميل) */
  ownerFilter?: string;
}

export default function VehiclePickerDialog({ open, onOpenChange, onPick, ownerFilter }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>(vehiclesStore.getAll());
  const [q, setQ] = useState("");

  useEffect(() => vehiclesStore.subscribe(() => setVehicles([...vehiclesStore.getAll()])), []);
  useEffect(() => { if (open) setQ(""); }, [open]);

  const visible = useMemo(() => {
    if (!ownerFilter) return vehicles;
    const term = ownerFilter.trim().toLowerCase();
    return vehicles.filter((v) => (v.owner || "").toLowerCase().includes(term));
  }, [vehicles, ownerFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return visible.slice(0, 60);
    return visible
      .filter((v) =>
        [v.plate, v.vin, v.owner, v.ownerPhone, v.type]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(term))
      )
      .slice(0, 60);
  }, [q, visible]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl bg-card border-border max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Car size={18} className="text-primary" />
            اختر سيارة العميل
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            ابحث برقم اللوحة، VIN، اسم المالك، أو الجوال
            {ownerFilter ? ` — مفلتر بمالك: ${ownerFilter}` : ""}
          </p>
        </DialogHeader>

        <div className="relative">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="مثال: أ ب ج 1234 أو أحمد محمد"
            className="pr-9 pl-9 h-11 text-sm"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary text-muted-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground px-1">
          {filtered.length} نتيجة
        </div>

        <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
              لا توجد سيارات مطابقة
            </div>
          ) : (
            filtered.map((v) => (
              <button
                key={v.id}
                onClick={() => { onPick(v); onOpenChange(false); }}
                className="w-full text-right p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-secondary/40 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <Car size={12} className="text-primary" />
                    <span className="font-mono text-xs text-primary font-semibold">{v.plate}</span>
                    {v.year && <span className="text-[10px] text-muted-foreground">• {v.year}</span>}
                  </div>
                  {v.visits > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-foreground">
                      {v.visits} زيارة
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <User size={11} className="text-muted-foreground" />
                    <span className="truncate">{v.owner || "—"}</span>
                  </div>
                  <div className="text-muted-foreground truncate">{v.type || "—"}</div>
                  {v.vin && (
                    <div className="text-[10px] text-muted-foreground font-mono col-span-2 truncate">
                      VIN: {v.vin}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
