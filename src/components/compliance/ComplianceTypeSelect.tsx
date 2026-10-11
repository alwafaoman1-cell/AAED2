import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPLIANCE_KINDS, createComplianceType, listComplianceTypes, type ComplianceRecordType } from "@/lib/compliance/complianceService";
import { queryKeys } from "@/lib/queryKeys";

const ADD_TYPE = "__add_compliance_type__";

interface Props {
  tenantId: string;
  isAr: boolean;
  value: string;
  onValueChange: (value: string, customType?: ComplianceRecordType) => void;
  includeAll?: boolean;
  triggerClassName?: string;
}

export default function ComplianceTypeSelect({ tenantId, isAr, value, onValueChange, includeAll = false, triggerClassName }: Props) {
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: queryKeys.compliance.types(tenantId),
    queryFn: () => listComplianceTypes(tenantId),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
  const [adding, setAdding] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [newKind, setNewKind] = useState<ComplianceRecordType["kind"]>("other");
  const [saving, setSaving] = useState(false);
  const selectedCustom = value.startsWith("custom:")
    ? types.data?.find((item) => item.id === value.slice("custom:".length)) : undefined;
  const selectedFixed = COMPLIANCE_KINDS.find((item) => item.value === value);
  const selectedLabel = value === "all" && includeAll ? (isAr ? "كل الأنواع" : "All types")
    : selectedCustom ? (isAr ? selectedCustom.name_ar : selectedCustom.name_en)
      : selectedFixed ? (isAr ? selectedFixed.ar : selectedFixed.en)
        : value.startsWith("custom:") ? (isAr ? "نوع مخصص" : "Custom type") : undefined;

  async function saveType() {
    if (saving || !tenantId) return;
    setSaving(true);
    try {
      const created = await createComplianceType(tenantId, nameAr, nameEn, newKind);
      qc.setQueryData<ComplianceRecordType[]>(queryKeys.compliance.types(tenantId), (current) =>
        [...(current || []).filter((item) => item.id !== created.id), created]
          .sort((a, b) => a.name_ar.localeCompare(b.name_ar)));
      void qc.invalidateQueries({ queryKey: queryKeys.compliance.types(tenantId) });
      onValueChange(`custom:${created.id}`, created);
      setNameAr("");
      setNameEn("");
      setAdding(false);
      toast.success(isAr ? "أُضيف النوع ويمكن استخدامه الآن" : "Type added and ready to use");
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      toast.error(code === "23505"
        ? (isAr ? "هذا النوع موجود بالفعل؛ اختره من القائمة." : "This type already exists. Select it from the list.")
        : message === "COMPLIANCE_TYPE_NAMES_REQUIRED"
          ? (isAr ? "أدخل الاسمين بالعربية والإنجليزية، بحد أقصى 80 حرفًا لكل اسم." : "Enter both Arabic and English names, up to 80 characters each.")
          : (isAr ? `تعذر إضافة النوع: ${message}` : `Could not add type: ${message}`));
    } finally {
      setSaving(false);
    }
  }

  return <div className="min-w-48 space-y-2">
    <Select value={value} onValueChange={(next) => {
      if (next === ADD_TYPE) {
        setNewKind(selectedCustom?.kind || (value === "employee_permit" ? "employee_permit" : "other"));
        setAdding(true);
      }
      else onValueChange(next, next.startsWith("custom:") ? types.data?.find((item) => `custom:${item.id}` === next) : undefined);
    }}>
      <SelectTrigger className={triggerClassName}><SelectValue placeholder={isAr ? "اختر النوع" : "Select type"}>{selectedLabel}</SelectValue></SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value="all">{isAr ? "كل الأنواع" : "All types"}</SelectItem>}
        {COMPLIANCE_KINDS.map((item) => <SelectItem key={item.value} value={item.value}>{isAr ? item.ar : item.en}</SelectItem>)}
        {(types.data || []).map((item) => <SelectItem key={item.id} value={`custom:${item.id}`}>
          {isAr ? item.name_ar : item.name_en}
        </SelectItem>)}
        <SelectSeparator/>
        <SelectItem value={ADD_TYPE}>{isAr ? "+ إضافة نوع سجل أو ترخيص" : "+ Add register or licence type"}</SelectItem>
      </SelectContent>
    </Select>
    {types.isError && <p className="text-xs text-destructive">{isAr ? "تعذر جلب الأنواع المضافة. أعد المحاولة." : "Could not load custom types. Retry."}</p>}
    {adding && <div className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
      <Label>{isAr ? "تصنيف النوع" : "Type category"}</Label>
      <Select value={newKind} onValueChange={(next) => setNewKind(next as ComplianceRecordType["kind"])}>
        <SelectTrigger><SelectValue/></SelectTrigger>
        <SelectContent>
          <SelectItem value="other">{isAr ? "وثيقة شركة" : "Company document"}</SelectItem>
          <SelectItem value="employee_permit">{isAr ? "تصريح عامل" : "Worker permit"}</SelectItem>
        </SelectContent>
      </Select>
      <Label htmlFor="compliance-type-ar">{isAr ? "اسم النوع بالعربية" : "Type name in Arabic"}</Label>
      <Input id="compliance-type-ar" value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={80} dir="rtl" autoFocus/>
      <Label htmlFor="compliance-type-en">{isAr ? "اسم النوع بالإنجليزية" : "Type name in English"}</Label>
      <Input id="compliance-type-en" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={80} dir="ltr"
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveType(); } }}/>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || !nameAr.trim() || !nameEn.trim() || !tenantId} onClick={() => void saveType()}>
          {saving ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ النوع" : "Save type")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setAdding(false)}>
          {isAr ? "إلغاء" : "Cancel"}
        </Button>
      </div>
    </div>}
  </div>;
}
