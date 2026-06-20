import { useRef, useState } from "react";
import { Sparkles, Loader2, Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { extractFromFile, type ExtractSchema } from "@/lib/aiExtract";

interface Props {
  schema: ExtractSchema;
  onExtracted: (data: Record<string, string>) => void;
  label?: string;
  hint?: string;
  /** accept attribute — defaults to images + PDF */
  accept?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

/**
 * زر يرفع صورة أو PDF ويستخرج منه بيانات منظمة عبر الذكاء الاصطناعي.
 * يستدعي `onExtracted(data)` بالحقول التي قرأها النموذج.
 */
export default function AiExtractButton({
  schema,
  onExtracted,
  label = "تعبئة تلقائية من صورة/PDF",
  hint,
  accept = "image/*,application/pdf",
  variant = "outline",
  size = "sm",
  className = "",
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (file.size > 12 * 1024 * 1024) {
      toast.error("الملف كبير جداً (الحد الأقصى 12MB)");
      return;
    }
    setBusy(true);
    const tid = toast.loading("جارٍ تحليل المستند بالذكاء الاصطناعي…");
    try {
      const data = await extractFromFile(file, schema);
      const found = Object.values(data).filter((v) => v && String(v).trim()).length;
      if (found === 0) {
        toast.warning("لم يُستخرج أي بيان — جرّب صورة أوضح", { id: tid });
      } else {
        toast.success(`تم استخراج ${found} حقل ✓`, { id: tid });
        onExtracted(data);
      }
    } catch (e: any) {
      toast.error(e?.message || "فشل الاستخراج", { id: tid });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="gap-1.5"
          title="التقاط صورة بالكاميرا"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} className="text-primary" />}
          كاميرا
        </Button>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="gap-1.5"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-primary" />}
          {label}
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
