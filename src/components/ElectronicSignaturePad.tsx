import { useEffect, useRef } from "react";
import { FileSignature, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ElectronicSignaturePadProps {
  value?: string;
  onChange: (value: string) => void;
  title?: string;
  description?: string;
  disabled?: boolean;
}

export default function ElectronicSignaturePad({
  value,
  onChange,
  title = "التوقيع الإلكتروني",
  description = "وقّع داخل المربع باستخدام الإصبع أو الفأرة.",
  disabled = false,
}: ElectronicSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const position = point(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    context.strokeStyle = "#0f172a";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(position.x, position.y);
    drawingRef.current = true;
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const position = point(event);
    context.lineTo(position.x, position.y);
    context.stroke();
  };

  const finish = () => {
    const canvas = canvasRef.current;
    if (!drawingRef.current || !canvas || disabled) return;
    drawingRef.current = false;
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    if (disabled) return;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <div className="space-y-2 rounded-lg border bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold"><FileSignature size={16} /> {title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={clear} disabled={disabled || !value}>
          <Trash2 size={14} /> مسح التوقيع
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={900}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
        aria-label={title}
        className="h-36 w-full touch-none rounded-md border border-dashed border-slate-400 bg-white"
      />
      <p className="text-[11px] text-muted-foreground">{value ? "تم التقاط التوقيع وسيُحفظ عند تجهيز الورقة." : "التوقيع مطلوب قبل تجهيز ورقة التسليم."}</p>
    </div>
  );
}
