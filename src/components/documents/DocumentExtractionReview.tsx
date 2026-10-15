import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultReviewSelection, verifiedFieldMayBeApplied } from "@/lib/documentExtraction/autofill";
import { documentIssueMessage } from "@/lib/documentExtraction/errors";
import { matchExtractedEntities } from "@/lib/documentExtraction/matching";
import { normalizeCandidate, parseMoneyMilli } from "@/lib/documentExtraction/parsers";
import { isPurchaseLineField, reviewedPurchaseLineItems } from "@/lib/documentExtraction/lineItems";
import { verifyDocumentFields } from "@/lib/documentExtraction/persistence";
import type { DocumentExtractionResult, ExtractedField } from "@/lib/documentExtraction/types";
import { DEFAULT_EXTRACTION_POLICY } from "@/lib/documentExtraction/types";

interface Props {
  result: DocumentExtractionResult | null;
  file: File | null;
  onClose: () => void;
  onApply: (values: Record<string, string | null>, result: DocumentExtractionResult) => void;
}

const FIELD_LABELS: Record<string, [string, string]> = {
  plate_number: ["رقم اللوحة", "Plate number"], plate_letters: ["حروف اللوحة", "Plate code"],
  plate_country: ["الدولة", "Country"], vin: ["رقم الهيكل", "VIN"], make: ["الماركة", "Make"],
  model: ["الموديل", "Model"], year: ["سنة الصنع", "Year"], owner_name: ["اسم المالك", "Owner"],
  owner_phone: ["هاتف المالك", "Owner phone"], insurance_company: ["شركة التأمين", "Insurer"],
  claim_number: ["رقم المطالبة", "Claim number"], accident_date: ["تاريخ الحادث", "Accident date"],
  lpo_number: ["رقم أمر الإصلاح", "Repair order number"], approved_amount: ["المبلغ المعتمد", "Approved amount"],
  supplier_name: ["اسم المورد", "Supplier"], supplier_vatin: ["الرقم الضريبي", "Supplier VATIN"],
  invoice_number: ["رقم الفاتورة", "Invoice number"], invoice_date: ["تاريخ الفاتورة", "Invoice date"],
  subtotal: ["المبلغ قبل الضريبة", "Subtotal"], vat: ["الضريبة", "VAT"], total: ["الإجمالي", "Total"],
};

function validateReviewedAmounts(fields: Record<string, ExtractedField>): boolean {
  const values = ["subtotal", "vat", "total"].map((key) => fields[key] && parseMoneyMilli(fields[key].normalizedValue));
  if (values.some((value) => value === null || value === undefined)) return true;
  const discount = fields.discount && parseMoneyMilli(fields.discount.normalizedValue) || 0;
  return Math.abs(values[0]! + values[1]! - discount - values[2]!) <= 1;
}

function fieldLabel(key: string, english: boolean): string {
  const item = key.match(/^line_item_(\d{1,2})_(name|qty|unit_price|total)$/);
  if (item) {
    const suffix = { name: ["الصنف", "Item"], qty: ["الكمية", "Qty"], unit_price: ["سعر الوحدة", "Unit price"], total: ["الإجمالي", "Line total"] }[item[2] as "name" | "qty" | "unit_price" | "total"];
    return `${english ? "Line" : "بند"} ${item[1]} · ${suffix[english ? 1 : 0]}`;
  }
  return FIELD_LABELS[key]?.[english ? 1 : 0] || key;
}

export default function DocumentExtractionReview({ result, file, onClose, onApply }: Props) {
  const { i18n } = useTranslation();
  const english = i18n.language?.startsWith("en") || false;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    setSelected(result ? defaultReviewSelection(result) : {});
    setValues(result ? Object.fromEntries(Object.values(result.fields).map((field) => [field.key,
      result.status === "verified" && field.reviewStatus === "corrected" ? field.reviewedValue || "" : field.normalizedValue,
    ])) : {});
    setActiveKey(null);
  }, [result]);

  const activeField = activeKey && result?.fields[activeKey];
  const activePage = result?.pages.find((page) => page.number === activeField?.sourcePage);

  async function handleApply() {
    if (!result?.extractionId) return;
    const reviewedFields: Record<string, ExtractedField> = {};
    const reviewedValues: Record<string, string | null> = {};
    for (const field of Object.values(result.fields)) {
      if (!selected[field.key]) { reviewedValues[field.key] = null; continue; }
      if (result.status === "verified" && !verifiedFieldMayBeApplied(field, true, values[field.key] || "")) {
        toast.error(english ? "A verified field cannot be changed or a rejected field applied." : "لا يمكن تغيير حقل معتمد أو تطبيق حقل مرفوض.");
        return;
      }
      const raw = values[field.key]?.trim() || "";
      const normalized = normalizeCandidate(field.key, raw);
      if (!normalized.valid) {
        toast.error(english ? `Invalid value: ${field.key}` : `قيمة غير صالحة: ${field.key}`);
        return;
      }
      reviewedValues[field.key] = normalized.value;
      reviewedFields[field.key] = { ...field, normalizedValue: normalized.value, validation: "valid" };
    }
    if (!validateReviewedAmounts(reviewedFields)) {
      toast.error(english ? "Invoice subtotal + VAT - discount does not equal total." : "مجموع الفاتورة والضريبة والخصم لا يطابق الإجمالي.");
      return;
    }
    if (Object.keys(result.fields).some(isPurchaseLineField) && !reviewedPurchaseLineItems(reviewedValues).valid) {
      toast.error(english ? "Select all four fields for each purchase line and check its arithmetic." : "اختر الحقول الأربعة لكل بند شراء وتحقق من الحساب.");
      return;
    }
    setApplying(true);
    try {
      const matched = await matchExtractedEntities(result.tenantId, reviewedFields);
      if (matched.issues.some((issue) => issue.severity === "error")) {
        toast.error(english ? "An existing record or identity conflict needs review before applying." : "يوجد سجل مكرر أو تعارض هوية؛ راجعه قبل التطبيق.");
        return;
      }
      if (result.status !== "verified") {
        await verifyDocumentFields({
          tenantId: result.tenantId, extractionId: result.extractionId,
          reviews: Object.values(result.fields).map((field) => ({
            key: field.key,
            status: !selected[field.key] ? "rejected" as const :
              field.validation === "valid" && reviewedValues[field.key] === field.normalizedValue ? "accepted" as const : "corrected" as const,
            value: selected[field.key] ? reviewedValues[field.key] : null,
          })),
        });
      }
      onApply(reviewedValues, { ...result, fields: reviewedFields, matches: matched.matches, status: "verified", needsReview: false });
      toast.success(english ? "Verified values applied to the form only. Save the form separately." : "تم تطبيق البيانات على النموذج فقط؛ الحفظ النهائي خطوة مستقلة.");
    } catch (error) {
      toast.error(english ? "Review could not be saved. No form values were applied." : "تعذر حفظ المراجعة. لم تُطبّق أي بيانات على النموذج.");
      // Keep the dialog open. The original extraction and file remain available.
      const safeCode = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "DOCUMENT_REVIEW_FAILED";
      console.warn("[document-extraction] review failed", safeCode);
    } finally { setApplying(false); }
  }

  return (
    <Dialog open={!!result} onOpenChange={(open) => { if (!open && !applying) onClose(); }}>
      <DialogContent className="max-w-[min(96vw,1350px)] max-h-[94vh] overflow-hidden flex flex-col" dir={english ? "ltr" : "rtl"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSearch size={18} />{english ? "Review extracted document" : "مراجعة البيانات المستخرجة"}</DialogTitle>
        </DialogHeader>
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-1">{result.documentType.replace(/_/g, " ")}</span>
              <span className="rounded bg-muted px-2 py-1">{result.method}</span>
              <span>{english ? "File retained privately; nothing has been saved to a customer, vehicle or invoice." : "الملف محفوظ بشكل خاص؛ لم يُنشأ عميل أو مركبة أو فاتورة."}</span>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="min-h-[220px] overflow-auto rounded-lg border bg-muted/30 p-2">
                {result.mimeType === "application/pdf" ? (
                  <iframe title={english ? "Document preview" : "معاينة المستند"} src={previewUrl} className="h-[60vh] min-h-[250px] w-full bg-white" />
                ) : previewUrl ? (
                  <div className="relative inline-block max-w-full">
                    <img src={previewUrl} alt={english ? "Uploaded document" : "المستند المرفوع"} className="block max-w-full h-auto" />
                    {activeField?.sourceBox && activePage?.width && activePage?.height && (
                      <div className="pointer-events-none absolute border-2 border-amber-500 bg-amber-400/25" style={{
                        left: `${100 * activeField.sourceBox.x / activePage.width}%`,
                        top: `${100 * activeField.sourceBox.y / activePage.height}%`,
                        width: `${100 * activeField.sourceBox.width / activePage.width}%`,
                        height: `${100 * activeField.sourceBox.height / activePage.height}%`,
                      }} />
                    )}
                  </div>
                ) : <p className="p-4 text-sm text-muted-foreground">{english ? "Preview unavailable" : "المعاينة غير متاحة"}</p>}
              </div>
              <div className="min-h-0 overflow-auto space-y-3 pr-1">
                {result.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className={`flex gap-2 rounded-md border p-2 text-xs ${issue.severity === "error" ? "border-destructive/40 text-destructive" : "border-amber-400/40"}`}>
                    <AlertTriangle size={15} className="shrink-0" /><span>{documentIssueMessage(issue, english)}</span>
                  </div>
                ))}
                {!!result.matches.length && <div className="rounded-md border p-2 text-xs">
                  <div className="font-semibold mb-1">{english ? "Existing records — review before creating another" : "سجلات موجودة — راجعها قبل الإنشاء"}</div>
                  {result.matches.map((match) => <div key={`${match.entity}-${match.id}`} className="py-1">{match.entity}: {match.label} · {match.reason}</div>)}
                </div>}
                {Object.values(result.fields).map((field) => (
                  <div key={field.key} onFocus={() => setActiveKey(field.key)} onMouseEnter={() => setActiveKey(field.key)} className="rounded-lg border p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <label className="flex items-center gap-2 font-semibold">
                        <Checkbox checked={!!selected[field.key]} disabled={result.status === "verified"} onCheckedChange={(checked) => setSelected((previous) => ({ ...previous, [field.key]: checked === true }))} />
                        {fieldLabel(field.key, english)}
                      </label>
                      <span className={`flex items-center gap-1 ${field.confidence >= DEFAULT_EXTRACTION_POLICY.highConfidence ? "text-emerald-700" : "text-amber-700"}`}>
                        {field.confidence >= DEFAULT_EXTRACTION_POLICY.highConfidence && <CheckCircle2 size={13} />}
                        {Math.round(field.confidence * 100)}% · {english ? "Page" : "صفحة"} {field.sourcePage}
                      </span>
                    </div>
                    <Input value={values[field.key] || ""} readOnly={result.status === "verified"} onChange={(event) => setValues((previous) => ({ ...previous, [field.key]: event.target.value }))} dir="auto" />
                    {field.rawValue !== field.normalizedValue && <p className="text-[11px] text-muted-foreground">{english ? "Original" : "الأصل"}: {field.rawValue}</p>}
                  </div>
                ))}
                {Object.keys(result.fields).length === 0 && <p className="text-sm text-muted-foreground">{english ? "No reliable fields. Attach the document, then enter the data manually." : "لا توجد حقول موثوقة. أرفق المستند ثم أدخل البيانات يدويًا."}</p>}
              </div>
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" disabled={applying} onClick={onClose}>{english ? "Cancel without applying" : "إلغاء دون تطبيق"}</Button>
              <Button type="button" disabled={applying} onClick={handleApply}>
                {applying && <Loader2 size={14} className="animate-spin" />}{Object.values(selected).some(Boolean)
                  ? english ? "Verify and fill form" : "تحقق وعبئ النموذج فقط"
                  : english ? "Attach document only" : "إرفاق المستند فقط"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
