import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  MousePointer2, ArrowRight, Circle as CircleIcon, X as XIcon,
  Type, Square, Pencil, Undo2, Redo2, Trash2, Download, ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AnnotationTool = "select" | "arrow" | "circle" | "x" | "text" | "rect" | "freehand";

interface BaseShape {
  id: string;
  color: string;
  strokeWidth: number;
}
interface ArrowShape extends BaseShape { type: "arrow"; x1: number; y1: number; x2: number; y2: number; }
interface CircleShape extends BaseShape { type: "circle"; cx: number; cy: number; r: number; }
interface XShape extends BaseShape { type: "x"; cx: number; cy: number; size: number; }
interface RectShape extends BaseShape { type: "rect"; x: number; y: number; w: number; h: number; }
interface TextShape extends BaseShape { type: "text"; x: number; y: number; text: string; fontSize: number; }
interface FreehandShape extends BaseShape { type: "freehand"; points: { x: number; y: number }[]; }
type Shape = ArrowShape | CircleShape | XShape | RectShape | TextShape | FreehandShape;

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#000000", "#ffffff"];

interface Props {
  /** Background image src — SVG vehicle diagram or actual photo URL */
  imageSrc: string;
  /** Called when user clicks "save" — returns PNG dataURL of canvas+image flattened */
  onSave: (annotatedDataUrl: string, shapes: Shape[]) => void;
  /** Called automatically after every shape change — for auto-attach to PDF */
  onChange?: (annotatedDataUrl: string, shapes: Shape[]) => void;
  initialShapes?: Shape[];
  /** Optional callback to let parent change image source (SVG vs photo picker) */
  onChangeImage?: () => void;
}

export default function VehicleAnnotationCanvas({ imageSrc, onSave, onChange, initialShapes = [], onChangeImage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("arrow");
  const [color, setColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [shapes, setShapes] = useState<Shape[]>(initialShapes);
  const [history, setHistory] = useState<Shape[][]>([initialShapes]);
  const [histIdx, setHistIdx] = useState(0);
  const [drawing, setDrawing] = useState<Shape | null>(null);
  const [imgSize, setImgSize] = useState({ w: 800, h: 500 });

  const pushHistory = useCallback((next: Shape[]) => {
    const trimmed = history.slice(0, histIdx + 1);
    trimmed.push(next);
    setHistory(trimmed);
    setHistIdx(trimmed.length - 1);
    setShapes(next);
  }, [history, histIdx]);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      // Fit into max 900x560
      const maxW = 900, maxH = 560;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setImgSize({ w: img.naturalWidth * scale, h: img.naturalHeight * scale });
      requestAnimationFrame(redraw);
    };
    img.onerror = () => {
      // Fallback: blank white background
      imgRef.current = null;
      setImgSize({ w: 800, h: 500 });
      requestAnimationFrame(redraw);
    };
    img.src = imageSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  const drawShape = (ctx: CanvasRenderingContext2D, s: Shape) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (s.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // arrow head
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const len = 14 + s.strokeWidth * 2;
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - len * Math.cos(ang - Math.PI / 6), s.y2 - len * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(s.x2 - len * Math.cos(ang + Math.PI / 6), s.y2 - len * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.type === "circle") {
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, Math.max(2, s.r), 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === "x") {
      const h = s.size / 2;
      ctx.beginPath();
      ctx.moveTo(s.cx - h, s.cy - h); ctx.lineTo(s.cx + h, s.cy + h);
      ctx.moveTo(s.cx + h, s.cy - h); ctx.lineTo(s.cx - h, s.cy + h);
      ctx.stroke();
    } else if (s.type === "rect") {
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    } else if (s.type === "text") {
      ctx.font = `${s.fontSize}px 'Noto Sans Arabic', sans-serif`;
      ctx.textBaseline = "top";
      // background pill for legibility
      const m = ctx.measureText(s.text);
      const padX = 6, padY = 3;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(s.x - padX, s.y - padY, m.width + padX * 2, s.fontSize + padY * 2);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
    } else if (s.type === "freehand") {
      if (s.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = imgSize.w;
    canvas.height = imgSize.h;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, imgSize.w, imgSize.h);
    }
    shapes.forEach(s => drawShape(ctx, s));
    if (drawing) drawShape(ctx, drawing);
  }, [shapes, drawing, imgSize]);

  useEffect(() => { redraw(); }, [redraw]);

  // Auto-emit annotated dataURL whenever shapes change (not while actively drawing)
  useEffect(() => {
    if (!onChange || drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = setTimeout(() => {
      try { onChange(canvas.toDataURL("image/png"), shapes); } catch {}
    }, 80);
    return () => clearTimeout(t);
  }, [shapes, drawing, imgSize, onChange]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return {
      x: ((cx - rect.left) / rect.width) * canvas.width,
      y: ((cy - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (tool === "select") return;
    e.preventDefault();
    const { x, y } = getPos(e);
    const id = Math.random().toString(36).slice(2, 9);
    const base = { id, color, strokeWidth };

    if (tool === "x") {
      pushHistory([...shapes, { ...base, type: "x", cx: x, cy: y, size: 22 + strokeWidth * 3 }]);
      return;
    }
    if (tool === "text") {
      const t = window.prompt("اكتب التعليق:");
      if (t && t.trim()) {
        pushHistory([...shapes, { ...base, type: "text", x, y, text: t.trim(), fontSize: 16 + strokeWidth }]);
      }
      return;
    }
    if (tool === "freehand") {
      setDrawing({ ...base, type: "freehand", points: [{ x, y }] });
      return;
    }
    if (tool === "arrow") setDrawing({ ...base, type: "arrow", x1: x, y1: y, x2: x, y2: y });
    if (tool === "circle") setDrawing({ ...base, type: "circle", cx: x, cy: y, r: 0 });
    if (tool === "rect") setDrawing({ ...base, type: "rect", x, y, w: 0, h: 0 });
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    if (drawing.type === "arrow") setDrawing({ ...drawing, x2: x, y2: y });
    else if (drawing.type === "circle") {
      const r = Math.hypot(x - drawing.cx, y - drawing.cy);
      setDrawing({ ...drawing, r });
    } else if (drawing.type === "rect") {
      setDrawing({ ...drawing, w: x - drawing.x, h: y - drawing.y });
    } else if (drawing.type === "freehand") {
      setDrawing({ ...drawing, points: [...drawing.points, { x, y }] });
    }
  };

  const handleUp = () => {
    if (!drawing) return;
    // discard tiny shapes
    let keep = true;
    if (drawing.type === "arrow") keep = Math.hypot(drawing.x2 - drawing.x1, drawing.y2 - drawing.y1) > 4;
    if (drawing.type === "circle") keep = drawing.r > 3;
    if (drawing.type === "rect") keep = Math.abs(drawing.w) > 4 && Math.abs(drawing.h) > 4;
    if (drawing.type === "freehand") keep = drawing.points.length > 2;
    if (keep) pushHistory([...shapes, drawing]);
    setDrawing(null);
  };

  const undo = () => {
    if (histIdx > 0) {
      const i = histIdx - 1;
      setHistIdx(i);
      setShapes(history[i]);
    }
  };
  const redo = () => {
    if (histIdx < history.length - 1) {
      const i = histIdx + 1;
      setHistIdx(i);
      setShapes(history[i]);
    }
  };
  const clearAll = () => {
    if (shapes.length === 0) return;
    if (!confirm("مسح كل التعليقات؟")) return;
    pushHistory([]);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl, shapes);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `vehicle-damage-${Date.now()}.png`;
    a.click();
  };

  const tools: { id: AnnotationTool; icon: typeof ArrowRight; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "تحديد" },
    { id: "arrow", icon: ArrowRight, label: "سهم" },
    { id: "circle", icon: CircleIcon, label: "دائرة" },
    { id: "x", icon: XIcon, label: "علامة X" },
    { id: "rect", icon: Square, label: "مستطيل" },
    { id: "freehand", icon: Pencil, label: "خط حر" },
    { id: "text", icon: Type, label: "نص" },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
        {tools.map(t => {
          const Icon = t.icon;
          return (
            <Button
              key={t.id} type="button" size="sm" variant={tool === t.id ? "default" : "outline"}
              onClick={() => setTool(t.id)} className="gap-1 h-8" title={t.label}
            >
              <Icon size={14} /> <span className="text-xs hidden sm:inline">{t.label}</span>
            </Button>
          );
        })}

        <div className="h-6 w-px bg-border mx-1" />

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button
              key={c} type="button" onClick={() => setColor(c)}
              className={cn("w-6 h-6 rounded-full border-2 transition-all",
                color === c ? "border-foreground scale-110 ring-2 ring-ring" : "border-border")}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-border mx-1" />

        {/* Stroke width */}
        <div className="flex items-center gap-1">
          {[2, 3, 5, 8].map(w => (
            <button
              key={w} type="button" onClick={() => setStrokeWidth(w)}
              className={cn("w-7 h-7 rounded border flex items-center justify-center transition-all",
                strokeWidth === w ? "border-foreground bg-background" : "border-border")}
              title={`سُمك ${w}`}
            >
              <span style={{ width: w, height: w, background: color, borderRadius: "50%" }} />
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-border mx-1" />

        <Button size="sm" variant="outline" onClick={undo} disabled={histIdx === 0} className="gap-1 h-8" title="تراجع">
          <Undo2 size={14} />
        </Button>
        <Button size="sm" variant="outline" onClick={redo} disabled={histIdx >= history.length - 1} className="gap-1 h-8" title="إعادة">
          <Redo2 size={14} />
        </Button>
        <Button size="sm" variant="outline" onClick={clearAll} className="gap-1 h-8 text-destructive" title="مسح الكل">
          <Trash2 size={14} />
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {onChangeImage && (
            <Button size="sm" variant="outline" onClick={onChangeImage} className="gap-1 h-8">
              <ImageIcon size={14} /> <span className="text-xs">تغيير الصورة</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleDownload} className="gap-1 h-8">
            <Download size={14} /> <span className="text-xs">تنزيل</span>
          </Button>
          <Button size="sm" onClick={handleSave} className="gradient-gold text-primary-foreground gap-1 h-8">
            حفظ التعليقات
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="rounded-lg border-2 border-border bg-white overflow-auto" style={{ maxHeight: "70vh" }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
          style={{
            cursor: tool === "select" ? "default" : "crosshair",
            display: "block",
            width: "100%",
            maxWidth: imgSize.w,
            margin: "0 auto",
            touchAction: "none",
          }}
        />
      </div>

      <div className="text-[10px] text-muted-foreground text-center">
        💡 اختر أداة من الشريط أعلاه ثم ارسم على الصورة. اضغط "حفظ التعليقات" لإرفاقها بتقرير الفحص.
      </div>
    </div>
  );
}

// Default vehicle SVG (top view) — generic outline usable for any vehicle type
const _VEHICLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"><rect width="800" height="500" fill="#fafafa"/><g fill="none" stroke="#1a1a2e" stroke-width="2.5"><path d="M180 100 Q400 70 620 100 L660 180 L680 250 L660 320 L620 400 Q400 430 180 400 L140 320 L120 250 L140 180 Z"/><path d="M250 130 Q400 115 550 130 L530 210 Q400 200 270 210 Z" fill="#e0eaf5"/><path d="M270 290 Q400 280 530 290 L550 370 Q400 385 250 370 Z" fill="#e0eaf5"/><line x1="280" y1="220" x2="520" y2="220" stroke-dasharray="4 4"/><line x1="280" y1="280" x2="520" y2="280" stroke-dasharray="4 4"/><line x1="370" y1="115" x2="370" y2="200"/><line x1="370" y1="300" x2="370" y2="395"/><line x1="430" y1="115" x2="430" y2="200"/><line x1="430" y1="300" x2="430" y2="395"/><circle cx="180" cy="160" r="10"/><circle cx="620" cy="160" r="10"/><rect x="155" y="135" width="35" height="55" rx="6" fill="#1a1a2e"/><rect x="610" y="135" width="35" height="55" rx="6" fill="#1a1a2e"/><rect x="155" y="310" width="35" height="55" rx="6" fill="#1a1a2e"/><rect x="610" y="310" width="35" height="55" rx="6" fill="#1a1a2e"/><ellipse cx="200" cy="105" rx="22" ry="10" fill="#fef3c7"/><ellipse cx="600" cy="105" rx="22" ry="10" fill="#fef3c7"/><ellipse cx="200" cy="395" rx="22" ry="10" fill="#fecaca"/><ellipse cx="600" cy="395" rx="22" ry="10" fill="#fecaca"/></g><g font-family="Noto Sans Arabic,Inter,sans-serif" font-size="11" fill="#666" text-anchor="middle"><text x="400" y="40">FRONT \u2014 \u0623\u0645\u0627\u0645\u064A</text><text x="400" y="475">REAR \u2014 \u062E\u0644\u0641\u064A</text><text x="40" y="255" transform="rotate(-90 40 255)">RIGHT \u2014 \u064A\u0645\u064A\u0646</text><text x="760" y="255" transform="rotate(90 760 255)">LEFT \u2014 \u064A\u0633\u0627\u0631</text></g></svg>`;
// Use UTF-8 safe encoding (encodeURIComponent) instead of btoa to support Arabic glyphs
export const DEFAULT_VEHICLE_SVG_DATA_URL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(_VEHICLE_SVG);
