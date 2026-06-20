import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, X, Download } from "lucide-react";

export interface LightboxPhoto {
  id: string;
  dataUrl: string;
  caption?: string;
  phase?: string;
  phaseLabel?: string;
  orderId?: string;
  date?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: LightboxPhoto[];
  startIndex?: number;
}

export default function PhotoLightbox({ open, onOpenChange, photos, startIndex = 0 }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  useEffect(() => {
    if (open) {
      setIndex(startIndex);
      setZoom(1);
      setRotate(0);
    }
  }, [open, startIndex]);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % Math.max(photos.length, 1));
    setZoom(1);
    setRotate(0);
  }, [photos.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % Math.max(photos.length, 1));
    setZoom(1);
    setRotate(0);
  }, [photos.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") next();
      else if (e.key === "ArrowRight") prev();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 5));
      else if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.5));
      else if (e.key.toLowerCase() === "r") setRotate((r) => (r + 90) % 360);
      else if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev, onOpenChange]);

  if (!photos.length) return null;
  const photo = photos[index];

  function downloadCurrent() {
    if (!photo) return;
    const a = document.createElement("a");
    a.href = photo.dataUrl;
    a.download = `${photo.orderId || "photo"}-${photo.phase || ""}-${index + 1}.jpg`;
    a.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="bg-background/95 border-border p-0 max-w-[100vw] w-screen h-screen rounded-none gap-0 flex flex-col"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/60 backdrop-blur z-10">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">صورة</span>
              <span className="font-mono font-bold text-foreground">{index + 1}</span>
              <span className="text-muted-foreground">/ {photos.length}</span>
              {photo.phaseLabel && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary mr-2">
                  {photo.phaseLabel}
                </span>
              )}
              {photo.orderId && (
                <span className="text-[10px] font-mono text-muted-foreground">{photo.orderId}</span>
              )}
              {photo.date && <span className="text-[10px] text-muted-foreground">• {photo.date}</span>}
            </div>
            {photo.caption && (
              <span className="text-[11px] text-muted-foreground truncate mt-0.5">{photo.caption}</span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="تصغير" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>
              <ZoomOut size={16} />
            </Button>
            <span className="text-[11px] font-mono text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="تكبير" onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}>
              <ZoomIn size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="تدوير" onClick={() => setRotate((r) => (r + 90) % 360)}>
              <RotateCw size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="تنزيل" onClick={downloadCurrent}>
              <Download size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="إغلاق" onClick={() => onOpenChange(false)}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Viewer */}
        <div className="flex-1 relative overflow-hidden bg-black/40">
          <button
            onClick={prev}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-card/80 backdrop-blur border border-border flex items-center justify-center hover:bg-card transition"
            title="السابق"
          >
            <ChevronRight size={20} />
          </button>
          <button
            onClick={next}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-card/80 backdrop-blur border border-border flex items-center justify-center hover:bg-card transition"
            title="التالي"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
            <img
              src={photo.dataUrl}
              alt={photo.caption || photo.phase || "photo"}
              className="max-w-none transition-transform duration-200 select-none"
              style={{
                transform: `scale(${zoom}) rotate(${rotate}deg)`,
                transformOrigin: "center center",
              }}
              draggable={false}
              onDoubleClick={() => setZoom((z) => (z >= 2 ? 1 : 2))}
            />
          </div>
        </div>

        {/* Thumbnails */}
        {photos.length > 1 && (
          <div className="border-t border-border bg-card/60 backdrop-blur p-2 overflow-x-auto">
            <div className="flex gap-1.5 min-w-min">
              {photos.map((p, i) => (
                <button
                  key={p.id + i}
                  onClick={() => { setIndex(i); setZoom(1); setRotate(0); }}
                  className={`shrink-0 h-14 w-14 rounded overflow-hidden border-2 transition ${
                    i === index ? "border-primary" : "border-border hover:border-primary/50"
                  }`}
                >
                  <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
