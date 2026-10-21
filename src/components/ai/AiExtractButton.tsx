import { useRef, useState } from "react";
import { Sparkles, Loader2, Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { extractFromFile, type ExtractSchema } from "@/lib/aiExtract";
import { useAuth } from "@/contexts/AuthContext";
import { isDocumentEngineEnabled } from "@/lib/documentExtraction/config";
import { buildAutofillPayload } from "@/lib/documentExtraction/autofill";
import { documentErrorMessage } from "@/lib/documentExtraction/errors";
import { VEHICLE_ENTRY_AUTO_ENGINE_VERSION, type DocumentExtractionResult, type DocumentType, type ExtractionProgress } from "@/lib/documentExtraction/types";
import DocumentExtractionReview from "@/components/documents/DocumentExtractionReview";
import DocumentScanner from "@/components/documents/DocumentScanner";

export interface AppliedDocumentContext {
  fileId: string;
  extractionId: string;
  result: DocumentExtractionResult;
}

interface Props {
  schema: ExtractSchema;
  onExtracted: (data: Record<string, string>, document?: AppliedDocumentContext) => void;
  expectedDocumentType?: DocumentType | "auto";
  vehicleMakes?: string[];
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
  expectedDocumentType,
  vehicleMakes,
  label = "تعبئة تلقائية من صورة/PDF",
  hint,
  accept = "image/*,application/pdf",
  variant = "outline",
  size = "sm",
  className = "",
}: Props) {
  const { i18n } = useTranslation();
  const english = i18n.language?.startsWith("en") || false;
  const { profile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewValues, setReviewValues] = useState<Record<string, string>>({});
  const [reviewSelected, setReviewSelected] = useState<Record<string, boolean>>({});
  const [documentReview, setDocumentReview] = useState<DocumentExtractionResult | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const nativeEnabled = isDocumentEngineEnabled() && ["vehicle_customer", "insurance_claim", "expense_receipt", "purchase_invoice"].includes(schema);
  const progressText = progress && (english ? {
    validating: "Checking file", uploading: "Uploading privately", native: "Reading PDF text",
    ocr: "Reading document pages", parsing: "Identifying fields", matching: "Checking existing records",
    saving: "Saving review draft", done: "Ready to review",
  } : {
    validating: "فحص الملف", uploading: "رفع خاص للمستند", native: "قراءة نص PDF",
    ocr: "قراءة صفحات المستند", parsing: "تحديد الحقول", matching: "مطابقة السجلات الموجودة",
    saving: "حفظ مسودة المراجعة", done: "جاهز للمراجعة",
  })[progress.stage];

  async function handleFile(file: File): Promise<boolean> {
    if (file.size > 12 * 1024 * 1024) {
      toast.error("الملف كبير جداً (الحد الأقصى 12MB)");
      return false;
    }
    setBusy(true);
    const tid = toast.loading(nativeEnabled
      ? english ? "Reading and validating the document…" : "جارٍ قراءة المستند والتحقق من بياناته…"
      : "جارٍ تحليل المستند بالذكاء الاصطناعي…");
    try {
      if (nativeEnabled) {
        if (!profile?.tenant_id) throw new Error("DOCUMENT_TENANT_MISMATCH");
        const { extractAndPersistDocument } = await import("@/lib/documentExtraction/engine");
        const expectedType = expectedDocumentType === "auto" ? undefined :
          expectedDocumentType || (schema === "vehicle_customer" ? "vehicle_registration" : schema === "expense_receipt" ? "expense_receipt" : schema === "purchase_invoice" ? "purchase_invoice" : "insurance_claim");
        const result = await extractAndPersistDocument(file, {
          tenantId: profile.tenant_id, expectedType, requireWorker: expectedDocumentType === "auto",
          vehicleMakes, engineVersion: expectedDocumentType === "auto" ? VEHICLE_ENTRY_AUTO_ENGINE_VERSION : undefined,
          onProgress: setProgress,
        });
        setDocumentFile(file);
        setDocumentReview(result);
        if (!Object.keys(result.fields).length) toast.warning(english
          ? "No reliable fields. Attach the document and enter the data manually."
          : "لم تُستخرج حقول موثوقة؛ أرفق المستند وأدخل البيانات يدويًا.", { id: tid });
        else toast.success(english
          ? `${Object.keys(result.fields).length} fields ready for review. No business record was saved.`
          : `تم استخراج ${Object.keys(result.fields).length} حقل للمراجعة — لم يُحفظ أي سجل تشغيلي.`, { id: tid });
        return true;
      }
      const data = await extractFromFile(file, schema);
      const found = Object.values(data).filter((v) => v && String(v).trim()).length;
      if (found === 0) {
        toast.warning("لم يُستخرج أي بيان — جرّب صورة أوضح", { id: tid });
        return false;
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
      return true;
    } catch (e: any) {
      toast.error(nativeEnabled ? documentErrorMessage(e, english) : e?.message || "فشل الاستخراج", { id: tid });
      return false;
    } finally {
      setBusy(false);
      setProgress(null);
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
          if (f) void handleFile(f);
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
          if (f) void handleFile(f);
        }}
      />
      <div className="flex flex-wrap gap-2">
        {nativeEnabled && <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => setScannerOpen(true)} className="gap-1.5">
          <Camera size={14} className="text-primary" />{english ? "Scan with camera" : "مسح بالكاميرا"}
        </Button>}
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
          {english ? "Camera" : "كاميرا"}
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
          {english && label === "تعبئة تلقائية من صورة/PDF" ? "Auto-fill from image/PDF" : label}
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
      {nativeEnabled && busy && progressText && <p role="status" className="mt-1 text-xs text-muted-foreground">
        {progressText}{progress?.page && progress.totalPages ? ` · ${progress.page}/${progress.totalPages}` : ""}
        {typeof progress?.percent === "number" ? ` · ${progress.percent}%` : ""}
      </p>}
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
      <DocumentExtractionReview
        result={documentReview}
        file={documentFile}
        onClose={() => { setDocumentReview(null); setDocumentFile(null); }}
        onApply={(values, result) => {
          const payload = buildAutofillPayload(result, schema, values);
          onExtracted(payload, result.fileId && result.extractionId ? {
            fileId: result.fileId, extractionId: result.extractionId, result,
          } : undefined);
          setDocumentReview(null);
          setDocumentFile(null);
        }}
      />
      {nativeEnabled && <DocumentScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onExtract={handleFile} />}
    </div>
  );
}
