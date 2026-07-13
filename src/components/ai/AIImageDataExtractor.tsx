import { useRef, useState } from "react";
import { Camera, FileSearch, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractFromFile, type ExtractSchema } from "@/lib/aiExtract";

type ExtractedValues = Record<string, string | number | boolean | null | undefined>;

interface AIImageDataExtractorProps {
  documentType: ExtractSchema;
  requestedFields: string[];
  currentValues?: ExtractedValues;
  onApply: (values: Record<string, string>) => void;
  label?: string;
  disabled?: boolean;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function AIImageDataExtractor({
  documentType,
  requestedFields,
  currentValues = {},
  onApply,
  label = "Extract data from image/PDF",
  disabled = false,
}: AIImageDataExtractorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  async function handleFile(file: File) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type) && !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) {
      toast.error("Unsupported file type. Use JPG, PNG, WEBP, or PDF.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("File is too large. Maximum size is 12MB.");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Extracting document data...");
    try {
      const data = await extractFromFile(file, documentType);
      const nextValues: Record<string, string> = {};
      for (const field of requestedFields) {
        nextValues[field] = normalizeValue((data as any)[field]);
      }
      setValues(nextValues);
      setSelected(Object.fromEntries(requestedFields.map((field) => [field, !!nextValues[field]])));
      setExtractedText(normalizeValue((data as any).extracted_text || (data as any).raw_text || ""));
      setSourceName(file.name);
      setOpen(true);
      toast.success("Data extracted. Review before applying.", { id: toastId });
    } catch (error: any) {
      toast.error(error?.message || "Extraction failed.", { id: toastId });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function applySelected() {
    const payload: Record<string, string> = {};
    for (const field of requestedFields) {
      if (selected[field]) payload[field] = values[field] || "";
    }
    onApply(payload);
    setOpen(false);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => cameraRef.current?.click()} className="gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          Camera
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => fileRef.current?.click()} className="gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {label}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch size={18} /> Review extracted data
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Source: <span className="font-mono" dir="ltr">{sourceName || "—"}</span>. Nothing is saved until you apply selected fields.
            </div>
            {extractedText && (
              <div className="space-y-2">
                <Label>Extracted text</Label>
                <Textarea value={extractedText} readOnly className="min-h-24 font-mono text-xs" />
              </div>
            )}
            <div className="grid gap-3">
              {requestedFields.map((field) => (
                <div key={field} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[180px_1fr_1fr_80px] md:items-center">
                  <Label className="font-mono text-xs">{field}</Label>
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">Current Value</div>
                    <Input value={normalizeValue(currentValues[field]) || "—"} readOnly />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">Extracted Value</div>
                    <Input value={values[field] || ""} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={!!selected[field]} onCheckedChange={(checked) => setSelected((current) => ({ ...current, [field]: checked === true }))} />
                    Apply
                  </label>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={applySelected}>Apply Selected Fields</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
