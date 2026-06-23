import { useEffect, useMemo, useRef } from "react";
import { Camera, FileSignature, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import VehicleDiagram, { type DamageMarker } from "@/components/inspection/VehicleDiagram";

interface Props {
  files: File[];
  onFilesChange: (files: File[]) => void;
  markers: DamageMarker[];
  onMarkersChange: (markers: DamageMarker[]) => void;
  signatureDataUrl?: string;
  onSignatureChange: (value?: string) => void;
  showDamageMap: boolean;
}

export default function ReceptionIntakePanel({
  files,
  onFilesChange,
  markers,
  onMarkersChange,
  signatureDataUrl,
  onSignatureChange,
  showDamageMap,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  useEffect(() => {
    if (!signatureDataUrl || !canvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = signatureDataUrl;
  }, [signatureDataUrl]);

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = pointerPosition(event);
    canvas.setPointerCapture(event.pointerId);
    context.strokeStyle = "#0f172a";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawing.current = true;
  }

  function moveSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finishSignature() {
    const canvas = canvasRef.current;
    if (!drawing.current || !canvas) return;
    drawing.current = false;
    onSignatureChange(canvas.toDataURL("image/png"));
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    onSignatureChange(undefined);
  }

  return (
    <div className="space-y-4 rounded-xl border border-info/30 bg-info/5 p-4">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Camera size={16} className="text-info" /> صور المركبة عند الاستلام</h4>
        <p className="mt-1 text-[11px] text-muted-foreground">تُرفع إلى التخزين السحابي وتُربط بأمر العمل بعد الحفظ.</p>
      </div>

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-5 text-sm hover:border-primary/50">
        <ImagePlus size={18} className="text-primary" />
        اختر صورة رئيسية أو صورًا إضافية
        <input
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => onFilesChange([...files, ...Array.from(event.target.files || [])])}
        />
      </label>

      {previews.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {previews.map(({ file, url }, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`} className="relative overflow-hidden rounded-lg border border-border bg-card">
              <img src={url} alt={file.name} className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => onFilesChange(files.filter((_, itemIndex) => itemIndex !== index))}
                className="absolute left-1 top-1 rounded-full bg-background/90 p-1 text-destructive shadow"
                aria-label="حذف الصورة"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showDamageMap && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <h4 className="text-sm font-semibold">تحديد مكان الضرر أو الإصلاح</h4>
          <VehicleDiagram
            markers={markers}
            onAddMarker={(marker) => onMarkersChange([...markers, marker])}
            onRemoveMarker={(index) => onMarkersChange(markers.filter((_, markerIndex) => markerIndex !== index))}
          />
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold"><FileSignature size={16} className="text-primary" /> توقيع العميل</h4>
            <p className="text-[10px] text-muted-foreground">اختياري الآن، ويمكن إرساله لاحقًا عبر رابط التوقيع الآمن.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={clearSignature}><Trash2 size={13} /> مسح</Button>
        </div>
        <canvas
          ref={canvasRef}
          width={900}
          height={190}
          onPointerDown={startSignature}
          onPointerMove={moveSignature}
          onPointerUp={finishSignature}
          onPointerCancel={finishSignature}
          className="h-36 w-full touch-none rounded-lg border border-dashed border-border bg-white"
        />
      </div>
    </div>
  );
}
