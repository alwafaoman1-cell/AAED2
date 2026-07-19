import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Link as LinkIcon, Wallet, Package, Car, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import PlateInput from "@/components/vehicles/PlateInput";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWorkOrders, saveWorkOrderToCloud, WORK_ORDER_STATUSES, NEEDED_PART_STATUS_LABELS, type WorkOrder, type ExtraExpense, type NeededPart, type NeededPartStatus, type WorkItem } from "@/lib/workOrdersStore";
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

function normalizeWorkOrderNumberInput(value: string) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}
const serviceTypes = ["ط­ط§ط¯ط«", "طµظٹط§ظ†ط©", "ظƒظ‡ط±ط¨ط§ط،", "ط¨ط±ظ…ط¬ط©", "ظپط­طµ", "طµظٹط§ظ†ط© ط¯ظˆط±ظٹط©"];
const insuranceCompanies = ["ط¸ظپط§ط± ظ„ظ„طھط£ظ…ظٹظ†", "ط§ظ„ط£ظ‡ظ„ظٹط© ظ„ظ„طھط£ظ…ظٹظ†", "ظ…ظٹط«ط§ظ‚ ظ„ظ„طھط£ظ…ظٹظ†", "ط§ظ„ط£ظ…ط§ظ†ط© ظ„ظ„طھط£ظ…ظٹظ†", "ط¢ظƒط³ط§ ط§ظ„ط®ظ„ظٹط¬", "ط£ط®ط±ظ‰"];
const technicians = ["ط¹ط¨ط¯ط§ظ„ظ„ظ‡ ط§ظ„ط؛ط§ظ…ط¯ظٹ", "ظٹظˆط³ظپ ط§ظ„ظ‚ط­ط·ط§ظ†ظٹ", "ظ…ط§ط¬ط¯ ط§ظ„ط¯ظˆط³ط±ظٹ", "ط³ط§ظ…ظٹ ط§ظ„ط¹ظ†ط²ظٹ"];

// أدخل ماركة المركبة قبل المتابعة
// أدخل ماركة المركبة قبل حفظ أمر العمل
const DEFAULT_BELONGINGS: { key: string; label: string }[] = [
  { key: "main_key", label: "ظ…ظپطھط§ط­ ط±ط¦ظٹط³ظٹ" },
  { key: "spare_key", label: "ظ…ظپطھط§ط­ ط§ط­طھظٹط§ط·ظٹ" },
  { key: "spare_tire", label: "ط§ط³طھط¨ظ†ط©" },
  { key: "tool_kit", label: "ط¹ط¯ط© ط§ظ„ط³ظٹط§ط±ط©" },
  { key: "fire_extinguisher", label: "ط·ظپط§ظٹط© ط­ط±ظٹظ‚" },
  { key: "warning_triangle", label: "ظ…ط«ظ„ط« طھط­ط°ظٹط±" },
  { key: "trunk_cover", label: "ط؛ط·ط§ط، طµظ†ط¯ظˆظ‚ ط§ظ„ط£ظ…طھط¹ط©" },
  { key: "manual", label: "ظƒطھظٹط¨ ط§ظ„ظ…ط±ظƒط¨ط©" },
];

const empty: WorkOrder = {
  id: "",
  workOrderType: "general_customer",
  customer: "", phone: "", plate: "", vehicleType: "", model: "", year: "", vin: "",
  color: "", mileage: "",
  insurance: "-", claimNumber: "-",
  entryDate: new Date().toISOString().split("T")[0],
  technician: "",
  serviceType: "طµظٹط§ظ†ط©",
  status: "طھط­طھ ط§ظ„ظپط­طµ",
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
    { label: "ط§ظ„ط¹ظ…ظٹظ„ ظˆط§ظ„ظ…ط±ظƒط¨ط© ظˆظ†ظˆط¹ ط§ظ„ط£ظ…ط±", desc: "ظ„ط§ ظٹطھظ… ط¥ظ†ط´ط§ط، ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظپظٹ ظ‡ط°ظ‡ ط§ظ„ط®ط·ظˆط©." },
    { label: "ط§ظ„ط§ط³طھظ„ط§ظ… ظˆط§ظ„طµظˆط± ظˆط§ظ„طھظˆظ‚ظٹط¹", desc: "ط¨ظٹط§ظ†ط§طھ ط­ط§ظ„ط© ط§ظ„ظ…ط±ظƒط¨ط© ط¹ظ†ط¯ ط¯ط®ظˆظ„ظ‡ط§." },
    { label: "ط§ظ„ظ…ط±ط§ط¬ط¹ط© ظˆط§ظ„ط­ظپط¸ ط§ظ„ظ†ظ‡ط§ط¦ظٹ", desc: "ط§ظ„ط­ظپط¸ ظپظٹ Supabase ظٹطھظ… ظ‡ظ†ط§ ظپظ‚ط·." },
  ];
  const wizardVisible = (step: 0 | 1 | 2) => !isWizard || wizardStep === step;
  const goWizardNext = () => {
    if (wizardStep === 0) {
      if (!form.customer) return toast.error("ط£ظƒظ…ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„ ظ‚ط¨ظ„ ط§ظ„ظ…طھط§ط¨ط¹ط©");
      if (!form.plate) return toast.error("ط£ط¯ط®ظ„ ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط© ظ‚ط¨ظ„ ط§ظ„ظ…طھط§ط¨ط¹ط©");
      if (!form.vehicleType?.trim()) return toast.error("ط£ط¯ط®ظ„ ظ…ط§ط±ظƒط© ط§ظ„ظ…ط±ظƒط¨ط© ظ‚ط¨ظ„ ط§ظ„ظ…طھط§ط¨ط¹ط©");
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
      toast.error("ط¥ظ†ط´ط§ط، ط£ظ…ط± طھط£ظ…ظٹظ† ظٹط¯ظˆظٹ ظ…طھط§ط­ ظ„ظ„ظ…ط¯ظٹط± ط£ظˆ ط§ظ„ظ…ط´ط±ظپ ظپظ‚ط·");
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

  // ===== Needed parts helpers (ط·ظ„ط¨ ظ‚ط·ط¹ ط؛ظٹط§ط±) =====
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

  // ===== Work items helpers (ط¨ظ†ظˆط¯ ط§ظ„ط£ط¹ظ…ط§ظ„ ظ„ظ„ط¹ظ…ظٹظ„) =====
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
  // âڑ ï¸ڈ totalCost ط§ظ„ظ…ط®ط²ظ‘ظ† = ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظƒط§ظ…ظ„ ظ‚ط¨ظ„ ط­ط³ظ… ط§ظ„ط¯ظپط¹ط§طھ (ط§ظ„ط¥ظٹط±ط§ط¯ ط§ظ„ظ…ط­ط§ط³ط¨ظٹ).
  // ط§ظ„ط¯ظپط¹ط© ط§ظ„ظ…ط³طھظ„ظ…ط© طھظڈط­ظپط¸ ظپظٹ depositApplied ظƒطھط­طµظٹظ„ ظ…ط³طھظ‚ظ„طŒ ظˆط§ظ„ط±طµظٹط¯ ط§ظ„ظ…ط³طھط­ظ‚ ظٹظڈط­ط³ط¨ ظ„ظ„ط¹ط±ط¶ ظپظ‚ط·.
  const extraTotal = (form.extraExpenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const baseSubtotal = (Number(form.laborCost) || 0) + (Number(form.partsCost) || 0) + extraTotal;
  const deposit = Math.min(Number(form.depositApplied) || 0, baseSubtotal, availableDeposit + (initial?.depositApplied || 0));
  const finalTotal = baseSubtotal; // ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ = ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظƒط§ظ…ظ„ط© (ظ„ط§ ظٹظڈط®طµظ… ظ…ظ†ظ‡ط§ ط§ظ„ط¯ظپط¹ط©)
  const balanceDue = Math.max(0, baseSubtotal - deposit); // ظ„ظ„ط¹ط±ط¶ ظپظ‚ط·

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
        caption: "طµظˆط±ط© ط§ط³طھظ„ط§ظ… ط§ظ„ظ…ط±ظƒط¨ط©",
        uploadedAt: new Date().toISOString(),
      });
    }
    return uploaded;
  }

  async function handleSubmit() {
    let customerId = (form as WorkOrder & { customerId?: string }).customerId;
    if (!form.customer) {
      toast.error("ط§ظ„ط±ط¬ط§ط، ط§ط®طھظٹط§ط± ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ط¥ظ†ط´ط§ط¤ظ‡ (ط¥ظ„ط²ط§ظ…ظٹ)");
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
      toast.error("ط§ظ„ط±ط¬ط§ط، ط¥ط¯ط®ط§ظ„ ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©");
      return;
    }
    if (!form.vehicleId && !vehicleMatch?.id && !form.vehicleType?.trim()) {
      toast.error("ط£ط¯ط®ظ„ ظ…ط§ط±ظƒط© ط§ظ„ظ…ط±ظƒط¨ط© ظ‚ط¨ظ„ ط­ظپط¸ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„");
      return;
    }
    if (selectedType === "insurance") {
      if (!canChooseInsurance && !form.claimId) {
        toast.error("ظٹط¬ط¨ ط±ط¨ط· ط£ظ…ط± ط§ظ„طھط£ظ…ظٹظ† ط¨ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ط©");
        return;
      }
      if (!form.insurance || form.insurance === "-") {
        toast.error("ط§ظ„ط±ط¬ط§ط، ط§ط®طھظٹط§ط± ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†");
        return;
      }
      if (!form.claimNumber || form.claimNumber === "-") {
        toast.error("ط§ظ„ط±ط¬ط§ط، ط¥ط¯ط®ط§ظ„ ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ط£ظˆ ط§ط®طھظٹط§ط± ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ط©");
        return;
      }
    }
    // ظ‚ط§ط¹ط¯ط© ط§ظ„طھط³ظ„ظٹظ…: ظ„ط§ ظٹظڈط³ظ…ط­ ط¨ط¥ط؛ظ„ط§ظ‚ ط§ظ„طھط³ظ„ظٹظ… ط¹ظ„ظ‰ ط¹ظ…ظٹظ„ ط§ظپطھط±ط§ط¶ظٹ (Insurance Pending)
    const isPending = customersStore.isInsurancePending(form.customer);
    const isDeliveryStatus = ["طھظ… ط§ظ„طھط³ظ„ظٹظ…", "ظ…ط؛ظ„ظ‚", "ط¬ط§ظ‡ط² ظ„ظ„طھط³ظ„ظٹظ…"].includes(form.status);
    if (isPending && isDeliveryStatus) {
      toast.error("ظٹط¬ط¨ طھط­ط¯ظٹط¯ ط§ظ„ط¹ظ…ظٹظ„ ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظ‚ط¨ظ„ طھط³ظ„ظٹظ… ط§ظ„ظ…ط±ظƒط¨ط© (ط§ط³طھط¨ط¯ظ„ Insurance Pending)");
      return;
    }
    let resolvedVehicleId = form.vehicleId;
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
        allowDifferentCustomer: true,
      });
      resolvedVehicleId = resolved.vehicleId;
      if (resolved.ownershipConflict && vehicleMatch?.customer_id) {
        setForm((prev) => ({
          ...prev,
          vehicleId: resolved.vehicleId,
          vehicleOwnerCustomerId: vehicleMatch.customer_id || prev.vehicleOwnerCustomerId,
          receivedFromCustomerId: customerId || prev.receivedFromCustomerId,
          customerRelationshipToVehicle: prev.customerRelationshipToVehicle || 'delivered_by',
        }));
      }
      if (resolved.created) {
        void import("@/lib/vehiclesStore").then((m) => m.refreshVehiclesFromCloud()).catch(() => {});
      }
    } catch (error: any) {
      if (String(error?.message || "").includes("vin_candidate_requires_user_confirmation")) {
        toast.error("طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط±ظƒط¨ط© ظ…ط­طھظ…ظ„ط© ط¹ط¨ط± VIN ظپظ‚ط·. ظٹط¬ط¨ طھط£ظƒظٹط¯ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ظ…ط±ظƒط¨ط© ط§ظ„ظ…ظˆط¬ظˆط¯ط© ظ‚ط¨ظ„ ط§ظ„ط­ظپط¸.");
      } else {
        toast.error(error?.message || "طھط¹ط°ط± ط±ط¨ط· ط§ظ„ظ…ط±ظƒط¨ط© ط£ظˆ ط¥ظ†ط´ط§ط¤ظ‡ط§");
      }
      return;
    }
    if (!resolvedVehicleId || !isUuid(resolvedVehicleId)) {
      toast.error("ظ„ط§ ظٹظ…ظƒظ† ط­ظپط¸ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ط¨ط¯ظˆظ† vehicle_id");
      return;
    }
    const targetOrderNumber = isEdit ? normalizeWorkOrderNumberInput(form.id || form.displayNumber || initial?.id || "") : nextWorkOrderNumber();
    if (isEdit) {
      if (!/^WO-\d{4}-\d+$/i.test(targetOrderNumber)) {
        toast.error("ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط¨طµظٹط؛ط© WO-YYYY-0001");
        return;
      }
      const localDuplicate = getWorkOrders({ includeArchived: true }).find((order) => {
        const sameNumber = [order.id, order.displayNumber].filter(Boolean).some((value) => String(value).toLowerCase() === targetOrderNumber.toLowerCase());
        const sameRecord = order.cloudId && initial?.cloudId ? order.cloudId === initial.cloudId : order.id === initial?.id;
        return sameNumber && !sameRecord;
      });
      if (localDuplicate) {
        toast.error(`ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ${targetOrderNumber} ظ…ط³طھط®ط¯ظ… ظ…ط³ط¨ظ‚ظ‹ط§`);
        return;
      }
      const tenantId = await getCurrentTenantId();
      if (tenantId && initial?.cloudId) {
        const { data: duplicate, error: duplicateError } = await supabase
          .from("job_orders")
          .select("id,order_number")
          .eq("tenant_id", tenantId)
          .ilike("order_number", targetOrderNumber)
          .neq("id", initial.cloudId)
          .maybeSingle();
        if (duplicateError) {
          toast.error(duplicateError.message || "طھط¹ط°ط± ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„");
          return;
        }
        if ((duplicate as any)?.id) {
          toast.error(`ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ${targetOrderNumber} ظ…ط³طھط®ط¯ظ… ظ…ط³ط¨ظ‚ظ‹ط§`);
          return;
        }
      }
    }
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
      toast.success(isEdit ? `طھظ… طھط­ط¯ظٹط« ${saved.id}` : `طھظ… ط¥ظ†ط´ط§ط، ${saved.id}`);
      onClose();
    } catch (error: any) {
      toast.error(error?.message || "طھط¹ط°ط± ط­ظپط¸ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظپظٹ Supabase");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 py-2">
      {isEdit && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
          <label className="text-xs font-semibold text-foreground">ط±ظ‚ظ… ط£ظ…ط± ط§ظ„ط¹ظ…ظ„</label>
          <Input
            dir="ltr"
            value={form.id || form.displayNumber || ""}
            onChange={(event) => {
              const next = normalizeWorkOrderNumberInput(event.target.value);
              setForm((prev) => ({ ...prev, id: next, displayNumber: next }));
            }}
            placeholder="WO-2026-0001"
            className="mt-1 bg-card border-border font-mono text-left"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            ظٹظ…ظƒظ† طھط¹ط¯ظٹظ„ ط±ظ‚ظ… ط§ظ„ط¹ط±ط¶ ظپظ‚ط·. ط§ظ„ط¹ظ„ط§ظ‚ط§طھ ط§ظ„ط¯ط§ط®ظ„ظٹط© طھط¨ظ‚ظ‰ ط¹ظ„ظ‰ UUID ظˆظ„ط§ طھطھط؛ظٹط±.
          </p>
        </div>
      )}

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
            ظٹظ…ظƒظ†ظƒ ط§ظ„ط±ط¬ظˆط¹ ظˆط§ظ„طھط¹ط¯ظٹظ„ ط¨ط¯ظˆظ† ظپظ‚ط¯ط§ظ† ط§ظ„ط¨ظٹط§ظ†ط§طھ. ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظ„ط§ ظٹظڈظ†ط´ط£ ط¥ظ„ط§ ط¹ظ†ط¯ ط§ظ„ط¶ط؛ط· ط¹ظ„ظ‰ ط­ظپط¸ ظپظٹ ط§ظ„ط®ط·ظˆط© ط§ظ„ط£ط®ظٹط±ط©.
          </p>
        </div>
      )}

      {!isEdit && form.parentOrderNumber && (
        <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-foreground">
          ط·ع¾ط¸â€¦ ط¸ظ¾ط·ع¾ط·آ­ ط¸â€،ط·آ°ط·آ§ ط·آ§ط¸â€‍ط·آ£ط¸â€¦ط·آ± ط¸ئ’ط·آ²ط¸ظ¹ط·آ§ط·آ±ط·آ© ط·آ¬ط·آ¯ط¸ظ¹ط·آ¯ط·آ© ط¸â€‍ط¸â€‍ط¸â€¦ط·آ±ط¸ئ’ط·آ¨ط·آ© ط·آ¨ط·آ¹ط·آ¯ ط·آ§ط¸â€‍ط·ع¾ط·آ³ط¸â€‍ط¸ظ¹ط¸â€¦.
          <span className="font-semibold"> ط·آ§ط¸â€‍ط·آ£ط¸â€¦ط·آ± ط·آ§ط¸â€‍ط·آ³ط·آ§ط·آ¨ط¸â€ڑ: {form.parentOrderNumber}</span>
          {form.visitNumber ? <span> أ¢â‚¬آ¢ ط·آ±ط¸â€ڑط¸â€¦ ط·آ§ط¸â€‍ط·آ²ط¸ظ¹ط·آ§ط·آ±ط·آ©: {form.visitNumber}</span> : null}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">ظ†ظˆط¹ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ *</h4>
          <p className="text-[11px] text-muted-foreground">ط­ط¯ط¯ ط§ظ„ظ…ط³ط§ط± ظ‚ط¨ظ„ ط¥ط¯ط®ط§ظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ. ط§ظ„ط£ظ…ط± ط§ظ„ظ…ط±طھط¨ط· ط¨ظ…ط·ط§ظ„ط¨ط© ظٹظڈطµظ†ظ‘ظپ طھط£ظ…ظٹظ† طھظ„ظ‚ط§ط¦ظٹظ‹ط§.</p>
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
            <span className="flex items-center gap-2 font-semibold text-foreground"><Car size={18} className="text-emerald-600" /> ط¹ظ…ظٹظ„ ط¹ط§ظ…</span>
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
            <span className="flex items-center gap-2 font-semibold text-foreground"><Shield size={18} className="text-sky-600" /> ط´ط±ظƒط© طھط£ظ…ظٹظ†</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">Insurance Work Order</span>
          </button>
        </div>
      </div>

      {/* طھط¹ط¨ط¦ط© طھظ„ظ‚ط§ط¦ظٹط© ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ ظ…ظ† طµظˆط±ط© ظ…ظژظ„ظƒظٹط©/ط§ط³طھظ…ط§ط±ط©/ط±ط®طµط© */}
      <div className="flex items-center justify-between gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <div className="text-xs">
          <div className="font-medium text-foreground">âڑ، طھط¹ط¨ط¦ط© ط³ط±ظٹط¹ط© ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ</div>
          <div className="text-muted-foreground">ط§ط±ظپط¹ طµظˆط±ط© ط§ظ„ظ…ظژظ„ظƒظٹط© / ط§ظ„ط§ط³طھظ…ط§ط±ط© / ط§ظ„ط±ط®طµط© ظˆط³ظٹط³طھط®ط±ط¬ ط§ظ„ط¨ظٹط§ظ†ط§طھ طھظ„ظ‚ط§ط¦ظٹط§ظ‹</div>
        </div>
        <AiExtractButton
          schema="vehicle_customer"
          label="طھط¹ط¨ط¦ط© ظ…ظ† طµظˆط±ط©"
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

      {/* ===== 1) ط§ظ„ط¹ظ…ظٹظ„ (ط¨ط­ط« ظ…ظˆط­ظ‘ط¯ ط¨ط§ظ„ظ‡ط§طھظپ + ط¥ظ†ط´ط§ط، ط¥ظ„ط²ط§ظ…ظٹ) ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-2" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">ط§ظ„ط¹ظ…ظٹظ„</h4>
        <p className="text-[10px] text-muted-foreground">
          ط§ط¨ط­ط« ط¨ط§ظ„ظ‡ط§طھظپ ط£ظˆ ط§ظ„ط§ط³ظ…. ظ„ظˆ ظ„ظ… ظٹظˆط¬ط¯ ط³ظٹط¸ظ‡ط± ط²ط± آ«ط¥ط¶ط§ظپط© ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯ (ط¥ظ„ط²ط§ظ…ظٹ)آ».
          {selectedType === "insurance" && (
            <span className="text-amber-600"> â€” ظپظٹ ط­ط§ظ„ط© ط§ظ„طھط£ظ…ظٹظ† ظٹظ…ظƒظ† طھط±ظƒ ط§ظ„ط¹ظ…ظٹظ„ ط§ظپطھط±ط§ط¶ظٹط§ظ‹ آ«Insurance Pendingآ» ظˆطھط­ط¯ظٹط¯ظ‡ ط¹ظ†ط¯ ط§ظ„طھط³ظ„ظٹظ….</span>
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
            ط§ط³طھط®ط¯ط§ظ… ط¹ظ…ظٹظ„ ط§ظپطھط±ط§ط¶ظٹ آ«Insurance Pending - {form.insurance}آ»
          </button>
        )}
      </div>

      {/* ===== 2) ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط±ظƒط¨ط© (ظ…ظˆط­ظ‘ط¯ط© â€” ط¨ط¯ظˆظ† طھظƒط±ط§ط±) ===== */}
      <div className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط±ظƒط¨ط©</h4>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط© *</label>
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
          <label className="text-xs font-medium text-muted-foreground">ط§ظ„ظƒظٹظ„ظˆظ…طھط±ط§طھ</label>
          <Input value={form.mileage || ""} onChange={e => set("mileage", e.target.value)} className="bg-secondary border-border text-foreground" />
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          {vehicleLookupLoading ? (
            <p className="text-muted-foreground">ط¬ط§ط±ظٹ ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ظ…ط±ظƒط¨ط© ط¯ط§ط®ظ„ ظ†ظپط³ ط§ظ„ظˆط±ط´ط©...</p>
          ) : vehicleMatch ? (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {vehicleMatch.source === "vin" ? "طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط±ظƒط¨ط© ظ…ط­طھظ…ظ„ط© ط¹ط¨ط± VIN" : "طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط©"}
                  </p>
                  {vehicleMatch.source === "vin" && (
                    <p className="rounded-md border border-warning/35 bg-warning/10 p-2 text-warning">
                      ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ طھط·ط§ط¨ظ‚ ظƒط§ظ…ظ„ ط¨ط§ظ„ظ„ظˆط­ط© ظˆط§ظ„ط­ط±ظˆظپ ظˆط§ظ„ط¯ظˆظ„ط©. ظ‡ط°ظ‡ ظ†طھظٹط¬ط© ظ…ط­طھظ…ظ„ط© ط¹ط¨ط± VIN ظپظ‚ط·طŒ ظˆظ„ظ† ظٹطھظ… ط±ط¨ط·ظ‡ط§ طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط¥ظ„ط§ ط¨ط¹ط¯ ط§ظ„ط¶ط؛ط· ط¹ظ„ظ‰ Use Existing Vehicle.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    ط§ظ„ظ„ظˆط­ط©: {[vehicleMatch.plate_letters, vehicleMatch.plate_number].filter(Boolean).join(" ") || "â€”"} آ· VIN: {vehicleMatch.vin_number || vehicleMatch.vin || "â€”"}
                  </p>
                  <p className="text-muted-foreground">
                    {vehicleMatch.brand || "â€”"} {vehicleMatch.model || ""} {vehicleMatch.year || ""} آ· ط§ظ„ط¹ظ…ظٹظ„: {vehicleMatch.customer_name || "â€”"}
                  </p>
                  {vehicleOwnershipConflict && (
                    <div className="space-y-2 rounded-md border border-warning/35 bg-warning/10 p-2 text-warning">
                      <p>
                        المركبة مرتبطة بسجل عميل آخر. يمكنك إنشاء أمر العمل للعميل الحالي بدون تغيير مالك المركبة.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium">صفة العميل بالنسبة للمركبة</label>
                          <Select
                            value={form.customerRelationshipToVehicle || "delivered_by"}
                            onValueChange={(value) => setForm((prev) => ({ ...prev, customerRelationshipToVehicle: value }))}
                          >
                            <SelectTrigger className="h-8 bg-card border-border text-foreground">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border">
                              <SelectItem value="current_owner">المالك الحالي</SelectItem>
                              <SelectItem value="new_owner">المالك الجديد</SelectItem>
                              <SelectItem value="driver">السائق</SelectItem>
                              <SelectItem value="authorized">المفوّض</SelectItem>
                              <SelectItem value="renter">المستأجر</SelectItem>
                              <SelectItem value="company_rep">ممثل شركة</SelectItem>
                              <SelectItem value="insurance_rep">ممثل شركة التأمين</SelectItem>
                              <SelectItem value="delivered_by">سلّم المركبة للورشة</SelectItem>
                              <SelectItem value="other">أخرى</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {form.customerRelationshipToVehicle === "other" && (
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium">وصف مختصر</label>
                            <Input
                              value={form.customerRelationshipNote || ""}
                              onChange={(e) => setForm((prev) => ({ ...prev, customerRelationshipNote: e.target.value }))}
                              className="h-8 bg-card border-border text-foreground"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={useExistingVehicle ? "default" : "outline"}
                  onClick={() => {
                    setUseExistingVehicle(true);
                    setForm((prev) => ({
                      ...prev,
                      vehicleId: vehicleMatch.id,
                      vehicleOwnerCustomerId: vehicleMatch.customer_id || prev.vehicleOwnerCustomerId,
                      receivedFromCustomerId: currentCustomerId || prev.receivedFromCustomerId,
                      customerRelationshipToVehicle: prev.customerRelationshipToVehicle || "delivered_by",
                    }));
                  }}
                >
                  Use Existing Vehicle
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط±ظƒط¨ط© ظ…ط·ط§ط¨ظ‚ط©. ط³ظٹطھظ… ط¥ظ†ط´ط§ط، ظ…ط±ظƒط¨ط© ط¬ط¯ظٹط¯ط© ظˆط±ط¨ط·ظ‡ط§ ط¨ط§ظ„ط¹ظ…ظٹظ„ ط§ظ„طµط­ظٹط­ ط¹ظ†ط¯ ط§ظ„ط­ظپط¸.</p>
          )}
        </div>
      </div>

      {/* ===== 3) ط¨ظٹط§ظ†ط§طھ ط§ظ„ط®ط¯ظ…ط© ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-3" style={{ display: wizardVisible(0) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground">ط¨ظٹط§ظ†ط§طھ ط§ظ„ط®ط¯ظ…ط©</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">طھط§ط±ظٹط® ط§ظ„ط§ط³طھظ„ط§ظ…</label>
            <Input type="date" value={form.entryDate || ""} onChange={e => set("entryDate", e.target.value)} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">ظ†ظˆط¹ ط§ظ„ط®ط¯ظ…ط© *</label>
            <Select value={form.serviceType} onValueChange={v => set("serviceType", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">{serviceTypes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">ط§ظ„ظپظ†ظٹ ط§ظ„ظ…ط³ط¤ظˆظ„</label>
            <Select value={form.technician} onValueChange={v => set("technician", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="ط§ط®طھط± ط§ظ„ظپظ†ظٹ" /></SelectTrigger>
              <SelectContent className="bg-card border-border">{technicians.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selectedType === "insurance" && <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</label>
            <Select value={form.insurance} onValueChange={v => set("insurance", v)}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="ط§ط®طھط±" /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="-">-</SelectItem>
                {companyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          {selectedType === "insurance" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">ط±ط¨ط· ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ط©</label>
                <Select value={form.claimId || "manual"} onValueChange={selectClaim}>
                  <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue placeholder="ط§ط®طھط± ظ…ط·ط§ظ„ط¨ط©" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="manual">ط±ظ‚ظ… ظ…ط·ط§ظ„ط¨ط© ظٹط¯ظˆظٹ â€” ط¨ط¯ظˆظ† ط¥ظ†ط´ط§ط، ظ…ط·ط§ظ„ط¨ط©</SelectItem>
                    {claims.map((claim) => (
                      <SelectItem key={claim.id} value={claim.id}>
                        {claim.claim_number} â€” {claim.insurance_company || "ط¨ط¯ظˆظ† ط´ط±ظƒط©"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© *</label>
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

      {/* ===== 4) ط§ظ„طھظƒط§ظ„ظٹظپ ط§ظ„طھظ‚ط¯ظٹط±ظٹط© ===== */}
      <div className="border border-border rounded-lg bg-card/50 p-3 space-y-3">
        <h4 className="text-sm font-semibold text-foreground">ط§ظ„طھظƒط§ظ„ظٹظپ ط§ظ„طھظ‚ط¯ظٹط±ظٹط© / Estimated Costs</h4>
        <p className="rounded-md border border-info/30 bg-info/5 p-2 text-xs text-muted-foreground">
          ظ‡ط°ظ‡ ط§ظ„ظ‚ظٹظ… طھظ‚ط¯ظٹط±ظٹط© ظˆطھط®طµ ط§ظ„ط§طھظپط§ظ‚ ط§ظ„ظ…ط¨ط¯ط¦ظٹ ظ…ط¹ ط§ظ„ط¹ظ…ظٹظ„. ط§ظ„طھظƒظ„ظپط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط© طھط¹طھظ…ط¯ ط¹ظ†ط¯ ط¥ط؛ظ„ط§ظ‚ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظ…ظ† ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„ظپط¹ظ„ظٹط© ط£ظˆ ظ…ظ† ط§ط®طھظٹط§ط± ظ…طµط¯ط± ط§ظ„طھظƒظ„ظپط© ط§ظ„ظ†ظ‡ط§ط¦ظٹطŒ ظˆظ„ط§ ظٹطھظ… ط¬ظ…ط¹ ط§ظ„طھظ‚ط¯ظٹط±ظٹ ظ…ط¹ ط§ظ„ظپط¹ظ„ظٹ.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">طھظƒظ„ظپط© ط§ظ„ط¹ظ…ط§ظ„ط© ط§ظ„طھظ‚ط¯ظٹط±ظٹط© / Estimated Labour Cost (ط±.ط¹)</label>
            <Input type="number" value={form.laborCost ?? 0} onChange={e => set("laborCost", Number(e.target.value))} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">طھظƒظ„ظپط© ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط± ط§ظ„طھظ‚ط¯ظٹط±ظٹط© / Estimated Spare Parts Cost (ط±.ط¹)</label>
            <Input type="number" value={form.partsCost ?? 0} onChange={e => set("partsCost", Number(e.target.value))} className="bg-secondary border-border text-foreground" />
          </div>
          {isEdit && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">ط§ظ„ط­ط§ظ„ط©</label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">{WORK_ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>


      {/* ظپط­طµ ظˆط§ط³طھظ„ط§ظ… ط§ظ„ظ…ط±ظƒط¨ط© */}
      <div className="border border-info/30 rounded-lg bg-info/5 p-3 space-y-3" style={{ display: wizardVisible(1) ? undefined : "none" }}>
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Car size={14} className="text-info" /> ظپط­طµ ظˆط§ط³طھظ„ط§ظ… ط§ظ„ظ…ط±ظƒط¨ط©
          <span className="text-[10px] text-muted-foreground font-normal">(ط§ظ„ط¹ط¯ط§ط¯طŒ ط§ظ„ظˆظ‚ظˆط¯طŒ ط§ظ„ظ…ظ‚طھظ†ظٹط§طھ)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">ظ‚ط±ط§ط،ط© ط§ظ„ط¹ط¯ط§ط¯ (KM)</label>
            <Input
              type="number"
              value={form.odometerKm ?? ""}
              onChange={e => set("odometerKm", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="ظ…ط«ط§ظ„: 125400"
              className="h-9 bg-card border-border text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              ظ…ط³طھظˆظ‰ ط§ظ„ظˆظ‚ظˆط¯: <strong className="text-info">{form.fuelLevelPct ?? 50}%</strong>
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
          <label className="text-xs font-medium text-muted-foreground mb-1 block">ط§ظ„ظ…ظ‚طھظ†ظٹط§طھ ط¯ط§ط®ظ„ ط§ظ„ظ…ط±ظƒط¨ط©</label>
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
            placeholder="ظ…ظ‚طھظ†ظٹط§طھ ط£ط®ط±ظ‰ (ط§ظƒطھط¨ظ‡ط§ ظ‡ظ†ط§)â€¦"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">ظ…ظ„ط§ط­ط¸ط§طھ ط§ظ„ط§ط³طھظ„ط§ظ…</label>
          <Textarea
            value={form.receptionNotes || ""}
            onChange={e => set("receptionNotes", e.target.value)}
            rows={2}
            placeholder="ط­ط§ظ„ط© ط§ظ„ظ…ط±ظƒط¨ط© ط§ظ„ط¸ط§ظ‡ط±ظٹط©طŒ ط®ط¯ظˆط´ ط³ط§ط¨ظ‚ط©طŒ ط±ط§ط¦ط­ط©طŒ ط¥ظ„ط®â€¦"
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
          showDamageMap={form.serviceType === "ط­ط§ط¯ط«" || selectedType === "insurance"}
        />
      </div>


      <div className="border border-border rounded-lg bg-secondary/20 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span className="text-warning">â—ڈ</span> ظ…طµط±ظˆظپط§طھ ط¥ط¶ط§ظپظٹط©
            <span className="text-[10px] text-muted-foreground font-normal">(ط³ط­ط¨طŒ ظ†ظ‚ظ„طŒ طµط¨ط؛ ط®ط§ط±ط¬ظٹطŒ ط®ط¯ظ…ط§طھ...)</span>
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addExpense} className="gap-1 h-7 text-xs">
            <Plus size={12} /> ط¥ط¶ط§ظپط© ظ…طµط±ظˆظپ
          </Button>
        </div>
        {(form.extraExpenses || []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">ظ„ط§ طھظˆط¬ط¯ ظ…طµط±ظˆظپط§طھ ط¥ط¶ط§ظپظٹط©</p>
        ) : (
          <div className="space-y-2">
            {(form.extraExpenses || []).map((ex) => (
              <div key={ex.id} className="grid grid-cols-12 gap-2 items-start">
                <Input
                  value={ex.label}
                  onChange={e => updateExpense(ex.id, { label: e.target.value })}
                  placeholder="ط¨ظٹط§ظ† ط§ظ„ظ…طµط±ظˆظپ"
                  className="col-span-5 h-9 bg-card border-border text-sm"
                />
                <Input
                  type="number"
                  value={ex.amount}
                  onChange={e => updateExpense(ex.id, { amount: Number(e.target.value) })}
                  placeholder="ط§ظ„ظ…ط¨ظ„ط؛"
                  className="col-span-3 h-9 bg-card border-border text-sm"
                />
                <Input
                  value={ex.notes || ""}
                  onChange={e => updateExpense(ex.id, { notes: e.target.value })}
                  placeholder="ظ…ظ„ط§ط­ط¸ط§طھ"
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
              ظ…ط¬ظ…ظˆط¹ ط§ظ„ظ…طµط±ظˆظپط§طھ ط§ظ„ط¥ط¶ط§ظپظٹط©: <span className="font-bold text-warning">{extraTotal.toLocaleString()} ط±.ط¹</span>
            </div>
          </div>
        )}
      </div>

      {/* ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط± ط§ظ„ظ…ط·ظ„ظˆط¨ط© (ط·ظ„ط¨ ط´ط±ط§ط، ط¯ط§ط®ظ„ظٹ) */}
      <div className="border border-info/30 rounded-lg bg-info/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Package size={14} className="text-info" /> ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط± ط§ظ„ظ…ط·ظ„ظˆط¨ط©
            <span className="text-[10px] text-muted-foreground font-normal">(ط·ظ„ط¨ ط´ط±ط§ط، ط¯ط§ط®ظ„ظٹ ظٹظ…ظƒظ† ط·ط¨ط§ط¹طھظ‡)</span>
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addNeededPart} className="gap-1 h-7 text-xs">
            <Plus size={12} /> ط¥ط¶ط§ظپط© ظ‚ط·ط¹ط©
          </Button>
        </div>
        {(form.partsNeeded || []).length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">ظ„ط§ طھظˆط¬ط¯ ظ‚ط·ط¹ ط؛ظٹط§ط± ظ…ط·ظ„ظˆط¨ط©</p>
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
                    placeholder="ط§ط³ظ… ط§ظ„ظ‚ط·ط¹ط© (ظ…ط«ط§ظ„: ظ…طµط¨ط§ط­ ط£ظ…ط§ظ…ظٹ ظٹظ…ظٹظ†)"
                    className={`col-span-4 h-9 bg-card border-border text-sm ${done ? "line-through text-muted-foreground" : ""}`}
                  />
                  <Input
                    type="number"
                    min={1}
                    value={np.quantity}
                    onChange={e => updateNeededPart(np.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    placeholder="ط§ظ„ظƒظ…ظٹط©"
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
                    placeholder="ظ…ظ„ط§ط­ط¸ط§طھ"
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
              ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ‚ط·ط¹ ط§ظ„ظ…ط·ظ„ظˆط¨ط©: <span className="font-bold text-info">{(form.partsNeeded || []).reduce((s, p) => s + (p.quantity || 0), 0)}</span>
              {" "}â€” طھظ… ط§ظ„طھط£ظ…ظٹظ†/ط§ظ„ط§ط³طھظ„ط§ظ…: <span className="font-bold text-success">{(form.partsNeeded || []).filter(p => (p.status ? (p.status === "received" || p.status === "secured") : p.fulfilled)).length}</span>
              {" / "} <span>{(form.partsNeeded || []).length}</span>
            </div>
          </div>
        )}
      </div>

      {/* ط³ظ†ط¯ط§طھ طµط±ظپ ط®ط§ط±ط¬ظٹط© ظ…ط±طھط¨ط·ط© (ظ„ظ„ظ‚ط±ط§ط،ط©) */}
      {isEdit && linkedVouchers.length > 0 && (
        <div className="border border-info/30 rounded-lg bg-info/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
            <LinkIcon size={14} className="text-info" /> ط³ظ†ط¯ط§طھ طµط±ظپ ظ…ط±طھط¨ط·ط© ط¨ظ‡ط°ط§ ط§ظ„ط£ظ…ط±
            <span className="text-[10px] text-muted-foreground font-normal">({linkedVouchers.length})</span>
          </h4>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {linkedVouchers.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-xs bg-card rounded px-2 py-1.5 border border-border/50">
                <div className="flex flex-col">
                  <span className="font-mono text-info">{v.voucherNumber}</span>
                  <span className="text-muted-foreground text-[10px]">{v.beneficiary || v.description || v.categoryName}</span>
                </div>
                <span className="font-semibold text-foreground">{Number(v.amount).toLocaleString()} ط±.ط¹</span>
              </div>
            ))}
          </div>
          <div className="text-left text-xs text-muted-foreground pt-2 border-t border-border/50 mt-2">
            ظ…ط¬ظ…ظˆط¹ ط³ظ†ط¯ط§طھ ط§ظ„طµط±ظپ ط§ظ„ط®ط§ط±ط¬ظٹط©: <span className="font-bold text-info">{linkedVouchersTotal.toLocaleString()} ط±.ط¹</span>
            <span className="block text-[10px] mt-0.5">* طھظڈط³طھط®ط¯ظ… ظپظٹ ط§ط­طھط³ط§ط¨ طµط§ظپظٹ ط±ط¨ط­ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ظˆظ„ظٹط³ ظپظٹ ظپط§طھظˆط±ط© ط§ظ„ط¹ظ…ظٹظ„</span>
          </div>
        </div>
      )}

      {/* ط§ظ„ط¯ظپط¹ط§طھ */}
      {(availableDeposit > 0 || (initial?.depositApplied || 0) > 0) && (
        <div className="border border-success/30 rounded-lg bg-success/5 p-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
            <Wallet size={14} className="text-success" /> ط±طµظٹط¯ ط§ظ„ط¯ظپط¹ط§طھ ط§ظ„ظ…طھط§ط­ ظ„ظ„ط¹ظ…ظٹظ„/ط§ظ„ط³ظٹط§ط±ط©
          </h4>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="text-xs">
              <p className="text-muted-foreground">ط§ظ„ط±طµظٹط¯ ط§ظ„ظ…طھط§ط­</p>
              <p className="text-lg font-bold text-success">{availableDeposit.toLocaleString()} ط±.ط¹</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ط®طµظ… ظ…ظ† ط§ظ„ظپط§طھظˆط±ط©</label>
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

      {/* ظ…ظ„ط®طµ ط§ظ„طھظƒظ„ظپط© */}
      <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-3 space-y-1 text-sm" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex justify-between text-muted-foreground"><span>طھظƒظ„ظپط© ط§ظ„ط¹ظ…ط§ظ„ط© ط§ظ„طھظ‚ط¯ظٹط±ظٹط©</span><span>{(Number(form.laborCost) || 0).toLocaleString()} ط±.ط¹</span></div>
        <div className="flex justify-between text-muted-foreground"><span>طھظƒظ„ظپط© ظ‚ط·ط¹ ط§ظ„ط؛ظٹط§ط± ط§ظ„طھظ‚ط¯ظٹط±ظٹط©</span><span>{(Number(form.partsCost) || 0).toLocaleString()} ط±.ط¹</span></div>
        {extraTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>ظ…طµط±ظˆظپط§طھ ط¥ط¶ط§ظپظٹط©</span><span>{extraTotal.toLocaleString()} ط±.ط¹</span></div>}
        <div className="flex justify-between text-foreground font-bold border-t border-border pt-1">
          <span>ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظپط§طھظˆط±ط©</span>
          <span className="text-primary">{finalTotal.toLocaleString()} ط±.ط¹</span>
        </div>
        {deposit > 0 && (
          <>
            <div className="flex justify-between text-success"><span>ط¯ظپط¹ط© ظ…ط³طھظ„ظ…ط© (ط¯ط®ظ„)</span><span>+{deposit.toLocaleString()} ط±.ط¹</span></div>
            <div className="flex justify-between text-warning font-semibold"><span>ط§ظ„ط±طµظٹط¯ ط§ظ„ظ…ط³طھط­ظ‚</span><span>{balanceDue.toLocaleString()} ط±.ط¹</span></div>
          </>
        )}
      </div>

      {/* ===== ط¨ظ†ظˆط¯ ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ط·ظ„ظˆط¨ط© (طھط¸ظ‡ط± ظ„ظ„ط¹ظ…ظٹظ„ ظپظٹ ط±ط§ط¨ط· ط§ظ„طھظˆظ‚ظٹط¹) ===== */}
      <div className="border-2 border-primary/20 rounded-xl bg-card p-3 space-y-3" style={{ display: wizardVisible(2) ? undefined : "none" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-foreground">ًں“‹ ط¨ظ†ظˆط¯ ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ط·ظ„ظˆط¨ط©</div>
            <div className="text-[11px] text-muted-foreground">ط³ظٹط±ط§ظ‡ط§ ط§ظ„ط¹ظ…ظٹظ„ ط¹ظ†ط¯ طھظˆظ‚ظٹط¹ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ ط¥ظ„ظƒطھط±ظˆظ†ظٹط§ظ‹</div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addWorkItem} className="h-8 gap-1">
            <Plus size={14} /> ط¥ط¶ط§ظپط© ط¨ظ†ط¯
          </Button>
        </div>
        {(form.workItems || []).length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground py-3 border border-dashed border-border rounded-lg">
            ظ„ط§ طھظˆط¬ط¯ ط¨ظ†ظˆط¯ â€” ط§ط¶ط؛ط· آ«ط¥ط¶ط§ظپط© ط¨ظ†ط¯آ» ظ„ط¥ط¯ط±ط§ط¬ ط§ظ„ط¹ظ…ظ„ ط§ظ„ظ…ط·ظ„ظˆط¨
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
                    placeholder="ط¹ظ†ظˆط§ظ† ط§ظ„ط¨ظ†ط¯ (ظ…ط«ط§ظ„: طھط؛ظٹظٹط± ط²ظٹطھ ط§ظ„ظ…ط­ط±ظƒ)"
                    className="h-8 text-sm bg-background"
                  />
                  <Input
                    value={w.note || ""}
                    onChange={e => updateWorkItem(w.id, { note: e.target.value })}
                    placeholder="ظ…ظ„ط§ط­ط¸ط© (ط§ط®طھظٹط§ط±ظٹ)"
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
          <label className="text-xs font-medium text-muted-foreground">ظ…ظ„ط§ط­ط¸ط§طھ / طھط´ط®ظٹطµ</label>
          <AiWriteButton
            value={form.diagnosis || ""}
            onChange={(t) => set("diagnosis", t)}
            context={`ط£ظ…ط± ط¹ظ…ظ„ ظ„ط³ظٹط§ط±ط© ${form.vehicleType || ""} ${form.model || ""} ظ„ظˆط­ط© ${form.plate || ""} - ط®ط¯ظ…ط©: ${form.serviceType || ""}`}
            placeholder="ظ…ط«ط§ظ„: ط§ظƒطھط¨ طھط´ط®ظٹطµط§ظ‹ ط£ظˆظ„ظٹط§ظ‹ ظ„ظ…ط´ظƒظ„ط© ظپظٹ ط§ظ„ظ…ط­ط±ظƒ"
          />
        </div>
        <textarea value={form.diagnosis || ""} onChange={e => set("diagnosis", e.target.value)} className="w-full rounded-lg bg-secondary border border-border text-foreground p-3 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>
      <div className="flex gap-3 pt-2">
        {isWizard && wizardStep > 0 && (
          <Button type="button" variant="outline" onClick={() => setWizardStep((step) => Math.max(0, step - 1) as 0 | 1 | 2)}>
            ط§ظ„ط³ط§ط¨ظ‚
          </Button>
        )}
        {isWizard && wizardStep < 2 ? (
          <Button type="button" onClick={goWizardNext} className="gradient-gold text-primary-foreground flex-1 hover:opacity-90">
            ط§ظ„طھط§ظ„ظٹ
          </Button>
        ) : (
          <Button onClick={() => void handleSubmit()} disabled={saving} className="gradient-gold text-primary-foreground flex-1 hover:opacity-90">
            {saving ? "ط¬ط§ط±ظچ ط§ظ„ط­ظپط¸ ظˆط§ظ„ط±ظپط¹â€¦" : isEdit ? "ط­ظپط¸ ط§ظ„طھط¹ط¯ظٹظ„ط§طھ" : "ط­ظپط¸ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„"}
          </Button>
        )}
        <Button onClick={onClose} variant="outline" className="border-border text-foreground hover:bg-secondary">ط¥ظ„ط؛ط§ط،</Button>
      </div>
    </div>
  );
}
