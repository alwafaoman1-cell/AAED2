import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ElectronicSignaturePad from "@/components/ElectronicSignaturePad";
import {
  TECHNICAL_GARAGE_NAME, technicalFieldMaxLength, type VehicleTechnicalDeclarationForm,
} from "@/lib/vehicleTechnicalDeclaration";
import {
  technicalDeclarationFooterFields, technicalDeclarationIdentityFields, technicalDeclarationSections,
  type TechnicalDeclarationField,
} from "@/lib/vehicleTechnicalDeclarationLocale";

export interface VehicleTechnicalDeclarationFieldsProps {
  value: VehicleTechnicalDeclarationForm;
  onChange: (value: VehicleTechnicalDeclarationForm) => void;
  disabled?: boolean;
  /** Lock only claim number, registration and make/model; condition answers remain editable. */
  identityReadOnly?: boolean;
  reportAuthorName?: string;
  technicianName?: string;
}

/** Controlled declaration inputs only. The parent owns loading, dirty state,
 * permission checks, revision/CAS saves, and all preview/print/download actions. */
export function VehicleTechnicalDeclarationFields({
  value, onChange, disabled = false, identityReadOnly = false, reportAuthorName = "", technicianName = "",
}: VehicleTechnicalDeclarationFieldsProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const label = (ar: string, en: string) => isAr ? ar : en;
  const prefix = useId();

  function setField(key: keyof VehicleTechnicalDeclarationForm, next: string | boolean) {
    if (disabled) return;
    if (identityReadOnly && technicalDeclarationIdentityFields.some((field) => field.key === key && field.kind === "text")) return;
    onChange({
      ...value,
      [key]: next,
      ...(key === "authorized_person" && next !== value.authorized_person ? { signature_data_url: "" } : {}),
    });
  }

  function setSignerRole(role: VehicleTechnicalDeclarationForm["signer_role"]) {
    if (disabled || value.signer_role === role) return;
    onChange({
      ...value,
      signer_role: role,
      authorized_person: role === "report_author" ? reportAuthorName : role === "technician" ? technicianName : "",
      signature_data_url: "",
    });
  }

  function renderField(field: TechnicalDeclarationField) {
    const title = label(field.ar, field.en);
    const fieldId = `${prefix}-${field.key}`;
    const raw = value[field.key];
    const identity = technicalDeclarationIdentityFields.some((item) => item.key === field.key && item.kind === "text");
    if (field.kind === "checkbox") {
      return <label key={field.key} htmlFor={fieldId} className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
        <input id={fieldId} type="checkbox" checked={raw === true} disabled={disabled}
          onChange={(event) => setField(field.key, event.target.checked)} className="h-4 w-4 accent-success" />{title}
      </label>;
    }
    let options: Array<{ value: string; text: string }> = [];
    if (field.kind === "choice") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "yes", text: label("نعم", "Yes") }, { value: "no", text: label("لا", "No") },
    ];
    if (field.kind === "oil") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "ok", text: "OK" }, { value: "no", text: label("غير سليم", "No") },
    ];
    if (field.kind === "chassis") options = [
      { value: "", text: label("غير محدد", "Not selected") },
      { value: "ok", text: "OK" }, { value: "deformed", text: label("متشوه", "Deformed") },
    ];
    return <div key={field.key} className="space-y-1.5 min-w-0">
      <label htmlFor={options.length ? undefined : fieldId} id={options.length ? fieldId : undefined} className="text-sm font-medium">{title}</label>
      {options.length > 0 ? <div role="group" aria-labelledby={fieldId} className="flex flex-wrap gap-2">
        {options.map((option) => <Button key={option.value} type="button" size="sm" variant="outline"
          aria-pressed={String(raw) === option.value} disabled={disabled}
          className={String(raw) === option.value ? "border-success bg-success/10 text-success hover:bg-success/15" : ""}
          onClick={() => setField(field.key, option.value)}>
          {String(raw) === option.value && option.value !== "" && <Check size={14} className="me-1" />}{option.text}
        </Button>)}
      </div> : field.kind === "textarea" ?
        <Textarea id={fieldId} value={String(raw)} maxLength={technicalFieldMaxLength(field.key)} rows={3} disabled={disabled}
          onChange={(event) => setField(field.key, event.target.value)} /> :
        <Input id={fieldId} type={field.kind === "date" ? "date" : "text"} dir={field.kind === "date" ? "ltr" : undefined}
          value={String(raw)} maxLength={technicalFieldMaxLength(field.key)} disabled={disabled} readOnly={identity && identityReadOnly}
          className={identity ? "font-semibold text-destructive" : undefined}
          onChange={(event) => setField(field.key, event.target.value)} />}
    </div>;
  }

  return <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
    <Card className="p-4 md:p-5 space-y-4">
      <h2 className="font-semibold">{label("بيانات المركبة والمطالبة", "Vehicle & Claim Details")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{technicalDeclarationIdentityFields.map(renderField)}</div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      {technicalDeclarationSections.map((section) => <Card key={section.number} className="p-4 md:p-5 space-y-4">
        <h2 className="font-semibold">{section.number}. {label(section.ar, section.en)}</h2>
        <div className="grid gap-3 sm:grid-cols-2">{section.fields.map(renderField)}</div>
      </Card>)}
    </div>
    <Card className="p-4 md:p-5 space-y-4">
      <h2 className="font-semibold">{label("بيانات الاعتماد والطباعة", "Workshop & Print Details")}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5"><label htmlFor={`${prefix}-garage-name`} className="text-sm font-medium">{label("اسم الورشة", "Garage Name")}</label>
          <Input id={`${prefix}-garage-name`} value={TECHNICAL_GARAGE_NAME} readOnly disabled={disabled} className="bg-muted font-semibold" /></div>
        {technicalDeclarationFooterFields.map(renderField)}
      </div>
      <div className="space-y-2">
        <p id={`${prefix}-signer-role`} className="text-sm font-medium">{label("صفة الموقّع", "Signer role")}</p>
        <div role="group" aria-labelledby={`${prefix}-signer-role`} className="flex flex-wrap gap-2">
          {([
            ["report_author", label("منشئ التقرير", "Report author")],
            ["technician", label("الفني", "Technician")],
            ["", label("غير محدد", "Not selected")],
          ] as const).map(([role, title]) => <Button key={role} type="button" size="sm" variant="outline"
            aria-pressed={value.signer_role === role} disabled={disabled}
            className={value.signer_role === role ? "border-success bg-success/10 text-success hover:bg-success/15" : ""}
            onClick={() => setSignerRole(role)}>{value.signer_role === role && role && <Check size={14} className="me-1" />}{title}</Button>)}
        </div>
      </div>
      <ElectronicSignaturePad value={value.signature_data_url} compactOutput disabled={disabled}
        title={label("توقيع الموقّع على التقرير", "Report signer's signature")}
        description={label("يوقّع الشخص المذكور أعلاه بنفسه؛ لا يُنشئ النظام توقيعًا تلقائيًا.", "The named person signs here; the system never creates a signature automatically.")}
        clearLabel={label("مسح التوقيع", "Clear signature")}
        savedLabel={label("التوقيع جاهز للحفظ مع النموذج.", "Signature is ready to save with the form.")}
        emptyLabel={label("يمكن تركه فارغًا للتوقيع على الورقة المطبوعة.", "Leave blank if the paper will be signed by hand.")}
        onChange={(next) => {
          if (disabled) return;
          if (next.length > technicalFieldMaxLength("signature_data_url")) {
            setField("signature_data_url", "");
            toast.error(label("التوقيع كبير جدًا؛ امسحه وأعده بخط أبسط.", "Signature image is too large; clear and redraw it more simply."));
            return;
          }
          setField("signature_data_url", next);
        }} />
    </Card>
  </div>;
}

export default VehicleTechnicalDeclarationFields;
