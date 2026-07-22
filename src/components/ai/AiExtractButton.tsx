import { useRef, useState } from "react";
import { Sparkles, Loader2, Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const INSURANCE_REVIEW_FIELDS = [
  "insurance_company",
  "claim_number",
  "owner_name",
  "owner_phone",
  "plate_number",
  "plate_letters",
  "plate_country",
  "plate",
  "make",
  "model",
  "year",
  "vin",
  "incident_date",
  "damage_description",
  "estimated_cost",
];

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewValues, setReviewValues] = useState<Record<string, string>>({});
  const [reviewSelected, setReviewSelected] = useState<Record<string, boolean>>({});

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
        if (schema === "insurance_claim") {
          const values = Object.fromEntries(INSURANCE_REVIEW_FIELDS.map((field) => [field, data[field] || ""]));
          setReviewValues(values);
          setReviewSelected(Object.fromEntries(INSURANCE_REVIEW_FIELDS.map((field) => [field, !!values[field]])));
          setReviewOpen(true);
        } else {
          onExtracted(data);
        }
      }
    } catch (e: any) {
      toast.error(e?.message || "فشل الاستخراج", { id: tid });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function applyReviewedValues() {
    const payload: Record<string, string> = {};
    for (const field of INSURANCE_REVIEW_FIELDS) {
      if (reviewSelected[field]) payload[field] = reviewValues[field] || "";
    }
    const plateFromParts = [payload.plate_letters, payload.plate_number].filter(Boolean).join(" ").trim();
    if (plateFromParts && !payload.plate) payload.plate = plateFromParts;
    onExtracted(payload);
    setReviewOpen(false);
    toast.success("تم تطبيق البيانات للمراجعة فقط. لا يتم حفظ المطالبة إلا بعد ضغط زر الحفظ.");
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
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>مراجعة بيانات مستند المطالبة قبل التطبيق</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground">
            لم يتم حفظ أي مطالبة. راجع الحقول وعدّلها ثم اختر الحقول التي تريد تطبيقها على النموذج.
          </div>
          <div className="grid gap-3">
            {INSURANCE_REVIEW_FIELDS.map((field) => (
              <div key={field} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[180px_1fr_90px] md:items-center">
                <Label className="font-mono text-xs">{field}</Label>
                <Input
                  value={reviewValues[field] || ""}
                  onChange={(event) => setReviewValues((current) => ({ ...current, [field]: event.target.value }))}
                />
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={!!reviewSelected[field]}
                    onCheckedChange={(checked) => setReviewSelected((current) => ({ ...current, [field]: checked === true }))}
                  />
                  Apply
                </label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>إلغاء بدون حفظ</Button>
            <Button type="button" onClick={applyReviewedValues}>تطبيق على النموذج فقط</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
