import { useState } from "react";
import { Calendar, X } from "lucide-react";
import BeforeAfterSlider from "./BeforeAfterSlider";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { VehiclePhotoPair } from "@/lib/vehiclesStore";

interface Props {
  pairs: VehiclePhotoPair[];
}

/**
 * شبكة (Grid) لعرض كل أزواج الصور قبل/بعد.
 * - كل بطاقة تعرض الصورتين جنبًا إلى جنب مع شارات Before/After.
 * - الضغط على البطاقة يفتح Slider مقارنة تفاعلي بحجم كبير.
 */
export default function PhotoPairsGrid({ pairs }: Props) {
  const [active, setActive] = useState<VehiclePhotoPair | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pairs.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p)}
            className="group text-right bg-secondary/30 border border-border rounded-xl overflow-hidden hover:border-primary/40 hover:shadow-lg transition-all"
          >
            <div className="grid grid-cols-2 gap-px bg-border">
              <div className="relative aspect-video bg-secondary">
                <img src={p.beforeUrl} alt="قبل" className="w-full h-full object-cover" />
                <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-background/85 text-foreground border border-border">
                  قبل
                </span>
              </div>
              <div className="relative aspect-video bg-secondary">
                <img src={p.afterUrl} alt="بعد" className="w-full h-full object-cover" />
                <span className="absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                  بعد
                </span>
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-xs font-medium text-foreground truncate">
                {p.caption || "مرحلة الإصلاح"}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={10} />
                  {p.date}
                </span>
                {p.workOrderId && (
                  <span className="font-mono text-primary truncate">{p.workOrderId}</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent dir="rtl" className="bg-card border-border max-w-4xl p-4">
          {active && (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {active.caption || "مقارنة قبل / بعد"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {active.workOrderId && <span className="text-primary font-mono">{active.workOrderId} • </span>}
                    {active.date}
                  </div>
                </div>
              </div>
              <BeforeAfterSlider beforeUrl={active.beforeUrl} afterUrl={active.afterUrl} />
              <p className="text-[11px] text-muted-foreground text-center">
                اسحب الشريط يميناً ويساراً للمقارنة بين الصورتين.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
