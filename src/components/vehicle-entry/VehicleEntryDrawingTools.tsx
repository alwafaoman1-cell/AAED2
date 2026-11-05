import {useId,useRef,useState,type PointerEvent} from "react";
import {useTranslation} from "react-i18next";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import type {VehicleEntryDamageMark} from "@/lib/vehicleEntryService";
import "@/lib/i18n/vehicleIntakeWizard";
export function DamageMap({
  marks,
  onAdd,
  onClear,
}: {
  marks: VehicleEntryDamageMark[];
  onAdd: (x: number, y: number) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    onAdd(Number(x.toFixed(2)), Number(y.toFixed(2)));
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label={t("vehicleIntakeWizard.views.damageMapLabel")}
        className="relative mx-auto aspect-[944/1676] w-full max-w-[380px] overflow-hidden rounded-xl border-2 border-dashed border-primary/50 bg-[hsl(var(--document-paper))] touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={handlePointer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onAdd(50, 50);
          }
        }}
      >
        <img
          src="/assets/vehicle-damage-map.png"
          alt={t("vehicleIntakeWizard.views.damageMapImage")}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
          draggable={false}
        />
        {marks.filter((mark) => mark.x != null && mark.y != null).map((mark) => (
          <div
            key={`${mark.mark_number}-${mark.x}-${mark.y}`}
            className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground shadow"
            style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
            title={t("vehicleIntakeWizard.views.markDescription", { number: mark.mark_number, description: mark.description || (mark.damage_type === "صدمة" ? t("vehicleIntakeWizard.views.impactDamage") : mark.damage_type === "ضرر ظاهر" ? t("vehicleIntakeWizard.views.visibleDamage") : mark.damage_type) })}
          >
            {mark.mark_number}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("vehicleIntakeWizard.views.damageMapHelp")}</span>
        <Button type="button" size="sm" variant="outline" onClick={onClear}>{t("vehicleIntakeWizard.views.clearMarkLocations")}</Button>
      </div>
    </div>
  );
}

export function SignaturePad({
  title,
  disabled,
  onSave,
}: {
  title: string;
  disabled?: boolean;
  onSave: (dataUrl: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointer = useRef<number | null>(null);
  const [hasInk, setHasInk] = useState(false);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    };
  }

  function begin(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || event.button !== 0 || drawingPointer.current !== null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const p = point(event);
    canvas.setPointerCapture?.(event.pointerId);
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    drawingPointer.current = event.pointerId;
    setHasInk(true);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (drawingPointer.current !== event.pointerId || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (drawingPointer.current !== event.pointerId) return;
    drawingPointer.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingPointer.current = null;
    setHasInk(false);
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label id={`${id}-title`}>{title}</Label>
        {disabled && <span className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.views.saveBeforeSignature")}</span>}
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.views.signatureHelp")}</p>
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        role="img"
        aria-label={t("vehicleIntakeWizard.views.signatureCanvas", { title })}
        aria-describedby={`${id}-help`}
        aria-disabled={disabled}
        className="h-36 w-full rounded-lg border border-dashed border-border bg-[hsl(var(--document-paper))] text-[hsl(var(--document-ink))] touch-none"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" aria-label={t("vehicleIntakeWizard.views.clearSignature", { title })} onClick={clear} disabled={disabled || !hasInk}>{t("vehicleIntakeWizard.views.clear")}</Button>
        <Button type="button" size="sm" aria-label={t("vehicleIntakeWizard.views.saveNamedSignature", { title })} disabled={disabled || !hasInk} onClick={() => {
          const dataUrl = canvasRef.current?.toDataURL("image/png");
          if (dataUrl) onSave(dataUrl);
        }}>{t("vehicleIntakeWizard.views.saveSignature")}</Button>
      </div>
    </div>
  );
}


