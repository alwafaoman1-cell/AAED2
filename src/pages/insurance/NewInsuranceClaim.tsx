import { useEffect, useMemo, useRef, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, ArrowLeft, Save, CheckCircle2, Building2, Car, FileText,
  AlertTriangle, Calculator, ClipboardList, Wand2, X, Plus, Trash2, Phone,
  CalendarClock, BadgeCheck, Loader2, Wrench, Truck, Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCreateClaim } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies, findOrCreateInsuranceCompany } from "@/hooks/useInsuranceCompanies";
import InsuranceCompanyAutocomplete from "@/components/insurance/InsuranceCompanyAutocomplete";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import UplItemsEditor, { type UplItem } from "@/components/insurance/UplItemsEditor";
import AiExtractButton from "@/components/ai/AiExtractButton";
import AiWriteButton from "@/components/ai/AiWriteButton";
import { toEnglishDigits } from "@/lib/numberUtils";
import { useAuth } from "@/contexts/AuthContext";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import { ensureVehicleForCustomer, findExistingVehicle } from "@/lib/vehicleIdentity";
import { isUuid } from "@/lib/uuid";
import { toE164 } from "@/lib/phoneUtils";

// ───────────────────── أنواع داخلية ─────────────────────
// ⚠️ هذه الصفحة من منظور "الكراج": نستلم سيارة من شركة تأمين ونطالبها بالمستحقات.
// لا نُصدر بوالص ولا نتعامل مع مخمّن داخلي — كل ذلك من اختصاص شركة التأمين.
type Step = 0 | 1 | 2 | 3 | 4;

interface Draft {
  // company (مَن سندفع له الفاتورة)
  company: string;
  companyId: string | null;
  claimNumber: string;     // الرقم الذي تعطيه شركة التأمين أو نولّده مؤقتاً
  // owner (صاحب السيارة لتسليمها له بعد الإصلاح)
  customerId: string | null;
  ownerName: string;
  ownerPhone: string;
  expectedDeliveryDate: string; // تاريخ التسليم المتوقع للعميل
  // vehicle
  vehicleId: string | null; // ربط بمركبة موجودة في قاعدة البيانات
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleYear: string;
  vehicleColor: string;
  vehicleVin: string;
  // incident / damage description (وصف الضرر فقط — لا نحتاج موقع الحادث)
  incidentDate: string;
  damageDescription: string;
  // estimation (تسعيرنا نحن الكراج — قابل للتبديل بين إجمالي وبنود)
  estimationType: "lump_sum" | "upl";
  estimatedCost: string;     // المبلغ الإجمالي المطالب به (lump sum)
  uplItems: UplItem[];       // البنود التفصيلية (UPL)
  // misc
  notes: string;
}

const STEPS: { key: Step; label: string; icon: any }[] = [
  { key: 0, label: "شركة التأمين", icon: Building2 },
  { key: 1, label: "السيارة والعميل", icon: Car },
  { key: 2, label: "وصف الضرر", icon: AlertTriangle },
  { key: 3, label: "تسعير الكراج", icon: Calculator },
  { key: 4, label: "المراجعة", icon: CheckCircle2 },
];

const DRAFT_KEY = "insurance_claim_draft_v3"; // bumped: removed internal-cost & templates

const emptyDraft = (): Draft => ({
  company: "", companyId: null, claimNumber: "",
  customerId: null, ownerName: "", ownerPhone: "", expectedDeliveryDate: "",
  vehicleId: null, vehicleMake: "", vehicleModel: "", vehiclePlate: "", vehicleYear: "", vehicleColor: "", vehicleVin: "",
  incidentDate: new Date().toISOString().slice(0, 10),
  damageDescription: "",
  estimationType: "lump_sum", estimatedCost: "",
  uplItems: [],
  notes: "",
});

// ───────────────────── المكون الرئيسي ─────────────────────
export default function NewInsuranceClaim() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const createClaim = useCreateClaim();
  const { data: companies = [] } = useInsuranceCompanies();

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [savedDraftAt, setSavedDraftAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const draftHydratedRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const savedDraftAtRef = useRef<number | null>(null);
  const cloudDraftKey = useMemo(() => `${DRAFT_KEY}:${user?.id || "anonymous"}`, [user?.id]);
  const [existingCustomerByPhone, setExistingCustomerByPhone] = useState<{ id: string; name: string; phone: string | null } | null>(null);

  // ── استرجاع المسودة ──
  useEffect(() => {
    let cancelled = false;
    draftHydratedRef.current = false;

    const applyDraft = (stored: { savedAt: number; data: Draft } | null) => {
      if (!stored?.savedAt || Date.now() - stored.savedAt >= 1000 * 60 * 60 * 24 * 3) return;
      if (stored.savedAt <= (savedDraftAtRef.current || 0)) return;
      setDraft({ ...emptyDraft(), ...stored.data });
      setSavedDraftAt(stored.savedAt);
      savedDraftAtRef.current = stored.savedAt;
    };

    void (async () => {
      const cloudDraft = await readCloudSetting<{ savedAt: number; data: Draft } | null>(cloudDraftKey, null);
      if (cancelled) return;
      applyDraft(cloudDraft);

      if (!cloudDraft) {
        try {
          const legacy = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
          applyDraft(legacy);
          if (legacy) void writeCloudSetting(cloudDraftKey, legacy).catch(() => {});
        } catch {}
      }

      const c = params.get("company");
      if (c) setDraft((current) => ({ ...current, company: c }));
      draftHydratedRef.current = true;
    })();

    const unsubscribe = subscribeCloudSetting<{ savedAt: number; data: Draft } | null>(
      cloudDraftKey,
      (stored) => {
        if (!cancelled) applyDraft(stored);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cloudDraftKey, params]);

  // ── حفظ المسودة تلقائياً ──
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      const savedAt = Date.now();
      const payload = { savedAt, data: draft };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch {}
      void writeCloudSetting(cloudDraftKey, payload).catch(() => {});
      savedDraftAtRef.current = savedAt;
      setSavedDraftAt(savedAt);
    }, 600);
    return () => clearTimeout(t);
  }, [cloudDraftKey, draft]);

  const clearStoredDraft = () => {
    skipNextDraftSaveRef.current = true;
    savedDraftAtRef.current = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    void writeCloudSetting(cloudDraftKey, null).catch(() => {});
  };

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    let cancelled = false;
    const normalizedPhone = toE164(draft.ownerPhone);
    const phoneDigits = normalizedPhone.replace(/\D/g, "").slice(-8);
    if (!phoneDigits || draft.customerId) {
      setExistingCustomerByPhone(null);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
        if (!tenantId || cancelled) return;
        const { data } = await supabase
          .from("customers")
          .select("id,name,phone")
          .eq("tenant_id", tenantId as string)
          .ilike("phone", `%${phoneDigits}%`)
          .limit(5);
        if (cancelled) return;
        const match = ((data as any[]) || []).find((customer) => {
          const stored = toE164(customer.phone || "");
          return stored.replace(/\D/g, "").slice(-8) === phoneDigits;
        });
        setExistingCustomerByPhone(match ? {
          id: match.id,
          name: match.name || "",
          phone: match.phone || null,
        } : null);
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.ownerPhone, draft.customerId]);

  // ── توليد رقم مرجعي مؤقت للكراج ──
  const generateClaimNumber = () => {
    const yr = new Date().getFullYear();
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    update({ claimNumber: `CLM-${yr}-${seq}` });
  };

  // ── حسابات ──
  const uplTotal = useMemo(
    () => draft.uplItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0),
    [draft.uplItems]
  );
  const finalEstimate = draft.estimationType === "upl" ? uplTotal : Number(draft.estimatedCost) || 0;
  const vatAmount = finalEstimate * 0.05;
  const finalWithVat = finalEstimate + vatAmount;

  // ── تحقق من كل خطوة ──
  const stepValid = (s: Step): boolean => {
    switch (s) {
      case 0: return !!draft.company.trim() && !!draft.claimNumber.trim();
      // يكفي إدخال بيانات السيارة الأساسية يدوياً (ستُنشأ المركبة تلقائياً عند الحفظ)
      case 1: return !!(
        draft.vehicleMake.trim() &&
        draft.vehicleModel.trim() &&
        draft.vehiclePlate.trim() &&
        (draft.customerId || draft.ownerName.trim())
      );
      case 2: return !!draft.incidentDate;
      case 3: return draft.estimationType === "upl" ? draft.uplItems.length > 0 && uplTotal > 0 : Number(draft.estimatedCost) > 0;
      case 4: return true;
      default: return false;
    }
  };

  const canNext = stepValid(step);
  const allValid = stepValid(0) && stepValid(1) && stepValid(2) && stepValid(3);

  // رسالة توضيحية تشرح سبب عدم اكتمال خطوة معينة
  const stepMissingMsg = (s: Step): string | null => {
    switch (s) {
      case 0: {
        const miss: string[] = [];
        if (!draft.company.trim()) miss.push("اسم شركة التأمين");
        if (!draft.claimNumber.trim()) miss.push("رقم المطالبة");
        return miss.length ? `أكمل: ${miss.join(" و ")}` : null;
      }
      case 1: {
        const miss: string[] = [];
        if (!draft.vehicleMake.trim()) miss.push("الماركة");
        if (!draft.vehicleModel.trim()) miss.push("الموديل");
        if (!draft.vehiclePlate.trim()) miss.push("رقم اللوحة");
        if (!draft.customerId && !draft.ownerName.trim()) miss.push("اسم المالك أو اختيار عميل موجود");
        return miss.length ? `أكمل بيانات السيارة والمالك: ${miss.join("، ")}` : null;
      }
      case 2: return draft.incidentDate ? null : "حدد تاريخ التقدير";
      case 3: return draft.estimationType === "upl"
        ? (draft.uplItems.length > 0 && uplTotal > 0 ? null : "أضف بنود التسعير بقيم صحيحة")
        : (Number(draft.estimatedCost) > 0 ? null : "أدخل المبلغ المطالب به");
      default: return null;
    }
  };

  const goNext = () => {
    const msg = stepMissingMsg(step);
    if (msg) { toast.error(msg); return; }
    setStep((s) => Math.min(4, s + 1) as Step);
  };

  const trySubmit = (action: "save" | "save_and_open" | "save_and_new") => {
    for (const s of [0, 1, 2, 3] as Step[]) {
      const msg = stepMissingMsg(s);
      if (msg) { setStep(s); toast.error(msg); return; }
    }
    handleSubmit(action);
  };

  // ── تنبيهات ذكية ──
  const smartWarnings = useMemo(() => {
    const w: string[] = [];
    if (draft.claimNumber && draft.claimNumber.length < 5)
      w.push("ℹ️ رقم المطالبة قصير، يفضّل أن يكون كاملاً كما تعطيه شركة التأمين.");
    if (finalEstimate > 3000)
      w.push("💰 مبلغ مرتفع — تأكد من توثيق الصور قبل/بعد لإثبات الإصلاح.");
    if (draft.companyId) {
      const co = companies.find((c) => c.id === draft.companyId);
      if (co && co.payment_terms_days >= 60)
        w.push(`⏳ مدة سداد هذه الشركة ${co.payment_terms_days} يوماً — تأكد من السيولة.`);
    }
    return w;
  }, [draft, finalEstimate, companies]);

  // ── إرسال ──
  const handleSubmit = async (action: "save" | "save_and_open" | "save_and_new") => {
    if (!allValid) {
      toast.error("الرجاء استكمال البيانات المطلوبة في جميع الخطوات");
      return;
    }
    setSubmitting(true);
    try {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      if (!tenantId) throw new Error("لا يمكن تحديد المستأجر");

      // فحص تكرار رقم المطالبة داخل نفس الورشة فقط.
      const cn = draft.claimNumber.trim();
      const { data: existingClaim, error: existingClaimError } = await supabase
        .from("insurance_claims" as any)
        .select("id, claim_number, status, insurance_company, created_at")
        .eq("tenant_id", tenantId as string)
        .ilike("claim_number", cn)
        .maybeSingle();
      if (existingClaimError) throw existingClaimError;
      if ((existingClaim as any)?.id) {
        toast.warning("رقم المطالبة موجود مسبقًا. سيتم فتح المطالبة الموجودة.");
        navigate(`/insurance/${(existingClaim as any).id}`);
        return;
      }


      let companyId = draft.companyId;
      if (!companyId && draft.company.trim()) {
        companyId = await findOrCreateInsuranceCompany(draft.company.trim(), tenantId as string);
      }

      let customerId: string | null = draft.customerId && isUuid(draft.customerId) ? draft.customerId : null;
      let customerRecord: { id: string; name: string; phone: string | null } | null = null;
      if (customerId) {
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,phone")
          .eq("tenant_id", tenantId as string)
          .eq("id", customerId)
          .maybeSingle();
        if (error) throw error;
        customerRecord = (data as any) || null;
        if (!customerRecord) throw new Error("customer_id غير صحيح");
      } else {
        const normalizedPhone = toE164(draft.ownerPhone);
        const phoneDigits = normalizedPhone.replace(/\D/g, "").slice(-8);
        if (phoneDigits) {
          const { data } = await supabase
            .from("customers")
            .select("id,name,phone")
            .eq("tenant_id", tenantId as string)
            .ilike("phone", `%${phoneDigits}%`)
            .limit(5);
          const phoneMatch = ((data as any[]) || []).find((customer) =>
            toE164(customer.phone || "").replace(/\D/g, "").slice(-8) === phoneDigits
          );
          if (phoneMatch) {
            throw new Error("رقم الهاتف موجود. اضغط Use Existing Customer قبل حفظ المطالبة.");
          }
        }
        if (!draft.ownerName.trim()) throw new Error("اختر customer_id أو أدخل اسم المالك لإنشاء عميل جديد");
        const { data: newCust, error: e1 } = await supabase
          .from("customers")
          .insert({
            tenant_id: tenantId as string,
            name: draft.ownerName.trim(),
            phone: normalizedPhone || null,
          } as any)
          .select("id,name,phone")
          .single();
        if (e1) throw e1;
        customerRecord = newCust as any;
        customerId = customerRecord.id;
      }



      let vehicleId = draft.vehicleId && isUuid(draft.vehicleId) ? draft.vehicleId : null;
      const vehicleCandidate = await findExistingVehicle({
        vehicleId: draft.vehicleId,
        plate: draft.vehiclePlate,
        vin: draft.vehicleVin,
        make: draft.vehicleMake,
        model: draft.vehicleModel,
        year: draft.vehicleYear,
        color: draft.vehicleColor,
      });
      if (vehicleCandidate?.id) {
        const needsConfirmation =
          vehicleCandidate.source === "vin" ||
          (!!vehicleCandidate.customer_id && vehicleCandidate.customer_id !== customerId);
        if (needsConfirmation) {
          const ok = window.confirm(
            vehicleCandidate.customer_id && vehicleCandidate.customer_id !== customerId
              ? "هذه المركبة موجودة ومرتبطة بعميل آخر. هل تريد ربط المطالبة بهذه المركبة بدون تغيير مالكها؟"
              : "تم العثور على مركبة بالـ VIN فقط. هل تؤكد ربط المطالبة بهذه المركبة؟",
          );
          if (!ok) {
            setSubmitting(false);
            return;
          }
          if (vehicleCandidate.customer_id && vehicleCandidate.customer_id !== customerId) {
            const { data: linkedOwner, error: linkedOwnerError } = await supabase
              .from("customers")
              .select("id,name,phone")
              .eq("tenant_id", tenantId as string)
              .eq("id", vehicleCandidate.customer_id)
              .maybeSingle();
            if (linkedOwnerError) throw linkedOwnerError;
            if (!(linkedOwner as any)?.id) throw new Error("تعذر قراءة مالك المركبة الموجود من Supabase");
            customerRecord = linkedOwner as any;
            customerId = (linkedOwner as any).id;
          }
        }
        vehicleId = vehicleCandidate.id;
      } else if (draft.vehiclePlate.trim() || draft.vehicleVin.trim()) {
        const resolved = await ensureVehicleForCustomer({
          customerId: customerId!,
          plate: draft.vehiclePlate,
          vin: draft.vehicleVin,
          make: draft.vehicleMake,
          model: draft.vehicleModel,
          year: draft.vehicleYear,
          color: draft.vehicleColor,
        });
        vehicleId = resolved.vehicleId;
      }
      if (!vehicleId) throw new Error("لا يمكن حفظ مطالبة بدون vehicle_id");

      const { data: sameVehicleClaims, error: sameVehicleError } = await supabase
        .from("insurance_claims" as any)
        .select("id,claim_number,status,insurance_company,created_at")
        .eq("tenant_id", tenantId as string)
        .eq("vehicle_id", vehicleId)
        .neq("claim_number", cn)
        .not("status", "in", "(rejected,cancelled,paid)")
        .limit(10);
      if (sameVehicleError) throw sameVehicleError;
      if ((sameVehicleClaims as any[])?.length) {
        const lines = [
          "تنبيه: نفس المركبة لديها مطالبة أخرى برقم مختلف.",
          "",
          ...((sameVehicleClaims as any[]) || []).map((d) => `• مطالبة ${d.claim_number} — ${d.insurance_company || ""} (${d.status})`),
          "",
          "هل تريد المتابعة وإنشاء مطالبة جديدة لهذه المركبة؟",
        ].join("\n");
        if (!window.confirm(lines)) {
          setSubmitting(false);
          return;
        }
      }



      // ملاحظات
      const internalNotes = [
        draft.notes,
        draft.expectedDeliveryDate ? `تاريخ التسليم المتوقع: ${draft.expectedDeliveryDate}` : "",
      ].filter(Boolean).join("\n");

      const created: any = await createClaim.mutateAsync({
        tenant_id: tenantId as string,
        customer_id: customerId!,
        vehicle_id: vehicleId,
        claim_number: draft.claimNumber.trim(),
        insurance_company: draft.company.trim(),
        insurance_company_id: companyId && isUuid(companyId) ? companyId : null,
        estimated_amount: finalEstimate,
        approved_amount: 0,
        status: "pending",
        notes: internalNotes || undefined,
        incident_date: draft.incidentDate ? new Date(draft.incidentDate).toISOString() : null,
        // تاريخ التقدير مستقل عن وصول المركبة؛ الوصول وبدء العمل يُسجلان فعليًا من صفحة المطالبة.
        estimate_date: draft.incidentDate || null,
        workshop_arrival_date: null,
        work_started_at: null,
        incident_location: null,
        incident_description: draft.damageDescription || null,
        deductible_amount: 0,
        estimated_cost: finalEstimate,
        vehicle_owner_name: customerRecord?.name || null,
        vehicle_owner_phone: customerRecord?.phone || null,
        vehicle_make: draft.vehicleMake || null,
        vehicle_model: draft.vehicleModel || null,
        vehicle_plate: draft.vehiclePlate || null,
        vehicle_year: draft.vehicleYear ? Number(draft.vehicleYear) : null,
        vehicle_color: draft.vehicleColor || null,
        estimation_type: draft.estimationType,
        upl_items: draft.estimationType === "upl" ? draft.uplItems : [],
      });

      clearStoredDraft();

      if (action === "save_and_open") {
        navigate(`/insurance/${created.id}`);
      } else if (action === "save_and_new") {
        setDraft(emptyDraft());
        setStep(0);
      } else {
        navigate("/insurance/list");
      }
    } catch (e: any) {
      if (String(e?.message || "").includes("vin_candidate_requires_user_confirmation")) {
        toast.error("تم العثور على مركبة محتملة عبر VIN فقط. اربط مركبة موجودة يدويًا أو أكمل بيانات اللوحة والحروف والدولة قبل حفظ المطالبة.");
      } else {
        toast.error(e?.message ?? "فشل إنشاء المطالبة");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ───────────────────── العرض ─────────────────────
  return (
    <div className="space-y-4 md:space-y-6">
      {/* العنوان */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Wrench className="text-primary" /> مطالبة كراج جديدة
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            إصلاح سيارة لشركة تأمين • {STEPS.length} خطوات • حفظ تلقائي للمسودة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => smartBack(navigate, "/insurance/list")}>
            <X size={16} /> إلغاء
          </Button>
          {savedDraftAt && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Save size={11} /> مسودة محفوظة
            </Badge>
          )}
        </div>
      </div>


      {/* شريط الخطوات */}
      <Card className="p-3 md:p-4">
        <div className="flex items-center justify-between gap-1 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const valid = stepValid(s.key);
            const active = step === s.key;
            const passed = step > s.key;
            return (
              <div key={s.key} className="flex items-center flex-1 min-w-fit">
                <button
                  onClick={() => setStep(s.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition whitespace-nowrap ${
                    active ? "bg-primary text-primary-foreground shadow"
                    : passed ? "bg-success/10 text-success hover:bg-success/20"
                    : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    active ? "bg-primary-foreground/20" : passed ? "bg-success/20" : "bg-muted"
                  }`}>
                    {passed && valid ? <CheckCircle2 size={14} /> : idx + 1}
                  </div>
                  <Icon size={14} />
                  <span className="text-xs md:text-sm font-medium">{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 ${passed ? "bg-success/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* تنبيهات ذكية */}
      {smartWarnings.length > 0 && (
        <Card className="p-3 border-warning/30 bg-warning/5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
            <div className="space-y-1 flex-1">
              {smartWarnings.map((w, i) => (
                <div key={i} className="text-xs md:text-sm text-warning-foreground/90">{w}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* تعبئة تلقائية بالذكاء الاصطناعي من ملف المطالبة (PDF أو صورة) */}
      <Card className="p-3 md:p-4 bg-gradient-to-l from-primary/5 to-transparent border-primary/30">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs md:text-sm">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              ⚡ تعبئة سريعة بالذكاء الاصطناعي
            </div>
            <div className="text-muted-foreground mt-0.5">
              ارفع ملف المطالبة، تقرير الشرطة، أو صورة المَلكية — سنملأ كل الحقول تلقائياً (PDF/JPG/PNG)
            </div>
          </div>
          <AiExtractButton
            schema="insurance_claim"
            label="استخراج من مستند"
            onExtracted={(d) => {
              const patch: Partial<Draft> = {};
              if (d.insurance_company) patch.company = d.insurance_company;
              if (d.claim_number) patch.claimNumber = d.claim_number;
              if (d.owner_name) patch.ownerName = d.owner_name;
              if (d.owner_phone) patch.ownerPhone = d.owner_phone;
              if (d.plate) patch.vehiclePlate = d.plate;
              if (d.make) patch.vehicleMake = d.make;
              if (d.model) patch.vehicleModel = d.model;
              if (d.year) patch.vehicleYear = d.year;
              if (d.color) patch.vehicleColor = d.color;
              if (d.vin) patch.vehicleVin = d.vin;
              if (d.incident_date) patch.incidentDate = d.incident_date;
              if (d.damage_description) patch.damageDescription = d.damage_description;
              if (d.estimated_cost) patch.estimatedCost = d.estimated_cost;
              update(patch);
            }}
          />
        </div>
      </Card>

      {/* محتوى الخطوة */}
      <Card className="p-4 md:p-6 space-y-4">
        {step === 0 && (
          <Step0 draft={draft} update={update} generateClaimNumber={generateClaimNumber} companies={companies} />
        )}
        {step === 1 && (
          <Step1 draft={draft} update={update} existingCustomerByPhone={existingCustomerByPhone} />
        )}
        {step === 2 && (
          <Step2 draft={draft} update={update} />
        )}
        {step === 3 && (
          <Step3
            draft={draft}
            update={update}
            uplTotal={uplTotal}
            finalEstimate={finalEstimate}
            vatAmount={vatAmount}
            finalWithVat={finalWithVat}
          />
        )}
        {step === 4 && (
          <Step4
            draft={draft}
            finalEstimate={finalEstimate}
            vatAmount={vatAmount}
            finalWithVat={finalWithVat}
            goTo={setStep}
          />
        )}
      </Card>

      {/* أزرار التنقل */}
      <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            <ArrowRight size={14} /> السابق
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(emptyDraft());
              clearStoredDraft();
              setSavedDraftAt(null);
              setStep(0);
              toast.info("تم تفريغ النموذج");
            }}
          >
            <Trash2 size={14} /> تفريغ النموذج
          </Button>
        </div>

        {step < 4 ? (
          <Button onClick={goNext}>
            التالي <ArrowLeft size={14} />
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => trySubmit("save_and_new")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              حفظ + جديدة
            </Button>
            <Button
              variant="outline"
              onClick={() => trySubmit("save")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              حفظ والعودة للقائمة
            </Button>
            <Button
              onClick={() => trySubmit("save_and_open")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <BadgeCheck size={14} />}
              حفظ وفتح المطالبة
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────── الخطوة 0: شركة التأمين ─────────────────────
function Step0({ draft, update, generateClaimNumber, companies }: { draft: Draft; update: (p: Partial<Draft>) => void; generateClaimNumber: () => void; companies: any[] }) {
  const co = companies.find((c) => c.id === draft.companyId);
  return (
    <div className="space-y-5">
      <SectionHeader icon={Building2} title="شركة التأمين (الجهة الدافعة)" desc="من هي الشركة التي ستدفع لك فاتورة الإصلاح؟" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>شركة التأمين *</Label>
          <InsuranceCompanyAutocomplete
            value={draft.company}
            companyId={draft.companyId}
            onChange={(name, id) => update({ company: name, companyId: id })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>رقم المطالبة *</Label>
          <div className="flex gap-2">
            <Input
              value={draft.claimNumber}
              onChange={(e) => update({ claimNumber: e.target.value })}
              placeholder="من شركة التأمين أو ولّد رقماً مؤقتاً"
              dir="ltr"
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={generateClaimNumber} title="توليد رقم مؤقت">
              <Wand2 size={14} />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">أدخل الرقم الذي تعطيه لك شركة التأمين، أو ولّد رقماً مؤقتاً ريثما يصلك.</p>
        </div>
      </div>

      {co && (
        <Card className="p-3 bg-muted/40 border-muted">
          <div className="text-xs font-semibold mb-2 flex items-center gap-1">
            <FileText size={13} className="text-primary" /> معلومات سداد الشركة
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div><span className="text-muted-foreground">مدة السداد:</span> <span className="font-semibold">{co.payment_terms_days} يوم</span></div>
            {co.contact_person && <div><span className="text-muted-foreground">المسؤول:</span> <span className="font-semibold">{co.contact_person}</span></div>}
            {co.phone && <div dir="ltr" className="text-left"><span className="text-muted-foreground">هاتف:</span> <span className="font-semibold">{co.phone}</span></div>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ───────────────────── الخطوة 1: السيارة والعميل ─────────────────────
function Step1({
  draft,
  update,
  existingCustomerByPhone,
}: {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  existingCustomerByPhone: { id: string; name: string; phone: string | null } | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!pickerOpen) return;
    (async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model, year, color, customer_id, customers(name, phone)")
        .order("created_at", { ascending: false })
        .limit(200);
      setVehicles((data as any[]) || []);
    })();
  }, [pickerOpen]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return vehicles.slice(0, 50);
    return vehicles
      .filter((v) =>
        [v.plate_number, v.brand, v.model, v.customers?.name, v.customers?.phone]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(t)),
      )
      .slice(0, 50);
  }, [search, vehicles]);

  function pickVehicle(v: any) {
    update({
      vehicleId: v.id,
      customerId: v.customer_id || draft.customerId,
      vehicleMake: v.brand || "",
      vehicleModel: v.model || "",
      vehiclePlate: v.plate_number || "",
      vehicleYear: v.year ? String(v.year) : "",
      vehicleColor: v.color || "",
      ownerName: v.customers?.name || draft.ownerName,
      ownerPhone: v.customers?.phone || draft.ownerPhone,
    });
    setPickerOpen(false);
    toast.success("تم ربط المركبة");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionHeader icon={Car} title="السيارة والمالك" desc="بيانات السيارة المستلمة، ومالكها لتسليمها له بعد الإصلاح" />
        <Button type="button" variant={draft.vehicleId ? "outline" : "default"} size="sm" onClick={() => setPickerOpen(true)}>
          <Car size={14} className="ml-1" />
          {draft.vehicleId ? "تغيير المركبة المرتبطة" : "ربط مركبة موجودة *"}
        </Button>
      </div>

      {draft.vehicleId ? (
        <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-success" />
            <span className="font-semibold">مركبة مرتبطة:</span>
            <span className="font-mono" dir="ltr">{draft.vehiclePlate}</span>
            <span className="text-muted-foreground">— {draft.vehicleMake} {draft.vehicleModel}</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => update({ vehicleId: null })}>
            <X size={12} className="ml-1" /> إلغاء الربط
          </Button>
        </div>
      ) : draft.vehicleMake && draft.vehicleModel && draft.vehiclePlate ? (
        <div className="rounded-lg border border-info/40 bg-info/5 p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-info" />
            <span>بيانات السيارة جاهزة — ستُنشأ المركبة تلقائياً عند حفظ المطالبة، أو اضغط «حفظ السيارة الآن» لإنشائها فوراً.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                if (!draft.customerId) throw new Error("اضغط Use Existing Customer أو احفظ المطالبة لإنشاء العميل أولاً");
                const existing = await findExistingVehicle({
                  plate: draft.vehiclePlate,
                  vin: draft.vehicleVin,
                  make: draft.vehicleMake,
                  model: draft.vehicleModel,
                  year: draft.vehicleYear,
                  color: draft.vehicleColor,
                });
                if (existing?.id) {
                  const needsConfirmation =
                    existing.source === "vin" ||
                    (!!existing.customer_id && existing.customer_id !== draft.customerId);
                  if (needsConfirmation) {
                    const ok = window.confirm(
                      existing.customer_id && existing.customer_id !== draft.customerId
                        ? "هذه المركبة موجودة ومرتبطة بعميل آخر. هل تريد ربطها بدون تغيير المالك؟"
                        : "تم العثور على مركبة بالـ VIN فقط. هل تؤكد ربطها؟",
                    );
                    if (!ok) return;
                  }
                  update({ vehicleId: existing.id });
                  toast.success("ربط مع مركبة موجودة");
                  return;
                }
                const resolved = await ensureVehicleForCustomer({
                  customerId: draft.customerId,
                  plate: draft.vehiclePlate,
                  vin: draft.vehicleVin,
                  make: draft.vehicleMake,
                  model: draft.vehicleModel,
                  year: draft.vehicleYear,
                  color: draft.vehicleColor,
                });
                update({ vehicleId: resolved.vehicleId });
                toast.success("تم حفظ السيارة وربطها");
              } catch (e: any) {
                toast.error(e?.message ?? "فشل حفظ السيارة");
              }
            }}
          >
            <Save size={12} className="ml-1" /> حفظ السيارة الآن
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning-foreground/80">
          ⚠ اختر مركبة موجودة من «ربط مركبة موجودة»، أو أدخل (الماركة + الموديل + اللوحة) أدناه وستُنشأ تلقائياً عند حفظ المطالبة.
        </div>
      )}

      <VehicleMakeModelPicker
        make={draft.vehicleMake}
        model={draft.vehicleModel}
        plate={draft.vehiclePlate}
        year={draft.vehicleYear}
        color={draft.vehicleColor}
        vin={draft.vehicleVin}
        onChange={(patch) => update({
          vehicleId: null, // أي تعديل يدوي يُفصل الربط
          vehicleMake: patch.make ?? draft.vehicleMake,
          vehicleModel: patch.model ?? draft.vehicleModel,
          vehiclePlate: patch.plate ?? draft.vehiclePlate,
          vehicleYear: patch.year ?? draft.vehicleYear,
          vehicleColor: patch.color ?? draft.vehicleColor,
          vehicleVin: patch.vin ?? draft.vehicleVin,
        })}
      />

      <div className="border-t pt-4 mt-4">
        <SectionHeader icon={Phone} title="مالك السيارة (لتسليمها)" desc="بيانات صاحب السيارة لاستلامها بعد الإصلاح" small />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <div className="space-y-1.5">
            <Label>اسم المالك</Label>
            <Input
              value={draft.ownerName}
              onChange={(e) => update({ ownerName: e.target.value })}
              placeholder="الاسم الكامل"
            />
          </div>
          <div className="space-y-1.5">
            <Label>هاتف المالك</Label>
            <Input
              value={draft.ownerPhone}
              onChange={(e) => update({ ownerPhone: e.target.value })}
              onBlur={() => update({ ownerPhone: toE164(draft.ownerPhone) })}
              placeholder="+968 9XXX XXXX"
              dir="ltr"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Truck size={13} /> تاريخ التسليم المتوقع</Label>
            <Input
              type="date"
              value={draft.expectedDeliveryDate}
              onChange={(e) => update({ expectedDeliveryDate: e.target.value })}
            />
          </div>
        </div>
        {existingCustomerByPhone && draft.customerId !== existingCustomerByPhone.id && (
          <div className="mt-3 rounded-lg border border-info/40 bg-info/5 p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">Use Existing Customer</div>
              <div className="text-muted-foreground">
                {existingCustomerByPhone.name} — <span dir="ltr">{existingCustomerByPhone.phone}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update({
                customerId: existingCustomerByPhone.id,
                ownerName: existingCustomerByPhone.name,
                ownerPhone: existingCustomerByPhone.phone || draft.ownerPhone,
              })}
            >
              Use Existing Customer
            </Button>
          </div>
        )}
      </div>

      {/* Vehicle picker dialog */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold"><Car size={16} className="text-primary" /> اختر مركبة من قاعدة البيانات</div>
              <Button variant="ghost" size="icon" onClick={() => setPickerOpen(false)}><X size={14} /></Button>
            </div>
            <div className="p-3 border-b border-border">
              <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث برقم اللوحة أو الماركة أو اسم المالك..." />
            </div>
            <div className="overflow-auto flex-1 divide-y divide-border">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  لا توجد مركبات. أغلق هذه النافذة وأدخل بياناتها يدوياً، أو سجّلها أولاً من صفحة المركبات.
                </div>
              ) : filtered.map((v) => (
                <button key={v.id} className="w-full text-right p-3 hover:bg-secondary/50 transition flex items-center justify-between gap-3" onClick={() => pickVehicle(v)}>
                  <div>
                    <div className="font-mono text-sm" dir="ltr">{v.plate_number}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{v.brand} {v.model} {v.year ? `• ${v.year}` : ""}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{v.customers?.name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────── الخطوة 2: وصف الضرر ─────────────────────
function Step2({ draft, update }: { draft: Draft; update: (p: Partial<Draft>) => void }) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={AlertTriangle} title="وصف الضرر" desc="ما الذي يحتاج إصلاحه في السيارة؟" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1"><CalendarClock size={13} /> تاريخ التقدير *</Label>
          <Input
            type="date"
            value={draft.incidentDate}
            onChange={(e) => update({ incidentDate: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground">اليوم الذي استلمت فيه السيارة في الكراج.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>وصف الضرر / الأعمال المطلوبة</Label>
          <AiWriteButton
            value={draft.damageDescription}
            onChange={(t) => update({ damageDescription: t })}
            context={`مطالبة تأمين - سيارة ${draft.vehicleMake || ""} ${draft.vehicleModel || ""} لوحة ${draft.vehiclePlate || ""}`}
            placeholder="مثال: حادث أمامي، يحتاج صدام ورفرف وصباغة"
          />
        </div>
        <Textarea
          value={draft.damageDescription}
          onChange={(e) => update({ damageDescription: e.target.value })}
          placeholder="مثال: صدمة في الواجهة الأمامية - يحتاج استبدال صدام + رفرف أيمن + صباغة..."
          rows={5}
        />
      </div>

      <Card className="p-3 bg-info/5 border-info/20">
        <div className="flex items-start gap-2 text-xs">
          <Camera size={14} className="text-info mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-info">نصيحة</div>
            <div className="text-muted-foreground mt-0.5">
              صور قبل/بعد ومستندات الفحص يمكن رفعها بعد حفظ المطالبة من صفحة التفاصيل.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}



// ───────────────────── الخطوة 3: التسعير ─────────────────────
function Step3({
  draft, update, uplTotal, finalEstimate, vatAmount, finalWithVat,
}: {
  draft: Draft; update: (p: Partial<Draft>) => void;
  uplTotal: number; finalEstimate: number; vatAmount: number; finalWithVat: number;
}) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={Calculator} title="تسعير الكراج" desc="السعر الذي ستطالب به شركة التأمين" />

      {/* نوع التقدير — أزرار مقطّعة (Segmented) واضحة وقابلة للتبديل */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">طريقة التسعير</Label>
        <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted border">
          <button
            type="button"
            onClick={() => update({ estimationType: "lump_sum" })}
            className={`px-4 py-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-0.5 ${
              draft.estimationType === "lump_sum"
                ? "bg-background shadow text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>مبلغ إجمالي (Lump Sum)</span>
            <span className="text-[10px] font-normal opacity-70">رقم واحد للمطالبة</span>
          </button>
          <button
            type="button"
            onClick={() => update({ estimationType: "upl" })}
            className={`px-4 py-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-0.5 ${
              draft.estimationType === "upl"
                ? "bg-background shadow text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>تسعير بالبنود (UPL)</span>
            <span className="text-[10px] font-normal opacity-70">قائمة أسعار موحّدة بالتفصيل</span>
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          يمكنك التبديل بين الطريقتين الآن أو لاحقاً عند تعديل المطالبة.
        </p>
      </div>

      {draft.estimationType === "upl" ? (
        <UplItemsEditor items={draft.uplItems} onChange={(items) => update({ uplItems: items })} />
      ) : (
        <div className="space-y-1.5">
          <Label>المبلغ المطالب به (ر.ع) *</Label>
          <Input
            type="number"
            value={draft.estimatedCost}
            onChange={(e) => update({ estimatedCost: e.target.value })}
            placeholder="0.000"
            inputMode="decimal"
            dir="ltr"
          />
        </div>
      )}

      {/* ملخص المطالبة لشركة التأمين */}
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 space-y-2">
        <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
          <Calculator size={13} /> الإجمالي المطالب به من شركة التأمين
        </div>
        <Row label="المجموع قبل الضريبة" value={finalEstimate} />
        <Row label="ضريبة القيمة المضافة (5%)" value={vatAmount} />
        <Row label="إجمالي الفاتورة" value={finalWithVat} bold />
      </Card>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>ملاحظات</Label>
          <AiWriteButton
            value={draft.notes}
            onChange={(t) => update({ notes: t })}
            context="ملاحظات داخلية للمطالبة"
          />
        </div>
        <Textarea
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="أي ملاحظات للأرشيف الداخلي..."
          rows={3}
        />
      </div>
    </div>
  );
}

// ───────────────────── الخطوة 4: المراجعة ─────────────────────
function Step4({
  draft, finalEstimate, vatAmount, finalWithVat, goTo,
}: {
  draft: Draft; finalEstimate: number; vatAmount: number; finalWithVat: number;
  goTo: (s: Step) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader icon={ClipboardList} title="مراجعة نهائية" desc="راجع البيانات قبل الحفظ. اضغط على أي قسم لتعديله" />

      <ReviewBlock title="شركة التأمين" icon={Building2} onEdit={() => goTo(0)}>
        <KV k="الشركة" v={draft.company} />
        <KV k="رقم المطالبة" v={draft.claimNumber} ltr />
      </ReviewBlock>

      <ReviewBlock title="السيارة والمالك" icon={Car} onEdit={() => goTo(1)}>
        <KV k="السيارة" v={`${draft.vehicleMake} ${draft.vehicleModel} ${draft.vehicleYear ? `(${draft.vehicleYear})` : ""}`} />
        <KV k="اللوحة" v={draft.vehiclePlate} ltr />
        <KV k="اللون" v={draft.vehicleColor || "—"} />
        <KV k="المالك" v={draft.ownerName || "—"} />
        <KV k="هاتف المالك" v={draft.ownerPhone || "—"} ltr />
        <KV k="التسليم المتوقع" v={draft.expectedDeliveryDate || "—"} ltr />
      </ReviewBlock>

      <ReviewBlock title="الضرر" icon={AlertTriangle} onEdit={() => goTo(2)}>
        <KV k="تاريخ التقدير" v={draft.incidentDate} ltr />
        <KV k="الوصف" v={draft.damageDescription || "—"} full />
      </ReviewBlock>

      <ReviewBlock title="المطالبة لشركة التأمين" icon={Calculator} onEdit={() => goTo(3)}>
        <KV k="نوع التسعير" v={draft.estimationType === "upl" ? "بنود UPL" : "مبلغ إجمالي"} />
        {draft.estimationType === "upl" && (
          <KV k="عدد البنود" v={String(draft.uplItems.length)} ltr />
        )}
        <KV k="المجموع" v={`${toEnglishDigits(finalEstimate.toFixed(3))} OMR`} ltr />
        <KV k="الضريبة (5%)" v={`${toEnglishDigits(vatAmount.toFixed(3))} OMR`} ltr />
        <KV k="إجمالي الفاتورة" v={`${toEnglishDigits(finalWithVat.toFixed(3))} OMR`} ltr highlight />
      </ReviewBlock>

      <Card className="p-4 bg-success/5 border-success/30 flex items-start gap-3">
        <CheckCircle2 className="text-success mt-0.5 shrink-0" size={20} />
        <div className="text-sm">
          <div className="font-semibold text-success">جاهزة للحفظ</div>
          <div className="text-xs text-muted-foreground mt-1">
            ستُحفظ بحالة "بانتظار الاعتماد". بعد الحفظ يمكنك رفع صور قبل/بعد، إصدار فاتورة، وتتبع التحصيل من شركة التأمين.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────── مكونات مساعدة ─────────────────────
function SectionHeader({ icon: Icon, title, desc, small }: { icon: any; title: string; desc?: string; small?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`rounded-lg bg-primary/10 text-primary flex items-center justify-center ${small ? "h-8 w-8" : "h-10 w-10"}`}>
        <Icon size={small ? 15 : 18} />
      </div>
      <div>
        <h3 className={`font-bold ${small ? "text-sm" : "text-base md:text-lg"}`}>{title}</h3>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function Row({ label, value, bold, success }: { label: string; value: number; bold?: boolean; success?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? "font-bold pt-1 border-t border-primary/20" : ""} ${success ? "text-success font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span dir="ltr" className="font-mono">{toEnglishDigits(value.toFixed(3))} OMR</span>
    </div>
  );
}

function ReviewBlock({ title, icon: Icon, onEdit, children }: { title: string; icon: any; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-primary" />
          <h4 className="text-sm font-semibold">{title}</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>تعديل</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
        {children}
      </div>
    </Card>
  );
}

function KV({ k, v, ltr, full, highlight }: { k: string; v: string; ltr?: boolean; full?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between text-xs gap-2 ${full ? "md:col-span-2" : ""}`}>
      <span className="text-muted-foreground shrink-0">{k}:</span>
      <span
        dir={ltr ? "ltr" : undefined}
        className={`font-medium text-right truncate ${highlight ? "text-primary font-bold" : "text-foreground"}`}
      >
        {v}
      </span>
    </div>
  );
}
