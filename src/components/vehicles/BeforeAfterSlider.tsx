import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

/**
 * Slider مقارنة قبل/بعد تفاعلي.
 * - السحب أو التحريك يكشف الصورة الثانية.
 * - يدعم اللمس (موبايل) والماوس.
 */
export default function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "قبل / Before",
  afterLabel = "بعد / After",
  className,
}: Props) {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function updateFromClientX(clientX: number) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPos(pct);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    updateFromClientX(e.clientX);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!dragging || !e.touches[0]) return;
    updateFromClientX(e.touches[0].clientX);
  }

  return (
    <div
      ref={ref}
      className={cn(
        "relative w-full aspect-video overflow-hidden rounded-xl border border-border bg-secondary select-none",
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => setDragging(false)}
    >
      {/* Before image (full) */}
      <img src={beforeUrl} alt="Before" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />

      {/* After image (clipped) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={afterUrl} alt="After" className="absolute inset-0 w-full h-full object-cover" />
      </div>

      {/* Labels */}
      <div className="absolute top-3 right-3 bg-background/80 backdrop-blur px-2.5 py-1 rounded-md text-[11px] font-medium text-foreground border border-border">
        {beforeLabel}
      </div>
      <div className="absolute top-3 left-3 bg-primary/90 backdrop-blur px-2.5 py-1 rounded-md text-[11px] font-medium text-primary-foreground">
        {afterLabel}
      </div>

      {/* Divider line + handle */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-none" style={{ left: `${pos}%` }} />
      <button
        type="button"
        onMouseDown={() => setDragging(true)}
        onTouchStart={() => setDragging(true)}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center cursor-ew-resize border-2 border-primary"
        style={{ left: `${pos}%` }}
        aria-label="اسحب للمقارنة"
      >
        <GripVertical size={16} className="text-primary" />
      </button>

      {/* Range fallback for keyboard accessibility */}
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="sr-only"
        aria-label="موضع المقارنة"
      />
    </div>
  );
}
