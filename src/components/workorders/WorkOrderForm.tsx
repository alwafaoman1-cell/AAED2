import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Link as LinkIcon, Wallet, Package, Car, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import PlateInput from "@/components/vehicles/PlateInput";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveWorkOrderToCloud, WORK_ORDER_STATUSES, NEEDED_PART_STATUS_LABELS, type WorkOrder, type ExtraExpense, type NeededPart, type NeededPartStatus, type WorkItem } from "@/lib/workOrdersStore";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { customersStore } from "@/lib/customersStore";
import CustomerPhoneLookup from "@/components/customers/CustomerPhoneLookup";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import { getExpensesForWorkOrder } from "@/lib/expensesStore";
import { getCustomerDepositBalance, getVehicleDepositBalance } from "@/lib/depositsStore";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentRole } from "@/lib/permissions";
import type { WorkOrderType } from "@/lib/workOrderType";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import ReceptionIntakePanel from "@/components/workorders/ReceptionIntakePanel";
import { toE164 } from "@/lib/phoneUtils";
import { ensureVehicleForCustomer, findExistingVehicle, normalizeVehiclePlate, normalizeVin, type VehicleIdentityMatch } from "@/lib/vehicleIdentity";
import { isUuid } from "@/lib/uuid";

import AiExtractButton from "@/components/ai/AiExtractButton";
import AiWriteButton from "@/components/ai/AiWriteButton";

const serviceTypes = ["حادث", "صيانة", "كهرباء", "برمجة", "فحص", "صيانة دورية"];
const insuranceCompanies = ["ظفار للتأمين", "الأهلية للتأمين", "ميثاق للتأمين", "الأمانة للتأمين", "آكسا الخليج", "أخرى"];
const technicians = ["عبدالله الغامدي", "يوسف القحطاني", "ماجد الدوسري", "سامي العنزي"];

const DEFAULT_BELONGINGS: { key: string; label: string }[] = [
  { key: "main_key", label: "مفتاح رئيسي" },
  { key: "spare_key", label: "مفتاح احتياطي" },
  { key: "spare_tire", label: "استبنة" },
  { key: "tool_kit", label: "عدة السيارة" },
  { key: "fire_extinguisher", label: "طفاية حريق" },
  { key: "warning_triangle", label: "مثلث تحذير" },
  { key: "trunk_cover", label: "غطاء صندوق الأمتعة" },
  { key: "manual", label: "كتيب المركبة" },
];

const empty: WorkOrder = {
  id: "",
  workOrderType: "general_customer",
  customer: "", phone: "", plate: "", vehicleType: "", model: "", year: "", vin: "",
  color: "", mileage: "",
  insurance: "-", claimNumber: "-",
  entryDate: new Date().toISOString().split("T")[0],
  technician: "",
  serviceType: "صيانة",
  status: "تحت الفحص",
  totalCost: 0, laborCost: 0, partsCost: 0,
  diagnosis: "",
  extraExpenses: [],
  depositApplied: 0,
  partsNeeded: [],
  workItems: [],
};

interface Props {
  onClose: () => void;
  initial?: WorkOrder | null;
  prefillCustomer?: string;
  prefillPhone?: string;
  prefillPlate?: string;
  prefillVehicle?: unknown;
  prefillVisit?: unknown;
}

function vehiclePrefillFields(prefillVehicle: unknown): Partial<WorkOrder> {
  const v = (prefillVehicle || {}) as Record<string, any>;
  return {
    plate: v.plate || "",
    vehicleType: v.type || v.brand || v.make || "",
    model: v.model || "",
    year: v.year ? String(v.year) : "",
    vin: v.vin || v.vin_number || "",
    color: v.color || "",
    mileage: v.mileage ? String(v.mileage) : "",
    vehicleId: isUuid(v.cloudId || v.id) ? (v.cloudId || v.id) : undefined,
    customer: v.owner || "",
    phone: v.ownerPhone || "",
  };
}

function visitPrefillFields(prefillVisit: unknown): Partial<WorkOrder> {
  const visit = (prefillVisit || {}) as Record<string, any>;
  return {
    parentWorkOrderId: visit.parentWorkOrderId,
    parentOrderNumber: visit.parentOrderNumber,
    visitNumber: visit.visitNumber,
    visitType: visit.visitType || "new_visit",
    returnReason: visit.returnReason,
  };
}

export default function WorkOrderForm({ onClose, initial, prefillCustomer, prefillPhone, prefillPlate, prefillVehicle, prefillVisit }: Props) {
  const isEdit = !!initial;
  const prefillVehicleKey = vehiclePrefillFields(prefillVehicle);
  const prefillVisitKey = visitPrefillFields(prefillVisit);
  const initialFormKey = [
    initial?.cloudId || initial?.id || "new",
    prefillCustomer || "",
    prefillPhone || "",
    prefillPlate || "",
    prefillVehicleKey.vehicleId || prefillVehicleKey.plate || "",
    prefillVisitKey.parentWorkOrderId || "",
    prefillVisitKey.visitNumber || "",
  ].join("|");
  const [form, setForm] = useState<WorkOrder>(() => ({
    ...empty,
    ...vehiclePrefillFields(prefillVehicle),
    ...visitPrefillFields(prefillVisit),
    ...(initial || {}),
    customer: initial?.customer || prefillCustomer || vehiclePrefillFields(prefillVehicle).customer || "",
    phone: initial?.phone || prefillPhone || vehiclePrefillFields(prefillVehicle).phone || "",
    plate: initial?.plate || prefillPlate || vehiclePrefillFields(prefillVehicle).plate || "",
    extraExpenses: initial?.extraExpenses || [],
    partsNeeded: initial?.partsNeeded || [],
  }));
  const [receptionFiles, setReceptionFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [claims, setClaims] = useState<Array<{
    id: string;
    claim_number: string;
    insurance_company: string | null;
    customer_id: string | null;
    vehicle_id: string | null;
  }>>([]);
  const [cloudInsuranceCompanies, setCloudInsuranceCompanies] = useState<string[]>([]);
  const [vehicleMatch, setVehicleMatch] = useState<VehicleIdentityMatch | null>(null);
  const [vehicleLookupLoading, setVehicleLookupLoading] = useState(false);
  const [useExistingVehicle, setUseExistingVehicle] = useState(false);
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const role = getCurrentRole();
  const canChooseInsurance = role === "admin" || role === "manager" || role === "supervisor";
  const isWizard = !isEdit;
  const wizardSteps = [
    { label: "العميل والمركبة ونوع الأمر", desc: "لا يتم إنشاء أمر العمل في هذه الخطوة." },
    { label: "الاستلام والصور والتوقيع", desc: "بيانات حالة المركبة عند دخولها." },
    { label: "المراجعة والحفظ النهائي", desc: "الحفظ في Supabase يتم هنا فقط." },
  ];
  const wizardVisible = (step: 0 | 1 | 2) => !isWizard || wizardStep === step;
  const goWizardNext = () => {
    if (wizardStep === 0) {
      if (!form.customer) return toast.error("أكمل بيانات العميل قبل المتابعة");
      if (!form.plate) return toast.error("أدخل رقم اللوحة قبل المتابعة");
      if (!form.vehicleType?.trim()) return toast.error("أدخل ماركة المركبة قبل المتابعة");
    }
    setWizardStep((step) => Math.min(2, step + 1) as 0 | 1 | 2);
  };

  useEffect(() => {
    setForm({
      ...empty,
      ...vehiclePrefillFields(prefillVehicle),
      ...visitPrefillFields(prefillVisit),
      ...(initial || {}),
      customer: initial?.customer || prefillCustomer || vehiclePrefillFields(prefillVehicle).customer || "",
      phone: initial?.phone || prefillPhone || vehiclePrefillFields(prefillVehicle).phone || "",
      plate: initial?.plate || prefillPlate || vehiclePrefillFields(prefillVehicle).plate || "",
      extraExpenses: initial?.extraExpenses || [],
      partsNeeded: initial?.partsNeeded || [],
    });
    // Reset only when the loaded order/prefill identity changes. Including the full
    // initial object here can wipe user-entered fields during realtime/refetch updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFormKey]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase
        .from("insurance_claims")
        .select("id,claim_number,insurance_company,customer_id,vehicle_id")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("insurance_companies")
        .select("name")
        .order("name")
        .limit(500),
    ]).then(([claimResult, companyResult]) => {
      if (cancelled) return;
      setClaims((claimResult.data || []) as typeof claims);
      setCloudInsuranceCompanies(
        (companyResult.data || [])
          .map((row: { name?: string | null }) => row.name || "")
          .filter(Boolean),
      );
    });
    return () => { cancelled = true; };
  }, []);

  const selectedType: WorkOrderType = form.claimId ? "insurance" : (form.workOrderType || "general_customer");
  const companyOptions = Array.from(new Set([...cloudInsuranceCompanies, ...insuranceCompanies]));
  const currentCustomerId = (form as WorkOrder & { customerId?: string }).customerId;
  const vehicleOwnershipConflict = !!vehicleMatch?.customer_id && !!currentCustomerId && vehicleMatch.customer_id !== currentCustomerId;

  useEffect(() => {
    let cancelled = false;
    const vin = normalizeVin(form.vin);
    const plate = normalizeVehiclePlate({ plate: form.plate });
    if (!vin && (!plate.letters || !plate.digits)) {
      setVehicleMatch(null);
      setUseExistingVehicle(false);
      return;
    }
    setVehicleLookupLoading(true);
    const timer = setTimeout(() => {
      void findExistingVehicle({
        plate: form.plate,
        vin: form.vin,
        make: form.vehicleType,
        model: form.model,
        year: form.year,
        color: form.color,
      }).then((match) => {
        if (cancelled) return;
        setVehicleMatch(match);
        setUseExistingVehicle(false);
      }).finally(() => {
        if (!cancelled) setVehicleLookupLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.plate, form.vin, form.vehicleType, form.model, form.year, form.color, currentCustomerId]);

  function selectOrderType(type: WorkOrderType) {
    if (type === "insurance" && !canChooseInsurance) {
      toast.error("إنشاء أمر تأمين يدوي متاح للمدير أو المشرف فقط");
      return;
    }
    setForm((prev) => type === "general_customer"
      ? {
          ...prev,
          workOrderType: type,
          claimId: undefined,
          insurance: "-",
          claimNumber: "-",
        }
      : { ...prev, workOrderType: type });
  }

  function selectClaim(claimId: string) {
    const claim = claims.find((item) => item.id === claimId);
    if (!claim) {
      setForm((prev) => ({ ...prev, claimId: undefined }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      workOrderType: "insurance",
      claimId: claim.id,
      claimNumber: claim.claim_number,
      insurance: claim.insurance_company || prev.insurance,
    }));
  }

  const set = <K extends keyof WorkOrder>(k: K, v: WorkOrder[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // ===== Extra expenses helpers =====
  function addExpense() {
    const item: ExtraExpense = { id: `EX-${Date.now()}`, label: "", amount: 0 };
    setForm(prev => ({ ...prev, extraExpenses: [...(prev.extraExpenses || []), item] }));
  }
  function updateExpense(id: string, patch: Partial<ExtraExpense>) {
    setForm(prev => ({
      ...prev,
      extraExpenses: (prev.extraExpenses || []).map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  }
  function removeExpense(id: string) {
    setForm(prev => ({ ...prev, extraExpenses: (prev.extraExpenses || []).filter(e => e.id !== id) }));
  }

  // ===== Needed parts helpers (طلب قطع غيار) =====
  function addNeededPart() {
    const item: NeededPart = { id: `NP-${Date.now()}`, name: "", quantity: 1, status: "pending", fulfilled: false };
    setForm(prev => ({ ...prev, partsNeeded: [...(prev.partsNeeded || []), item] }));
  }
  function updateNeededPart(id: string, patch: Partial<NeededPart>) {
    setForm(prev => ({
      ...prev,
      partsNeeded: (prev.partsNeeded || []).map(p => {
        if (p.id !== id) return p;
        const merged = { ...p, ...patch };
        if (patch.status !== undefined) {
          merged.fulfilled = patch.status === "received" || patch.status === "secured";
        }
        return merged;
      }),
    }));
  }
  function removeNeededPart(id: string) {
    setForm(prev => ({ ...prev, partsNeeded: (prev.partsNeeded || []).filter(p => p.id !== id) }));
  }

  // ===== Work items helpers (بنود الأعمال للعميل) =====
  function addWorkItem() {
    const item: WorkItem = { id: `WI-${Date.now()}`, title: "", note: "" };
    setForm(prev => ({ ...prev, workItems: [...(prev.workItems || []), item] }));
  }
  function updateWorkItem(id: string, patch: Partial<WorkItem>) {
    setForm(prev => ({
      ...prev,
      workItems: (prev.workItems || []).map(w => w.id === id ? { ...w, ...patch } : w),
    }));
  }
  function removeWorkItem(id: string) {
    setForm(prev => ({ ...prev, workItems: (prev.workItems || []).filter(w => w.id !== id) }));
  }

  // ===== Linked vouchers (read-only summary in edit mode) =====
  const linkedVouchers = useMemo(
    () => isEdit && initial ? getExpensesForWorkOrder(initial.id) : [],
    [isEdit, initial]
  );
  const linkedVouchersTotal = linkedVouchers.reduce((sum, v) => sum + (Number(v.amount) || 0), 0);

  // ===== Deposit availability =====
  const availableDeposit = useMemo(() => {
    if (!form.customer && !form.plate) return 0;
    const vehicle = form.plate ? getVehicleDepositBalance(form.plate) : 0;
    const customer = form.customer ? getCustomerDepositBalance(form.customer) : 0;
    return Math.max(vehicle, customer);
  }, [form.customer, form.plate]);

  // ===== Totals =====
  // ⚠️ totalCost المخزّن = الإجمالي الكامل قبل حسم الدفعات (الإيراد المحاسبي).
  // الدفعة المستلمة تُحفظ في depositApplied كتحصيل مستقل، والرصيد المستحق يُحسب للعرض فقط.
  const extraTotal = (form.extraExpenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const baseSubtotal = (Number(form.laborCost) || 0) + (Number(form.partsCost) || 0) + extraTotal;
  const deposit = Math.min(Number(form.depositApplied) || 0, baseSubtotal, availableDeposit + (initial?.depositApplied || 0));
  const finalTotal = baseSubtotal; // الإجمالي = القيمة الكاملة (لا يُخصم منها الدفعة)
  const balanceDue = Math.max(0, baseSubtotal - deposit); // للعرض فقط

  async function uploadReceptionPhotos(orderNumber: string) {
    if (receptionFiles.length === 0) return form.photos || [];
    const tenantId = await getCurrentTenantId();
    if (!tenantId) {
      toast.warning("Work order saved, but image upload failed because tenant was not loaded.");
      return form.photos || [];
    }
    const uploaded = [...(form.photos || [])];
    for (const file of receptionFiles) {
      const safeName = file.name.replace(/[^\w.\-\u0600-\u06FF]+/g, "_");
      const storagePath = `${tenantId}/${orderNumber}/received/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("work-order-photos")
        .upload(storagePath, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (uploadError) {
        console.warn("[WorkOrderForm] reception image upload failed", uploadError);
        toast.warning("Work order saved, but image upload failed because storage bucket is not configured.");
        continue;
      }
      const { data: signed, error: signedError } = await supabase.storage
        .from("work-order-photos")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 30);
      if (signedError || !signed?.signedUrl) {
        console.warn("[WorkOrderForm] reception image signed URL failed", signedError);
        toast.warning("Work order saved, but image upload failed because storage bucket is not configured.");
        continue;
      }
      uploaded.push({
        id: crypto.randomUUID(),
        phase: "received",
        dataUrl: signed.signedUrl,
        storagePath,
        caption: "صورة استلام المركبة",
        uploadedAt: new Date().toISOString(),
      });
    }
    return uploaded;
  }

  async function handleSubmit() {
    let customerId = (form as WorkOrder & { customerId?: string }).customerId;
    if (!form.customer) {
      toast.error("الرجاء اختيار العميل أو إنشاؤه (إلزامي)");
      return;
    }
    try {
      const savedCustomer = await customersStore.ensureCloudCustomer({
        id: customerId,
        name: form.customer,
        phone: form.phone,
      });
      customerId = savedCustomer.id;
      setForm((prev) => ({ ...prev, customer: savedCustomer.name, phone: savedCustomer.phone, ...({ customerId: savedCustomer.id } as Partial<WorkOrder>) }));
    } catch (error: any) {
      return;
    }
    if (!form.plate) {
      toast.error("الرجاء إدخال رقم اللوحة");
      return;
    }
    if (!form.vehicleId && !vehicleMatch?.id && !form.vehicleType?.trim()) {
      toast.error("أدخل ماركة المركبة قبل حفظ أمر العمل");
      return;
    }
    if (selectedType === "insurance") {
      if (!canChooseInsurance && !form.claimId) {
        toast.error("يجب ربط أمر التأمين بمطالبة موجودة");
        return;
      }
      if (!form.insurance || form.insurance === "-") {
        toast.error("الرجاء اختيار شركة التأمين");
        return;
      }
      if (!form.claimNumber || form.claimNumber === "-") {
        toast.error("الرجاء إدخال رقم المطالبة أو اختيار مطالبة موجودة");
        return;
      }
    }
    // قاعدة التسليم: لا يُسمح بإغلاق التسليم على عميل افتراضي (Insurance Pending)
    const isPending = customersStore.isInsurancePending(form.customer);
    const isDeliveryStatus = ["تم التسليم", "مغلق", "جاهز للتسليم"].includes(form.status);
    if (isPending && isDeliveryStatus) {
      toast.error("يجب تحديد العميل الحقيقي قبل تسليم المركبة (استبدل Insurance Pending)");
      return;
    }
    let resolvedVehicleId = form.vehicleId;
    if (vehicleMatch?.id && !useExistingVehicle && form.vehicleId !== vehicleMatch.id) {
      toast.error("هذه المركبة موجودة مسبقًا. اختر Use This Vehicle أو غيّر بيانات اللوحة.");
      return;
    }
    try {
      const resolved = await ensureVehicleForCustomer({
        customerId,
        vehicleId: useExistingVehicle ? vehicleMatch?.id || form.vehicleId : form.vehicleId,
        plate: form.plate,
        vin: form.vin,
        make: form.vehicleType,
        model: form.model,
        year: form.year,
        color: form.color,
        allowVinCandidate: useExistingVehicle,
      });
      resolvedVehicleId = resolved.vehicleId;
      if (resolved.ownershipConflict && !useExistingVehicle) {
        toast.error("هذه المركبة موجودة ومرتبطة بعميل آخر. استخدم المركبة الحالية أو اطلب تأكيد المدير للنقل.");
        return;
      }
      if (resolved.created) {
        void import("@/lib/vehiclesStore").then((m) => m.refreshVehiclesFromCloud()).catch(() => {});
      }
    } catch (error: any) {
      if (String(error?.message || "").includes("vin_candidate_requires_user_confirmation")) {
        toast.error("تم العثور على مركبة محتملة عبر VIN فقط. يجب تأكيد استخدام المركبة الموجودة قبل الحفظ.");
      } else {
        toast.error(error?.message || "تعذر ربط المركبة أو إنشاؤها");
      }
      return;
    }
    if (!resolvedVehicleId || !isUuid(resolvedVehicleId)) {
      toast.error("لا يمكن حفظ أمر العمل بدون vehicle_id");
      return;
    }
    const targetOrderNumber = isEdit ? form.id : nextWorkOrderNumber();
    setSaving(true);
    let receptionPhotos = form.photos || [];
    try {
      receptionPhotos = await uploadReceptionPhotos(targetOrderNumber);
    } catch (error: any) {
      console.warn("[WorkOrderForm] image upload skipped", error);
      toast.warning("Work order saved, but image upload failed because storage bucket is not configured.");
      receptionPhotos = form.photos || [];
    }
    const payload: WorkOrder = {
      ...form,
      phone: toE164(form.phone),
      photos: receptionPhotos,
      workOrderType: form.claimId ? "insurance" : selectedType,
      claimId: selectedType === "insurance" ? form.claimId : undefined,
      insurance: selectedType === "insurance" ? form.insurance : "-",
      claimNumber: selectedType === "insurance" ? form.claimNumber : "-",
      customerId,
      vehicleId: resolvedVehicleId,
      depositApplied: deposit,
      totalCost: finalTotal,
      receivedAt: form.receivedAt || new Date().toISOString(),
    };
    try {
      const saved = await saveWorkOrderToCloud({ ...payload, id: targetOrderNumber });
      toast.success(isEdit ? `تم تحديث ${saved.id}` : `تم إنشاء ${saved.id}`);
      onClose();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ أمر العمل في Supabase");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 py-2">
      {isWizard && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {wizardSteps.map((item, index) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setWizardStep(index as 0 | 1 | 2)}
                className={`rounded-lg border p-3 text-right transition ${
                  wizardStep === index
                    ? "border-primary bg-primary text-primary-foreground shadow"
                    : wizardStep > index
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-bold">{index + 1}. {item.label}</div>
                <div className={`text-[11px] mt-1 ${wizardStep === index ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{item.desc}</div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            يمكنك الرجوع والتعديل بدون فقدان البيانات. أمر العمل لا يُنشأ إلا عند الضغط على حفظ في الخطوة الأخيرة.
          </p>
        </div>
      )}

      {!isEdit && form.parentOrderNumber && (
        <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-foreground">
          طھظ… ظپطھط­ ظ‡ط°ط§ ط§ظ„ط£ظ…ط± ظƒط²ظٹط§ط±ط© ط¬ط¯ظٹط¯ط© ظ„ظ„ظ…ط±ظƒط¨ط© ط¨ط¹ط¯ ط§ظ„طھط³ظ„ظٹظ….
          <span className="font-semibold"> ط§ظ„ط£ظ…ط± ط§ظ„ط³ط§ط¨ظ‚: {form.parentOrderNumber}</span>
          {form.visitNumber ? <span> â€¢ ط±ظ‚ظ… ط§ظ„ط²ظٹط§ط±ط©: {form.visitNumber}</span> : null}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">نوع أمر العمل *</h4>
          <p className="text-[11px] text-muted-foreground">حدد المسار قبل إدخال البيانات. الأمر المرتبط بمطالبة يُصنّف تأمين تلقائيًا.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => selectOrderType("general_customer")}
            className={`rounded-xl border p-4 text-right transition-all ${
              selectedType === "general_customer"
                ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/15"
                : "border-border hover:border-emerald-500/50"
            }`}
          >
            <span className="flex items-center gap-2 font-semibold text-foreground"><Car size={18} className="text-emerald-600" /> عميل عام</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">General Customer / Cash</span>
          </button>
          <button
            type="button"
            onClick={() => selectOrderType("insurance")}
            disabled={!canChooseInsurance && !form.claimId}
            className={`rounded-xl border p-4 text-right transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedType === "insurance"
                ? "border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/15"
                : "border-border hover:border-sky-500/50"
            }`}
          >
            <span className="flex items-center gap-2 font-semibold text-foreground"><Shield size={18} className="text-sky-600" /> شركة تأمين</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">Insurance Work Order</span>
          </button>
        </div>
      </div>

      {/* تعبئة تلقائية بالذكاء الاصطناعي من صورة مَلكية/استمارة/رخصة */}
      <div className="flex items-center justify-between gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <div className="text-xs">
          <div className="font-medium text-foreground">⚡ تعبئة سريعة بالذكاء الاصطناعي</div>
          <div className="text-muted-foreground">ارفع صورة المَلكية / الاستمارة / الرخصة وسيستخرج البيانات تلقائياً</div>
        </div>
        <AiExtractButton
          schema="vehicle_customer"
          label="تعبئة من صورة"
          onExtracted={(d) => {
            setForm((prev) => ({
              ...prev,
              customer: d.customer_name || prev.customer,
              phone: d.customer_phone || prev.phone,
              plate: d.plate || prev.plate,
              vehicleType: d.make || prev.vehicleType,
              model: d.model || prev.model,
              year: d.year || prev.year,
              color: d.color || prev.color,
              vin: d.vin || prev.vin,
              mileage: d.mileage || prev.mileage,
            }));
          }}
        />
      </div>

      {/* ===== 1) العميل (بحث موحّد بالهاتف + إنشاء إلزامي) ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-2" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">العميل</h4>
        <p className="text-[10px] text-muted-foreground">
          ابحث بالهاتف أو الاسم. لو لم يوجد سيظهر زر «إضافة عميل جديد (إلزامي)».
          {selectedType === "insurance" && (
            <span className="text-amber-600"> — في حالة التأمين يمكن ترك العميل افتراضياً «Insurance Pending» وتحديده عند التسليم.</span>
          )}
        </p>
        <CustomerPhoneLookup
          customerId={(form as WorkOrder & { customerId?: string }).customerId}
          onSelect={(c) => {
            if (c) {
              setForm((prev) => ({
                ...prev,
                customer: c.name,
                phone: c.phone || prev.phone,
                ...({ customerId: c.id } as Partial<WorkOrder>),
              }));
            } else {
              setForm((prev) => ({ ...prev, customer: "", phone: "", ...({ customerId: undefined } as Partial<WorkOrder>) }));
            }
          }}
        />
        {selectedType === "insurance" && !((form as WorkOrder & { customerId?: string }).customerId) && (
          <button
            type="button"
            onClick={() => {
              const c = customersStore.getOrCreateInsurancePending(form.insurance);
              setForm((prev) => ({ ...prev, customer: c.name, phone: "", ...({ customerId: c.id } as Partial<WorkOrder>) }));
            }}
            className="text-xs px-3 py-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border border-amber-500/30"
          >
            استخدام عميل افتراضي «Insurance Pending - {form.insurance}»
          </button>
        )}
      </div>

      {/* ===== 2) بيانات المركبة (موحّدة — بدون تكرار) ===== */}
      <div className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">بيانات المركبة</h4>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">رقم اللوحة *</label>
          <PlateInput value={form.plate} onChange={(v) => {
            setUseExistingVehicle(false);
            setForm((prev) => ({ ...prev, plate: v, vehicleId: undefined }));
          }} />
        </div>
        <VehicleMakeModelPicker
          make={form.vehicleType}
          model={form.model}
          plate={form.plate}
          year={form.year}
          color={form.color}
          vin={form.vin}
          hideFields={["plate"]}
          onChange={(patch) =>
            setForm((prev) => ({
              ...prev,
              vehicleId: undefined,
              vehicleType: patch.make !== undefined ? patch.make : prev.vehicleType,
              model: patch.model !== undefined ? patch.model : prev.model,
              year: patch.year !== undefined ? patch.year : prev.year,
              color: patch.color !== undefined ? patch.color : prev.color,
              vin: patch.vin !== undefined ? patch.vin : prev.vin,
            }))
          }
        />
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">الكيلومترات</label>
          <Input value={form.mileage || ""} onChange={e => set("mileage", e.target.value)} className="bg-secondary border-border text-foreground" />
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          {vehicleLookupLoading ? (
            <p className="text-muted-foreground">جاري البحث عن المركبة داخل نفس الورشة...</p>
          ) : vehicleMatch ? (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {vehicleMatch.source === "vin" ? "تم العثور على مركبة محتملة عبر VIN" : "تم العثور على مركبة موجودة"}
                  </p>
                  {vehicleMatch.source === "vin" && (
                    <p className="rounded-md border border-warning/35 bg-warning/10 p-2 text-warning">
                      لم يتم العثور على تطابق كامل باللوحة والحروف والدولة. هذه نتيجة محتملة عبر VIN فقط، ولن يتم ربطها تلقائيًا إلا بعد الضغط على Use Existing Vehicle.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    اللوحة: {[vehicleMatch.plate_letters, vehicleMatch.plate_number].filter(Boolean).join(" ") || "—"} · VIN: {vehicleMatch.vin_number || vehicleMatch.vin || "—"}
                  </p>
                  <p className="text-muted-foreground">
                    {vehicleMatch.brand || "—"} {vehicleMatch.model || ""} {vehicleMatch.year || ""} · العميل: {vehicleMatch.customer_name || "—"}
                  </p>
                  {vehicleOwnershipConflict && (
                    <p className="rounded-md border border-warning/35 bg-warning/10 p-2 text-warning">
                      هذه المركبة موجودة ومرتبطة بعميل آخر. لن يتم تغيير مالك المركبة تلقائيًا.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={useExistingVehicle ? "default" : "outline"}
                  onClick={() => {
                    setUseExistingVehicle(true);
                    setForm((prev) => ({ ...prev, vehicleId: vehicleMatch.id }));
                  }}
                >
                  Use Existing Vehicle
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">لم يتم العثور على مركبة مطابقة. سيتم إنشاء مركبة جديدة وربطها بالعميل الصحيح عند الحفظ.</p>
          )}
        </div>
      </div>

      {/* ===== 3) بيانات الخدمة ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">بيانات الخدمة</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">تاريخ الاستلام</label>
            <Input type="date" value={form.entryDate || ""} onChange={e => set("entryDate", e.target.value)} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">نوع الخدمة *</label>
            <Select value={form.serviceType} onValueChange={v => set("serviceType", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">{serviceTypes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">الفني المسؤول</label>
            <Select value={form.technician} onValueChange={v => set("technician", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="اختر الفني" /></SelectTrigger>
              <SelectContent className="bg-card border-border">{technicians.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selectedType === "insurance" && <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">شركة التأمين</label>
            <Select value={form.insurance} onValueChange={v => set("insurance", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="-">-</SelectItem>
                {companyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          {selectedType === "insurance" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">ربط مطالبة موجودة</label>
                <Select value={form.claimId || "manual"} onValueChange={selectClaim}>
                  <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="اختر مطالبة" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="manual">رقم مطالبة يدوي — بدون إنشاء مطالبة</SelectItem>
                    {claims.map((claim) => (
                      <SelectItem key={claim.id} value={claim.id}>
                        {claim.claim_number} — {claim.insurance_company || "بدون شركة"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">رقم المطالبة *</label>
                <Input
                  value={form.claimNumber === "-" ? "" : form.claimNumber}
                  onChange={e => set("claimNumber", e.target.value)}
                  disabled={!!form.claimId}
                  className="bg-secondary border-border text-foreground"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== 4) التكاليف التقديرية ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">التكاليف التقديرية / Estimated Costs</h4>
        <p className="rounded-md border border-info/30 bg-info/5 p-2 text-xs text-muted-foreground">
          هذه القيم تقديرية وتخص الاتفاق المبدئي مع العميل. التكلفة النهائية تعتمد عند إغلاق أمر العمل من المصروفات الفعلية أو من اختيار مصدر التكلفة النهائي، ولا يتم جمع التقديري مع الفعلي.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">تكلفة العمالة التقديرية / Estimated Labour Cost (ر.ع)</label>
            <Input type="number" value={form.laborCost ?? 0} onChange={e => set("laborCost", Number(e.target.value))} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">تكلفة قطع الغيار التقديرية / Estimated Spare Parts Cost (ر.ع)</label>
            <Input type="number" value={form.partsCost ?? 0} onChange={e => set("partsCost", Number(e.target.value))} className="bg-secondary border-border text-foreground" />
          </div>
          {isEdit && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">الحالة</label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">{WORK_ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>


      {/* فحص واستلام المركبة */}
      <div className="border border-info/30 rounded-lg bg-info/5 p-3 space-y-3" style={{ display: wizardVisible(1) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Car size={14} className="text-info" /> فحص واستلام المركبة
          <span className="text-[10px] text-muted-foreground font-normal">(العداد، الوقود، المقتنيات)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">قراءة العداد (KM)</label>
            <Input
              type="number"
              value={form.odometerKm ?? ""}
              onChange={e => set("odometerKm", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="مثال: 125400"
              className="h-9 bg-card border-border text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              مستوى الوقود: <strong className="text-info">{form.fuelLevelPct ?? 50}%</strong>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.fuelLevelPct ?? 50}
              onChange={e => set("fuelLevelPct", Number(e.target.value))}
              className="w-full accent-info mt-2"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">المقتنيات داخل المركبة</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {DEFAULT_BELONGINGS.map((it) => {
              const checked = !!(form.vehicleBelongings || {})[it.key];
              return (
                <label key={it.key} className="flex items-center gap-2 text-xs bg-card border border-border rounded-md p-2 cursor-pointer hover:bg-secondary">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => set("vehicleBelongings", { ...(form.vehicleBelongings || {}), [it.key]: !!v })}
                  />
                  <span>{it.label}</span>
                </label>
              );
            })}
          </div>
          <Input
            className="mt-2 h-9 bg-card border-border text-sm"
            value={(form.vehicleBelongings?.other as string) || ""}
            onChange={(e) => set("vehicleBelongings", { ...(form.vehicleBelongings || {}), other: e.target.value })}
            placeholder="مقتنيات أخرى (اكتبها هنا)…"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">ملاحظات الاستلام</label>
          <Textarea
            value={form.receptionNotes || ""}
            onChange={e => set("receptionNotes", e.target.value)}
            rows={2}
            placeholder="حالة المركبة الظاهرية، خدوش سابقة، رائحة، إلخ…"
            className="bg-card border-border text-sm"
          />
        </div>
        <ReceptionIntakePanel
          files={receptionFiles}
          onFilesChange={setReceptionFiles}
          markers={form.receptionDamageMarkers || []}
          onMarkersChange={(markers) => set("receptionDamageMarkers", markers)}
          signatureDataUrl={form.receptionSignatureDataUrl}
          onSignatureChange={(signature) => set("receptionSignatureDataUrl", signature)}
          showDamageMap={form.serviceType === "حادث" || selectedType === "insurance"}
        />
      </div>


      <div className="border border-border rounded-lg bg-secondary/20 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span className="text-warning">●</span> مصروفات إضافية
            <span className="text-[10px] text-muted-foreground font-normal">(سحب، نقل، صبغ خارجي، خدمات...)</span>
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addExpense} className="gap-1 h-7 text-xs">
            <Plus size={12} /> إضافة مصروف
          </Button>
        </div>
        {(form.extraExpenses || []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">لا توجد مصروفات إضافية</p>
        ) : (
          <div className="space-y-2">
            {(form.extraExpenses || []).map((ex) => (
              <div key={ex.id} className="grid grid-cols-12 gap-2 items-start">
                <Input
                  value={ex.label}
                  onChange={e => updateExpense(ex.id, { label: e.target.value })}
                  placeholder="بيان المصروف"
                  className="col-span-5 h-9 bg-card border-border text-sm"
                />
                <Input
                  type="number"
                  value={ex.amount}
                  onChange={e => updateExpense(ex.id, { amount: Number(e.target.value) })}
                  placeholder="المبلغ"
                  className="col-span-3 h-9 bg-card border-border text-sm"
                />
                <Input
                  value={ex.notes || ""}
                  onChange={e => updateExpense(ex.id, { notes: e.target.value })}
                  placeholder="ملاحظات"
                  className="col-span-3 h-9 bg-card border-border text-sm"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeExpense(ex.id)}
                  className="col-span-1 h-9 w-9 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <div className="text-left text-xs text-muted-foreground pt-1">
              مجموع المصروفات الإضافية: <span className="font-bold text-warning">{extraTotal.toLocaleString()} ر.ع</span>
            </div>
          </div>
        )}
      </div>

      {/* قطع الغيار المطلوبة (طلب شراء داخلي) */}
      <div className="border border-info/30 rounded-lg bg-info/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Package size={14} className="text-info" /> قطع الغيار المطلوبة
            <span className="text-[10px] text-muted-foreground font-normal">(طلب شراء داخلي يمكن طباعته)</span>
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addNeededPart} className="gap-1 h-7 text-xs">
            <Plus size={12} /> إضافة قطعة
          </Button>
        </div>
        {(form.partsNeeded || []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">لا توجد قطع غيار مطلوبة</p>
        ) : (
          <div className="space-y-2">
            {(form.partsNeeded || []).map((np) => {
              const status: NeededPartStatus = np.status || (np.fulfilled ? "received" : "pending");
              const done = status === "received" || status === "secured";
              return (
                <div key={np.id} className="grid grid-cols-12 gap-2 items-start">
                  <Input
                    value={np.name}
                    onChange={e => updateNeededPart(np.id, { name: e.target.value })}
                    placeholder="اسم القطعة (مثال: مصباح أمامي يمين)"
                    className={`col-span-4 h-9 bg-card border-border text-sm ${done ? "line-through text-muted-foreground" : ""}`}
                  />
                  <Input
                    type="number"
                    min={1}
                    value={np.quantity}
                    onChange={e => updateNeededPart(np.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    placeholder="الكمية"
                    className="col-span-1 h-9 bg-card border-border text-sm text-center"
                  />
                  <Select
                    value={status}
                    onValueChange={(v) => updateNeededPart(np.id, { status: v as NeededPartStatus })}
                  >
                    <SelectTrigger className="col-span-3 h-9 bg-card border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {(Object.keys(NEEDED_PART_STATUS_LABELS) as NeededPartStatus[]).map(s => (
                        <SelectItem key={s} value={s} className="text-xs">{NEEDED_PART_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={np.notes || ""}
                    onChange={e => updateNeededPart(np.id, { notes: e.target.value })}
                    placeholder="ملاحظات"
                    className="col-span-3 h-9 bg-card border-border text-sm"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeNeededPart(np.id)}
                    className="col-span-1 h-9 w-9 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
            <div className="text-left text-xs text-muted-foreground pt-1">
              إجمالي القطع المطلوبة: <span className="font-bold text-info">{(form.partsNeeded || []).reduce((s, p) => s + (p.quantity || 0), 0)}</span>
              {" "}— تم التأمين/الاستلام: <span className="font-bold text-success">{(form.partsNeeded || []).filter(p => (p.status ? (p.status === "received" || p.status === "secured") : p.fulfilled)).length}</span>
              {" / "} <span>{(form.partsNeeded || []).length}</span>
            </div>
          </div>
        )}
      </div>

      {/* سندات صرف خارجية مرتبطة (للقراءة) */}
      {isEdit && linkedVouchers.length > 0 && (
        <div className="border border-info/30 rounded-lg bg-info/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
            <LinkIcon size={14} className="text-info" /> سندات صرف مرتبطة بهذا الأمر
            <span className="text-[10px] text-muted-foreground font-normal">({linkedVouchers.length})</span>
          </h4>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {linkedVouchers.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-xs bg-card rounded px-2 py-1.5 border border-border/50">
                <div className="flex flex-col">
                  <span className="font-mono text-info">{v.voucherNumber}</span>
                  <span className="text-muted-foreground text-[10px]">{v.beneficiary || v.description || v.categoryName}</span>
                </div>
                <span className="font-semibold text-foreground">{Number(v.amount).toLocaleString()} ر.ع</span>
              </div>
            ))}
          </div>
          <div className="text-left text-xs text-muted-foreground pt-2 border-t border-border/50 mt-2">
            مجموع سندات الصرف الخارجية: <span className="font-bold text-info">{linkedVouchersTotal.toLocaleString()} ر.ع</span>
            <span className="block text-[10px] mt-0.5">* تُستخدم في احتساب صافي ربح أمر العمل وليس في فاتورة العميل</span>
          </div>
        </div>
      )}

      {/* الدفعات */}
      {(availableDeposit > 0 || (initial?.depositApplied || 0) > 0) && (
        <div className="border border-success/30 rounded-lg bg-success/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
            <Wallet size={14} className="text-success" /> رصيد الدفعات المتاح للعميل/السيارة
          </h4>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="text-xs">
              <p className="text-muted-foreground">الرصيد المتاح</p>
              <p className="text-lg font-bold text-success">{availableDeposit.toLocaleString()} ر.ع</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">خصم من الفاتورة</label>
              <Input
                type="number"
                value={form.depositApplied ?? 0}
                onChange={e => set("depositApplied", Number(e.target.value))}
                max={availableDeposit + (initial?.depositApplied || 0)}
                className="h-9 bg-card border-border text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* ملخص التكلفة */}
      <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-3 space-y-1 text-sm" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex justify-between text-muted-foreground"><span>تكلفة العمالة التقديرية</span><span>{(Number(form.laborCost) || 0).toLocaleString()} ر.ع</span></div>
        <div className="flex justify-between text-muted-foreground"><span>تكلفة قطع الغيار التقديرية</span><span>{(Number(form.partsCost) || 0).toLocaleString()} ر.ع</span></div>
        {extraTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>مصروفات إضافية</span><span>{extraTotal.toLocaleString()} ر.ع</span></div>}
        <div className="flex justify-between text-foreground font-bold border-t border-border pt-1">
          <span>إجمالي الفاتورة</span>
          <span className="text-primary">{finalTotal.toLocaleString()} ر.ع</span>
        </div>
        {deposit > 0 && (
          <>
            <div className="flex justify-between text-success"><span>دفعة مستلمة (دخل)</span><span>+{deposit.toLocaleString()} ر.ع</span></div>
            <div className="flex justify-between text-warning font-semibold"><span>الرصيد المستحق</span><span>{balanceDue.toLocaleString()} ر.ع</span></div>
          </>
        )}
      </div>

      {/* ===== بنود الأعمال المطلوبة (تظهر للعميل في رابط التوقيع) ===== */}
      <div className="border-2 border-primary/20 rounded-xl bg-card p-3 space-y-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-foreground">📋 بنود الأعمال المطلوبة</div>
            <div className="text-[11px] text-muted-foreground">سيراها العميل عند توقيع أمر العمل إلكترونياً</div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addWorkItem} className="h-8 gap-1">
            <Plus size={14} /> إضافة بند
          </Button>
        </div>
        {(form.workItems || []).length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground py-3 border border-dashed border-border rounded-lg">
            لا توجد بنود — اضغط «إضافة بند» لإدراج العمل المطلوب
          </div>
        ) : (
          <div className="space-y-2">
            {(form.workItems || []).map((w, idx) => (
              <div key={w.id} className="flex gap-2 items-start bg-secondary/40 border border-border rounded-lg p-2">
                <span className="text-xs font-bold text-muted-foreground bg-background rounded w-6 h-6 flex items-center justify-center shrink-0 mt-1">{idx + 1}</span>
                <div className="flex-1 space-y-1.5">
                  <Input
                    value={w.title}
                    onChange={e => updateWorkItem(w.id, { title: e.target.value })}
                    placeholder="عنوان البند (مثال: تغيير زيت المحرك)"
                    className="h-8 text-sm bg-background"
                  />
                  <Input
                    value={w.note || ""}
                    onChange={e => updateWorkItem(w.id, { note: e.target.value })}
                    placeholder="ملاحظة (اختياري)"
                    className="h-8 text-xs bg-background"
                  />
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={() => removeWorkItem(w.id)} className="h-8 w-8 text-destructive shrink-0">
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>


      <div className="space-y-1.5" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">ملاحظات / تشخيص</label>
          <AiWriteButton
            value={form.diagnosis || ""}
            onChange={(t) => set("diagnosis", t)}
            context={`أمر عمل لسيارة ${form.vehicleType || ""} ${form.model || ""} لوحة ${form.plate || ""} - خدمة: ${form.serviceType || ""}`}
            placeholder="مثال: اكتب تشخيصاً أولياً لمشكلة في المحرك"
          />
        </div>
        <textarea value={form.diagnosis || ""} onChange={e => set("diagnosis", e.target.value)} className="w-full rounded-lg bg-secondary border border-border text-foreground p-3 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>
      <div className="flex gap-3 pt-2">
        {isWizard && wizardStep > 0 && (
          <Button type="button" variant="outline" onClick={() => setWizardStep((step) => Math.max(0, step - 1) as 0 | 1 | 2)}>
            السابق
          </Button>
        )}
        {isWizard && wizardStep < 2 ? (
          <Button type="button" onClick={goWizardNext} className="gradient-gold text-primary-foreground flex-1 hover:opacity-90">
            التالي
          </Button>
        ) : (
          <Button onClick={() => void handleSubmit()} disabled={saving} className="gradient-gold text-primary-foreground flex-1 hover:opacity-90">
            {saving ? "جارٍ الحفظ والرفع…" : isEdit ? "حفظ التعديلات" : "حفظ أمر العمل"}
          </Button>
        )}
        <Button onClick={onClose} variant="outline" className="border-border text-foreground hover:bg-secondary">إلغاء</Button>
      </div>
    </div>
  );
}
