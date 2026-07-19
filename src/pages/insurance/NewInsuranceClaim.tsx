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
import InsuranceEmployeeSelect from "@/components/insurance/InsuranceEmployeeSelect";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import UplItemsEditor, { DEFAULT_UPL_ITEMS, type UplItem } from "@/components/insurance/UplItemsEditor";
import AiExtractButton from "@/components/ai/AiExtractButton";
import AiWriteButton from "@/components/ai/AiWriteButton";
import { toEnglishDigits } from "@/lib/numberUtils";
import { useAuth } from "@/contexts/AuthContext";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import { ensureVehicleForCustomer, findExistingVehicle, type VehicleIdentityMatch } from "@/lib/vehicleIdentity";
import { isUuid } from "@/lib/uuid";
import { toE164 } from "@/lib/phoneUtils";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";

// إنشاء/ربط المركبة يتم مركزياً داخل useCreateClaim
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط£ظ†ظˆط§ط¹ ط¯ط§ط®ظ„ظٹط© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// âڑ ï¸ڈ ظ‡ط°ظ‡ ط§ظ„طµظپط­ط© ظ…ظ† ظ…ظ†ط¸ظˆط± "ط§ظ„ظƒط±ط§ط¬": ظ†ط³طھظ„ظ… ط³ظٹط§ط±ط© ظ…ظ† ط´ط±ظƒط© طھط£ظ…ظٹظ† ظˆظ†ط·ط§ظ„ط¨ظ‡ط§ ط¨ط§ظ„ظ…ط³طھط­ظ‚ط§طھ.
// ظ„ط§ ظ†ظڈطµط¯ط± ط¨ظˆط§ظ„طµ ظˆظ„ط§ ظ†طھط¹ط§ظ…ظ„ ظ…ط¹ ظ…ط®ظ…ظ‘ظ† ط¯ط§ط®ظ„ظٹ â€” ظƒظ„ ط°ظ„ظƒ ظ…ظ† ط§ط®طھطµط§طµ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†.
type Step = 0 | 1 | 2 | 3 | 4;

interface Draft {
  // company (ظ…ظژظ† ط³ظ†ط¯ظپط¹ ظ„ظ‡ ط§ظ„ظپط§طھظˆط±ط©)
  company: string;
  companyId: string | null;
  insuranceEmployeeId: string | null;
  claimNumber: string;     // ط§ظ„ط±ظ‚ظ… ط§ظ„ط°ظٹ طھط¹ط·ظٹظ‡ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ط£ظˆ ظ†ظˆظ„ظ‘ط¯ظ‡ ظ…ط¤ظ‚طھط§ظ‹
  // owner (طµط§ط­ط¨ ط§ظ„ط³ظٹط§ط±ط© ظ„طھط³ظ„ظٹظ…ظ‡ط§ ظ„ظ‡ ط¨ط¹ط¯ ط§ظ„ط¥طµظ„ط§ط­)
  customerId: string | null;
  ownerName: string;
  ownerPhone: string;
  expectedDeliveryDate: string; // طھط§ط±ظٹط® ط§ظ„طھط³ظ„ظٹظ… ط§ظ„ظ…طھظˆظ‚ط¹ ظ„ظ„ط¹ظ…ظٹظ„
  // vehicle
  vehicleId: string | null; // ط±ط¨ط· ط¨ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط© ظپظٹ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleYear: string;
  vehicleColor: string;
  vehicleVin: string;
  // incident / damage description (ظˆطµظپ ط§ظ„ط¶ط±ط± ظپظ‚ط· â€” ظ„ط§ ظ†ط­طھط§ط¬ ظ…ظˆظ‚ط¹ ط§ظ„ط­ط§ط¯ط«)
  incidentDate: string;
  damageDescription: string;
  // estimation (طھط³ط¹ظٹط±ظ†ط§ ظ†ط­ظ† ط§ظ„ظƒط±ط§ط¬ â€” ظ‚ط§ط¨ظ„ ظ„ظ„طھط¨ط¯ظٹظ„ ط¨ظٹظ† ط¥ط¬ظ…ط§ظ„ظٹ ظˆط¨ظ†ظˆط¯)
  estimationType: "auto" | "lump_sum" | "upl";
  estimatedCost: string;     // ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط·ط§ظ„ط¨ ط¨ظ‡ (lump sum)
  uplItems: UplItem[];       // ط§ظ„ط¨ظ†ظˆط¯ ط§ظ„طھظپطµظٹظ„ظٹط© (UPL)
  // misc
  notes: string;
}

const STEPS: { key: Step; label: string; icon: any }[] = [
  { key: 0, label: "ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†", icon: Building2 },
  { key: 1, label: "ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ط¹ظ…ظٹظ„", icon: Car },
  { key: 2, label: "ظˆطµظپ ط§ظ„ط¶ط±ط±", icon: AlertTriangle },
  { key: 3, label: "طھط³ط¹ظٹط± ط§ظ„ظƒط±ط§ط¬", icon: Calculator },
  { key: 4, label: "ط§ظ„ظ…ط±ط§ط¬ط¹ط©", icon: CheckCircle2 },
];

const DRAFT_KEY = "insurance_claim_draft_v3"; // bumped: removed internal-cost & templates

const emptyDraft = (): Draft => ({
  company: "", companyId: null, claimNumber: "",
  insuranceEmployeeId: null,
  customerId: null, ownerName: "", ownerPhone: "", expectedDeliveryDate: "",
  vehicleId: null, vehicleMake: "", vehicleModel: "", vehiclePlate: "", vehicleYear: "", vehicleColor: "", vehicleVin: "",
  incidentDate: new Date().toISOString().slice(0, 10),
  damageDescription: "",
  estimationType: "auto", estimatedCost: "",
  uplItems: [],
  notes: "",
});

const formatVehiclePlateForClaim = (vehicle: {
  plate_letters?: string | null;
  plate_number?: string | null;
}) => [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || vehicle.plate_number || "";

async function resolveTenantForClaim(): Promise<string> {
  const tenantId = await getCurrentTenantId();
  if (tenantId && isUuid(tenantId)) return tenantId;
  const { data, error } = await supabase.rpc("get_user_tenant_id");
  if (error) throw new Error("Tenant was not loaded. Please refresh and try again.");
  if (!data || !isUuid(String(data))) throw new Error("Tenant was not loaded. Please refresh and try again.");
  return String(data);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ظ…ظƒظˆظ† ط§ظ„ط±ط¦ظٹط³ظٹ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ظ…ط³ظˆط¯ط© â”€â”€
  useEffect(() => {
    let cancelled = false;
    draftHydratedRef.current = false;
    const shouldResumeDraft = params.get("resumeDraft") === "1" || params.get("draft") === "1";

    const applyDraft = (stored: { savedAt: number; data: Draft } | null) => {
      if (!stored?.savedAt || Date.now() - stored.savedAt >= 1000 * 60 * 60 * 24 * 3) return;
      if (stored.savedAt <= (savedDraftAtRef.current || 0)) return;
      setDraft({ ...emptyDraft(), ...stored.data });
      setSavedDraftAt(stored.savedAt);
      savedDraftAtRef.current = stored.savedAt;
    };

    void (async () => {
      if (!shouldResumeDraft) {
        const c = params.get("company");
        skipNextDraftSaveRef.current = true;
        savedDraftAtRef.current = null;
        setSavedDraftAt(null);
        setDraft({ ...emptyDraft(), company: c || "" });
        await writeCloudSetting(cloudDraftKey, null).catch(() => {});
        if (!cancelled) draftHydratedRef.current = true;
        return;
      }

      const cloudDraft = await readCloudSetting<{ savedAt: number; data: Draft } | null>(cloudDraftKey, null);
      if (cancelled) return;
      applyDraft(cloudDraft);

      const c = params.get("company");
      if (c) setDraft((current) => ({ ...current, company: c }));
      draftHydratedRef.current = true;
    })();

    const unsubscribe = shouldResumeDraft
      ? subscribeCloudSetting<{ savedAt: number; data: Draft } | null>(
          cloudDraftKey,
          (stored) => {
            if (!cancelled) applyDraft(stored);
          },
        )
      : () => {};

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cloudDraftKey, params]);

  // â”€â”€ ط­ظپط¸ ط§ظ„ظ…ط³ظˆط¯ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ â”€â”€
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      const savedAt = Date.now();
      const payload = { savedAt, data: draft };
      void writeCloudSetting(cloudDraftKey, payload).catch(() => {});
      savedDraftAtRef.current = savedAt;
      setSavedDraftAt(savedAt);
    }, 600);
    return () => clearTimeout(t);
  }, [cloudDraftKey, draft]);

  const clearStoredDraft = () => {
    skipNextDraftSaveRef.current = true;
    savedDraftAtRef.current = null;
    setSavedDraftAt(null);
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
        const tenantId = await getCurrentTenantId();
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

  // â”€â”€ طھظˆظ„ظٹط¯ ط±ظ‚ظ… ظ…ط±ط¬ط¹ظٹ ظ…ط¤ظ‚طھ ظ„ظ„ظƒط±ط§ط¬ â”€â”€
  const generateClaimNumber = () => {
    const yr = new Date().getFullYear();
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    update({ claimNumber: `CLM-${yr}-${seq}` });
  };

  // â”€â”€ ط­ط³ط§ط¨ط§طھ â”€â”€
  const uplTotal = useMemo(
    () => draft.uplItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0),
    [draft.uplItems]
  );
  const finalEstimate = draft.estimationType === "upl" ? uplTotal : parseMoneyInput(draft.estimatedCost);
  const vatAmount = finalEstimate * 0.05;
  const finalWithVat = finalEstimate + vatAmount;

  // â”€â”€ طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ ط®ط·ظˆط© â”€â”€
  const stepValid = (s: Step): boolean => {
    switch (s) {
      case 0: return !!draft.company.trim() && !!draft.claimNumber.trim();
      // ظٹظƒظپظٹ ط¥ط¯ط®ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ط£ط³ط§ط³ظٹط© ظٹط¯ظˆظٹط§ظ‹ (ط³طھظڈظ†ط´ط£ ط§ظ„ظ…ط±ظƒط¨ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¹ظ†ط¯ ط§ظ„ط­ظپط¸)
      case 1: return !!(
        draft.vehicleMake.trim() &&
        draft.vehicleModel.trim() &&
        draft.vehiclePlate.trim() &&
        (draft.customerId || draft.ownerName.trim())
      );
      case 2: return !!draft.incidentDate;
      case 3: return draft.estimationType === "upl" ? draft.uplItems.length > 0 && uplTotal > 0 : parseMoneyInput(draft.estimatedCost) > 0;
      case 4: return true;
      default: return false;
    }
  };

  const canNext = stepValid(step);
  const allValid = stepValid(0) && stepValid(1) && stepValid(2) && stepValid(3);

  // ط±ط³ط§ظ„ط© طھظˆط¶ظٹط­ظٹط© طھط´ط±ط­ ط³ط¨ط¨ ط¹ط¯ظ… ط§ظƒطھظ…ط§ظ„ ط®ط·ظˆط© ظ…ط¹ظٹظ†ط©
  const stepMissingMsg = (s: Step): string | null => {
    switch (s) {
      case 0: {
        const miss: string[] = [];
        if (!draft.company.trim()) miss.push("ط§ط³ظ… ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†");
        if (!draft.claimNumber.trim()) miss.push("ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©");
        return miss.length ? `ط£ظƒظ…ظ„: ${miss.join(" ظˆ ")}` : null;
      }
      case 1: {
        const miss: string[] = [];
        if (!draft.vehicleMake.trim()) miss.push("ط§ظ„ظ…ط§ط±ظƒط©");
        if (!draft.vehicleModel.trim()) miss.push("ط§ظ„ظ…ظˆط¯ظٹظ„");
        if (!draft.vehiclePlate.trim()) miss.push("ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط©");
        if (!draft.customerId && !draft.ownerName.trim()) miss.push("ط§ط³ظ… ط§ظ„ظ…ط§ظ„ظƒ ط£ظˆ ط§ط®طھظٹط§ط± ط¹ظ…ظٹظ„ ظ…ظˆط¬ظˆط¯");
        return miss.length ? `ط£ظƒظ…ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ظ…ط§ظ„ظƒ: ${miss.join("طŒ ")}` : null;
      }
      case 2: return draft.incidentDate ? null : "ط­ط¯ط¯ طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹط±";
      case 3: return draft.estimationType === "upl"
        ? (draft.uplItems.length > 0 && uplTotal > 0 ? null : "ط£ط¶ظپ ط¨ظ†ظˆط¯ ط§ظ„طھط³ط¹ظٹط± ط¨ظ‚ظٹظ… طµط­ظٹط­ط©")
        : (parseMoneyInput(draft.estimatedCost) > 0 ? null : "ط£ط¯ط®ظ„ ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط·ط§ظ„ط¨ ط¨ظ‡");
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

  // â”€â”€ طھظ†ط¨ظٹظ‡ط§طھ ط°ظƒظٹط© â”€â”€
  const smartWarnings = useMemo(() => {
    const w: string[] = [];
    if (draft.claimNumber && draft.claimNumber.length < 5)
      w.push("â„¹ï¸ڈ ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ‚طµظٹط±طŒ ظٹظپط¶ظ‘ظ„ ط£ظ† ظٹظƒظˆظ† ظƒط§ظ…ظ„ط§ظ‹ ظƒظ…ط§ طھط¹ط·ظٹظ‡ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†.");
    if (finalEstimate > 3000)
      w.push("ًں’° ظ…ط¨ظ„ط؛ ظ…ط±طھظپط¹ â€” طھط£ظƒط¯ ظ…ظ† طھظˆط«ظٹظ‚ ط§ظ„طµظˆط± ظ‚ط¨ظ„/ط¨ط¹ط¯ ظ„ط¥ط«ط¨ط§طھ ط§ظ„ط¥طµظ„ط§ط­.");
    if (draft.companyId) {
      const co = companies.find((c) => c.id === draft.companyId);
      if (co && co.payment_terms_days >= 60)
        w.push(`âڈ³ ظ…ط¯ط© ط³ط¯ط§ط¯ ظ‡ط°ظ‡ ط§ظ„ط´ط±ظƒط© ${co.payment_terms_days} ظٹظˆظ…ط§ظ‹ â€” طھط£ظƒط¯ ظ…ظ† ط§ظ„ط³ظٹظˆظ„ط©.`);
    }
    return w;
  }, [draft, finalEstimate, companies]);

  // â”€â”€ ط¥ط±ط³ط§ظ„ â”€â”€
  const handleSubmit = async (action: "save" | "save_and_open" | "save_and_new") => {
    if (!allValid) {
      toast.error("ط§ظ„ط±ط¬ط§ط، ط§ط³طھظƒظ…ط§ظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط·ظ„ظˆط¨ط© ظپظٹ ط¬ظ…ظٹط¹ ط§ظ„ط®ط·ظˆط§طھ");
      return;
    }
    setSubmitting(true);
    try {
      const tenantId = await resolveTenantForClaim();
      if (!tenantId) throw new Error("ظ„ط§ ظٹظ…ظƒظ† طھط­ط¯ظٹط¯ ط§ظ„ظ…ط³طھط£ط¬ط±");

      // ظپط­طµ طھظƒط±ط§ط± ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ط¯ط§ط®ظ„ ظ†ظپط³ ط§ظ„ظˆط±ط´ط© ظپظ‚ط·.
      const cn = draft.claimNumber.trim();
      const { data: existingClaim, error: existingClaimError } = await supabase
        .from("insurance_claims" as any)
        .select("id, claim_number, status, insurance_company, created_at")
        .eq("tenant_id", tenantId as string)
        .ilike("claim_number", cn)
        .limit(1)
        .maybeSingle();
      if (existingClaimError) throw existingClaimError;
      if ((existingClaim as any)?.id) {
        toast.warning("ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ ظ…ط³ط¨ظ‚ظ‹ط§. ط³ظٹطھظ… ظپطھط­ ط§ظ„ظ…ط·ط§ظ„ط¨ط© ط§ظ„ظ…ظˆط¬ظˆط¯ط©.");
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
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        customerRecord = (data as any) || null;
        if (!customerRecord) customerId = null;
      }
      if (!customerId) {
        const normalizedPhone = toE164(draft.ownerPhone);
        const phoneDigits = normalizedPhone.replace(/\D/g, "").slice(-8);
        if (phoneDigits) {
          const { data } = await supabase
            .from("customers")
            .select("id,name,phone")
            .eq("tenant_id", tenantId as string)
            .is("deleted_at", null)
            .ilike("phone", `%${phoneDigits}%`)
            .limit(5);
          const phoneMatch = ((data as any[]) || []).find((customer) =>
            toE164(customer.phone || "").replace(/\D/g, "").slice(-8) === phoneDigits
          );
          if (phoneMatch) {
            customerRecord = phoneMatch as any;
            customerId = customerRecord.id;
          }
        }
        if (!customerId) {
          const customerName = draft.ownerName.trim() || draft.company.trim();
          if (!customerName) throw new Error("ط§ط®طھط± ط¹ظ…ظٹظ„ظ‹ط§ ظ…ظˆط¬ظˆط¯ظ‹ط§ ط£ظˆ ط£ط¯ط®ظ„ ط§ط³ظ… ط§ظ„ظ…ط§ظ„ظƒ ط£ظˆ ط§ط³طھط®ط¯ظ… ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ظƒط¹ظ…ظٹظ„");

          const { data: sameNameRows } = await supabase
            .from("customers")
            .select("id,name,phone")
            .eq("tenant_id", tenantId as string)
            .is("deleted_at", null)
            .ilike("name", customerName)
            .limit(5);
          const sameName = ((sameNameRows as any[]) || []).find((customer) =>
            String(customer.name || "").trim().toLowerCase() === customerName.toLowerCase()
          );
          if (sameName) {
            customerRecord = sameName as any;
            customerId = customerRecord.id;
          } else {
            const { data: newCust, error: e1 } = await supabase
              .from("customers")
              .insert({
                tenant_id: tenantId as string,
                name: customerName,
                phone: normalizedPhone || null,
              } as any)
              .select("id,name,phone")
              .single();
            if (e1) throw e1;
            customerRecord = newCust as any;
            customerId = customerRecord.id;
          }
        }
      }



      const loadCustomerRecord = async (id: string | null) => {
        if (!id || !isUuid(id)) return null;
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,phone")
          .eq("tenant_id", tenantId as string)
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        return (data as any) || null;
      };

      let vehicleId = draft.vehicleId && isUuid(draft.vehicleId) ? draft.vehicleId : null;
      if (vehicleId) {
        const linkedVehicle = await findExistingVehicle({ vehicleId });
        if (!linkedVehicle?.id) {
          vehicleId = null;
        }
      }

      if (!vehicleId) {
        const vehicleCandidate = await findExistingVehicle({
          plate: draft.vehiclePlate,
          vin: draft.vehicleVin,
          make: draft.vehicleMake,
          model: draft.vehicleModel,
          year: draft.vehicleYear,
          color: draft.vehicleColor,
        });
        if (vehicleCandidate?.id) {
          vehicleId = vehicleCandidate.id;
        }
      }
      // ظ„ط§ طھظ†ط´ط¦ ط§ظ„ظ…ط±ظƒط¨ط© ظ‡ظ†ط§. ط¥ظ†ط´ط§ط،/ط±ط¨ط· ط§ظ„ظ…ط±ظƒط¨ط© ظٹطھظ… ظ…ط±ظƒط²ظٹط§ظ‹ ط¯ط§ط®ظ„ useCreateClaim ط¨ظ†ظپط³ tenant_id
      // ط­طھظ‰ ظ„ط§ ظٹط­ط¯ط« ط§ط®طھظ„ط§ظپ ط¨ظٹظ† tenant ط§ظ„طµظپط­ط© ظˆtenant resolver ط§ظ„ط®ط§ط±ط¬ظٹ.
      if (vehicleId) {
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
            "طھظ†ط¨ظٹظ‡: ظ†ظپط³ ط§ظ„ظ…ط±ظƒط¨ط© ظ„ط¯ظٹظ‡ط§ ظ…ط·ط§ظ„ط¨ط© ط£ط®ط±ظ‰ ط¨ط±ظ‚ظ… ظ…ط®طھظ„ظپ.",
            "",
            ...((sameVehicleClaims as any[]) || []).map((d) => `â€¢ ظ…ط·ط§ظ„ط¨ط© ${d.claim_number} â€” ${d.insurance_company || ""} (${d.status})`),
            "",
            "ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط© ظˆط¥ظ†ط´ط§ط، ظ…ط·ط§ظ„ط¨ط© ط¬ط¯ظٹط¯ط© ظ„ظ‡ط°ظ‡ ط§ظ„ظ…ط±ظƒط¨ط©طں",
          ].join("\n");
          if (!window.confirm(lines)) {
            setSubmitting(false);
            return;
          }
        }
      }



      // ظ…ظ„ط§ط­ط¸ط§طھ
      const internalNotes = [
        draft.notes,
        draft.expectedDeliveryDate ? `طھط§ط±ظٹط® ط§ظ„طھط³ظ„ظٹظ… ط§ظ„ظ…طھظˆظ‚ط¹: ${draft.expectedDeliveryDate}` : "",
      ].filter(Boolean).join("\n");

      const created: any = await createClaim.mutateAsync({
        tenant_id: tenantId as string,
        customer_id: customerId!,
        vehicle_id: vehicleId,
        claim_number: draft.claimNumber.trim(),
        insurance_company: draft.company.trim(),
        insurance_company_id: companyId && isUuid(companyId) ? companyId : null,
        insurance_employee_id: draft.insuranceEmployeeId && isUuid(draft.insuranceEmployeeId) ? draft.insuranceEmployeeId : null,
        estimated_amount: finalEstimate,
        approved_amount: 0,
        status: "pending",
        notes: internalNotes || undefined,
        incident_date: draft.incidentDate ? new Date(draft.incidentDate).toISOString() : null,
        // طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹط± ظ…ط³طھظ‚ظ„ ط¹ظ† ظˆطµظˆظ„ ط§ظ„ظ…ط±ظƒط¨ط©ط› ط§ظ„ظˆطµظˆظ„ ظˆط¨ط¯ط، ط§ظ„ط¹ظ…ظ„ ظٹظڈط³ط¬ظ„ط§ظ† ظپط¹ظ„ظٹظ‹ط§ ظ…ظ† طµظپط­ط© ط§ظ„ظ…ط·ط§ظ„ط¨ط©.
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
      if (e?.message === "claim_number_exists" && e?.existingClaimId) {
        const shouldOpen = window.confirm(
          e?.existingClaimInactive
            ? "ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ ظپظٹ ط³ط¬ظ„ ظ…ط­ط°ظˆظپ/ظ…ط¤ط±ط´ظپ. ظ‡ظ„ طھط±ظٹط¯ ظپطھط­ ط§ظ„ط³ط¬ظ„ ط§ظ„ظ…ظˆط¬ظˆط¯طں"
            : "ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ…ظˆط¬ظˆط¯ ظ…ط³ط¨ظ‚ظ‹ط§. ظ‡ظ„ طھط±ظٹط¯ ظپطھط­ ط§ظ„ط³ط¬ظ„ ط§ظ„ظ…ظˆط¬ظˆط¯طں",
        );
        if (shouldOpen) navigate(`/insurance/${e.existingClaimId}`);
        return;
      }
      if (String(e?.message || "").includes("vin_candidate_requires_user_confirmation")) {
        toast.error("طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ط±ظƒط¨ط© ظ…ط­طھظ…ظ„ط© ط¹ط¨ط± VIN ظپظ‚ط·. ط§ط±ط¨ط· ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط© ظٹط¯ظˆظٹظ‹ط§ ط£ظˆ ط£ظƒظ…ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ„ظˆط­ط© ظˆط§ظ„ط­ط±ظˆظپ ظˆط§ظ„ط¯ظˆظ„ط© ظ‚ط¨ظ„ ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط©.");
      } else {
        toast.error(e?.message ?? "ظپط´ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط·ط§ظ„ط¨ط©");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط¹ط±ط¶ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-4 md:space-y-6">
      {/* ط§ظ„ط¹ظ†ظˆط§ظ† */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Wrench className="text-primary" /> ظ…ط·ط§ظ„ط¨ط© ظƒط±ط§ط¬ ط¬ط¯ظٹط¯ط©
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            ط¥طµظ„ط§ط­ ط³ظٹط§ط±ط© ظ„ط´ط±ظƒط© طھط£ظ…ظٹظ† â€¢ {STEPS.length} ط®ط·ظˆط§طھ â€¢ ط­ظپط¸ طھظ„ظ‚ط§ط¦ظٹ ظ„ظ„ظ…ط³ظˆط¯ط©
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => smartBack(navigate, "/insurance/list")}>
            <X size={16} /> ط¥ظ„ط؛ط§ط،
          </Button>
          {savedDraftAt && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Save size={11} /> ظ…ط³ظˆط¯ط© ظ…ط­ظپظˆط¸ط©
            </Badge>
          )}
        </div>
      </div>


      {/* ط´ط±ظٹط· ط§ظ„ط®ط·ظˆط§طھ */}
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

      {/* طھظ†ط¨ظٹظ‡ط§طھ ط°ظƒظٹط© */}
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

      {/* طھط¹ط¨ط¦ط© طھظ„ظ‚ط§ط¦ظٹط© ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ ظ…ظ† ظ…ظ„ظپ ط§ظ„ظ…ط·ط§ظ„ط¨ط© (PDF ط£ظˆ طµظˆط±ط©) */}
      <Card className="p-3 md:p-4 bg-gradient-to-l from-primary/5 to-transparent border-primary/30">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs md:text-sm">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              âڑ، طھط¹ط¨ط¦ط© ط³ط±ظٹط¹ط© ط¨ط§ظ„ط°ظƒط§ط، ط§ظ„ط§طµط·ظ†ط§ط¹ظٹ
            </div>
            <div className="text-muted-foreground mt-0.5">
              ط§ط±ظپط¹ ظ…ظ„ظپ ط§ظ„ظ…ط·ط§ظ„ط¨ط©طŒ طھظ‚ط±ظٹط± ط§ظ„ط´ط±ط·ط©طŒ ط£ظˆ طµظˆط±ط© ط§ظ„ظ…ظژظ„ظƒظٹط© â€” ط³ظ†ظ…ظ„ط£ ظƒظ„ ط§ظ„ط­ظ‚ظˆظ„ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ (PDF/JPG/PNG)
            </div>
          </div>
          <AiExtractButton
            schema="insurance_claim"
            label="ط§ط³طھط®ط±ط§ط¬ ظ…ظ† ظ…ط³طھظ†ط¯"
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

      {/* ظ…ط­طھظˆظ‰ ط§ظ„ط®ط·ظˆط© */}
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

      {/* ط£ط²ط±ط§ط± ط§ظ„طھظ†ظ‚ظ„ */}
      <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            <ArrowRight size={14} /> ط§ظ„ط³ط§ط¨ظ‚
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(emptyDraft());
              clearStoredDraft();
              setSavedDraftAt(null);
              setStep(0);
              toast.info("طھظ… طھظپط±ظٹط؛ ط§ظ„ظ†ظ…ظˆط°ط¬");
            }}
          >
            <Trash2 size={14} /> طھظپط±ظٹط؛ ط§ظ„ظ†ظ…ظˆط°ط¬
          </Button>
        </div>

        {step < 4 ? (
          <Button onClick={goNext}>
            ط§ظ„طھط§ظ„ظٹ <ArrowLeft size={14} />
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => trySubmit("save_and_new")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              ط­ظپط¸ + ط¬ط¯ظٹط¯ط©
            </Button>
            <Button
              variant="outline"
              onClick={() => trySubmit("save")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              ط­ظپط¸ ظˆط§ظ„ط¹ظˆط¯ط© ظ„ظ„ظ‚ط§ط¦ظ…ط©
            </Button>
            <Button
              onClick={() => trySubmit("save_and_open")}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <BadgeCheck size={14} />}
              ط­ظپط¸ ظˆظپطھط­ ط§ظ„ظ…ط·ط§ظ„ط¨ط©
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط®ط·ظˆط© 0: ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Step0({ draft, update, generateClaimNumber, companies }: { draft: Draft; update: (p: Partial<Draft>) => void; generateClaimNumber: () => void; companies: any[] }) {
  const co = companies.find((c) => c.id === draft.companyId);
  return (
    <div className="space-y-5">
      <SectionHeader icon={Building2} title="ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† (ط§ظ„ط¬ظ‡ط© ط§ظ„ط¯ط§ظپط¹ط©)" desc="ظ…ظ† ظ‡ظٹ ط§ظ„ط´ط±ظƒط© ط§ظ„طھظٹ ط³طھط¯ظپط¹ ظ„ظƒ ظپط§طھظˆط±ط© ط§ظ„ط¥طµظ„ط§ط­طں" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† *</Label>
          <InsuranceCompanyAutocomplete
            value={draft.company}
            companyId={draft.companyId}
            onChange={(name, id) => update({ company: name, companyId: id, insuranceEmployeeId: null })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>ظ…ظˆط¸ظپ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</Label>
          <InsuranceEmployeeSelect
            companyId={draft.companyId}
            value={draft.insuranceEmployeeId}
            onChange={(insuranceEmployeeId) => update({ insuranceEmployeeId })}
            placeholder="ط§ط®طھط± ط§ظ„ظ…ظˆط¸ظپ ط§ظ„ظ…ط³ط¤ظˆظ„"
          />
          <p className="text-[10px] text-muted-foreground">ط§ط®طھظٹط§ط±ظٹطŒ ظˆظٹط¸ظ‡ط± ظ„ط§ط­ظ‚ظ‹ط§ ظپظٹ طھظپط§طµظٹظ„ ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظˆط§ظ„ظپظ„ط§طھط±.</p>
        </div>

        <div className="space-y-1.5">
          <Label>ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط© *</Label>
          <div className="flex gap-2">
            <Input
              value={draft.claimNumber}
              onChange={(e) => update({ claimNumber: e.target.value })}
              placeholder="ظ…ظ† ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ط£ظˆ ظˆظ„ظ‘ط¯ ط±ظ‚ظ…ط§ظ‹ ظ…ط¤ظ‚طھط§ظ‹"
              dir="ltr"
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={generateClaimNumber} title="طھظˆظ„ظٹط¯ ط±ظ‚ظ… ظ…ط¤ظ‚طھ">
              <Wand2 size={14} />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">ط£ط¯ط®ظ„ ط§ظ„ط±ظ‚ظ… ط§ظ„ط°ظٹ طھط¹ط·ظٹظ‡ ظ„ظƒ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†طŒ ط£ظˆ ظˆظ„ظ‘ط¯ ط±ظ‚ظ…ط§ظ‹ ظ…ط¤ظ‚طھط§ظ‹ ط±ظٹط«ظ…ط§ ظٹطµظ„ظƒ.</p>
        </div>
      </div>

      {co && (
        <Card className="p-3 bg-muted/40 border-muted">
          <div className="text-xs font-semibold mb-2 flex items-center gap-1">
            <FileText size={13} className="text-primary" /> ظ…ط¹ظ„ظˆظ…ط§طھ ط³ط¯ط§ط¯ ط§ظ„ط´ط±ظƒط©
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div><span className="text-muted-foreground">ظ…ط¯ط© ط§ظ„ط³ط¯ط§ط¯:</span> <span className="font-semibold">{co.payment_terms_days} ظٹظˆظ…</span></div>
            {co.contact_person && <div><span className="text-muted-foreground">ط§ظ„ظ…ط³ط¤ظˆظ„:</span> <span className="font-semibold">{co.contact_person}</span></div>}
            {co.phone && <div dir="ltr" className="text-left"><span className="text-muted-foreground">ظ‡ط§طھظپ:</span> <span className="font-semibold">{co.phone}</span></div>}
          </div>
        </Card>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط®ط·ظˆط© 1: ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ط¹ظ…ظٹظ„ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const [vehicleMatch, setVehicleMatch] = useState<VehicleIdentityMatch | null>(null);
  const [vehicleLookupLoading, setVehicleLookupLoading] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    (async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, plate_number, plate_letters, plate_country, brand, model, year, color, customer_id, customers(name, phone)")
        .order("created_at", { ascending: false })
        .limit(200);
      setVehicles((data as any[]) || []);
    })();
  }, [pickerOpen]);

  useEffect(() => {
    let cancelled = false;
    if (draft.vehicleId || (!draft.vehiclePlate.trim() && !draft.vehicleVin.trim())) {
      setVehicleMatch(null);
      return;
    }
    setVehicleLookupLoading(true);
    const timer = setTimeout(() => {
      void findExistingVehicle({
        plate: draft.vehiclePlate,
        vin: draft.vehicleVin,
        make: draft.vehicleMake,
        model: draft.vehicleModel,
        year: draft.vehicleYear,
        color: draft.vehicleColor,
      }).then((match) => {
        if (!cancelled) setVehicleMatch(match);
      }).finally(() => {
        if (!cancelled) setVehicleLookupLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.vehicleId, draft.vehiclePlate, draft.vehicleVin, draft.vehicleMake, draft.vehicleModel, draft.vehicleYear, draft.vehicleColor]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return vehicles.slice(0, 50);
    return vehicles
      .filter((v) =>
        [formatVehiclePlateForClaim(v), v.plate_number, v.plate_letters, v.brand, v.model, v.customers?.name, v.customers?.phone]
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
      vehiclePlate: formatVehiclePlateForClaim(v),
      vehicleYear: v.year ? String(v.year) : "",
      vehicleColor: v.color || "",
      ownerName: v.customers?.name || draft.ownerName,
      ownerPhone: v.customers?.phone || draft.ownerPhone,
    });
    setPickerOpen(false);
    toast.success("طھظ… ط±ط¨ط· ط§ظ„ظ…ط±ظƒط¨ط©");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <SectionHeader icon={Car} title="ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ظ…ط§ظ„ظƒ" desc="ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ظ…ط³طھظ„ظ…ط©طŒ ظˆظ…ط§ظ„ظƒظ‡ط§ ظ„طھط³ظ„ظٹظ…ظ‡ط§ ظ„ظ‡ ط¨ط¹ط¯ ط§ظ„ط¥طµظ„ط§ط­" />
        <Button type="button" variant={draft.vehicleId ? "outline" : "default"} size="sm" onClick={() => setPickerOpen(true)}>
          <Car size={14} className="ml-1" />
          {draft.vehicleId ? "طھط؛ظٹظٹط± ط§ظ„ظ…ط±ظƒط¨ط© ط§ظ„ظ…ط±طھط¨ط·ط©" : "ط±ط¨ط· ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط© *"}
        </Button>
      </div>

      {draft.vehicleId ? (
        <div className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-success" />
            <span className="font-semibold">ظ…ط±ظƒط¨ط© ظ…ط±طھط¨ط·ط©:</span>
            <span className="font-mono" dir="ltr">{draft.vehiclePlate}</span>
            <span className="text-muted-foreground">â€” {draft.vehicleMake} {draft.vehicleModel}</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => update({ vehicleId: null })}>
            <X size={12} className="ml-1" /> ط¥ظ„ط؛ط§ط، ط§ظ„ط±ط¨ط·
          </Button>
        </div>
      ) : vehicleLookupLoading ? (
        <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          ط¬ط§ط±ظٹ ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ظ…ط±ظƒط¨ط© ط¯ط§ط®ظ„ ظ†ظپط³ ط§ظ„ظˆط±ط´ط©...
        </div>
      ) : vehicleMatch ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">ط§ظ„ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط©</p>
              <p className="text-muted-foreground">
                ط§ظ„ظ„ظˆط­ط©: {[vehicleMatch.plate_letters, vehicleMatch.plate_number].filter(Boolean).join(" ") || "â€”"} آ· VIN: {vehicleMatch.vin_number || vehicleMatch.vin || "â€”"}
              </p>
              <p className="text-muted-foreground">
                {vehicleMatch.brand || "â€”"} {vehicleMatch.model || ""} {vehicleMatch.year || ""} آ· ط§ظ„ط¹ظ…ظٹظ„ ط§ظ„ط­ط§ظ„ظٹ: {vehicleMatch.customer_name || "â€”"}
              </p>
              {vehicleMatch.customer_id && draft.customerId && vehicleMatch.customer_id !== draft.customerId && (
                <p className="rounded-md border border-warning/35 bg-warning/10 p-2 text-warning">
                  ظ‡ط°ظ‡ ط§ظ„ظ…ط±ظƒط¨ط© ظ…ط±طھط¨ط·ط© ط¨ط¹ظ…ظٹظ„ ط¢ط®ط±. ظ„ظ† ظٹطھظ… ط±ط¨ط·ظ‡ط§ ط£ظˆ ظ†ظ‚ظ„ظ‡ط§ طھظ„ظ‚ط§ط¦ظٹظ‹ط§.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                update({
                  vehicleId: vehicleMatch.id,
                  vehicleMake: vehicleMatch.brand || draft.vehicleMake,
                  vehicleModel: vehicleMatch.model || draft.vehicleModel,
                  vehiclePlate: formatVehiclePlateForClaim(vehicleMatch),
                  vehicleYear: vehicleMatch.year ? String(vehicleMatch.year) : draft.vehicleYear,
                  vehicleColor: vehicleMatch.color || draft.vehicleColor,
                  vehicleVin: vehicleMatch.vin_number || vehicleMatch.vin || draft.vehicleVin,
                });
                toast.success("طھظ… ط§ط®طھظٹط§ط± ط§ظ„ظ…ط±ظƒط¨ط© ط§ظ„ظ…ظˆط¬ظˆط¯ط©");
              }}
            >
              Use This Vehicle
            </Button>
          </div>
        </div>
      ) : draft.vehicleMake && draft.vehicleModel && draft.vehiclePlate ? (
        <div className="rounded-lg border border-info/40 bg-info/5 p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-info" />
            <span>ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظٹط§ط±ط© ط¬ط§ظ‡ط²ط© â€” ط³طھظڈظ†ط´ط£ ط§ظ„ظ…ط±ظƒط¨ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¹ظ†ط¯ ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط©طŒ ط£ظˆ ط§ط¶ط؛ط· آ«ط­ظپط¸ ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ط¢ظ†آ» ظ„ط¥ظ†ط´ط§ط¦ظ‡ط§ ظپظˆط±ط§ظ‹.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                if (!draft.customerId) throw new Error("ط§ط¶ط؛ط· Use Existing Customer ط£ظˆ ط§ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ„ط¥ظ†ط´ط§ط، ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆظ„ط§ظ‹");
                const existing = await findExistingVehicle({
                  plate: draft.vehiclePlate,
                  vin: draft.vehicleVin,
                  make: draft.vehicleMake,
                  model: draft.vehicleModel,
                  year: draft.vehicleYear,
                  color: draft.vehicleColor,
                });
                if (existing?.id) {
                  update({
                    vehicleId: existing.id,
                    vehicleMake: existing.brand || draft.vehicleMake,
                    vehicleModel: existing.model || draft.vehicleModel,
                    vehicleYear: existing.year ? String(existing.year) : draft.vehicleYear,
                    vehicleColor: existing.color || draft.vehicleColor,
                    vehicleVin: existing.vin_number || existing.vin || draft.vehicleVin,
                  });
                  toast.success("طھظ… ط±ط¨ط· ط§ظ„ظ…ط±ظƒط¨ط© ط§ظ„ظ…ظˆط¬ظˆط¯ط©");
                  return;
                }
                const resolved = await ensureVehicleForCustomer({
                  customerId: draft.customerId,
                  allowDifferentCustomer: true,
                  plate: draft.vehiclePlate,
                  vin: draft.vehicleVin,
                  make: draft.vehicleMake,
                  model: draft.vehicleModel,
                  year: draft.vehicleYear,
                  color: draft.vehicleColor,
                });
                update({ vehicleId: resolved.vehicleId });
                toast.success("طھظ… ط­ظپط¸ ط§ظ„ط³ظٹط§ط±ط© ظˆط±ط¨ط·ظ‡ط§");
              } catch (e: any) {
                toast.error(e?.message ?? "ظپط´ظ„ ط­ظپط¸ ط§ظ„ط³ظٹط§ط±ط©");
              }
            }}
          >
            <Save size={12} className="ml-1" /> ط­ظپط¸ ط§ظ„ط³ظٹط§ط±ط© ط§ظ„ط¢ظ†
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning-foreground/80">
          âڑ  ط§ط®طھط± ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط© ظ…ظ† آ«ط±ط¨ط· ظ…ط±ظƒط¨ط© ظ…ظˆط¬ظˆط¯ط©آ»طŒ ط£ظˆ ط£ط¯ط®ظ„ (ط§ظ„ظ…ط§ط±ظƒط© + ط§ظ„ظ…ظˆط¯ظٹظ„ + ط§ظ„ظ„ظˆط­ط©) ط£ط¯ظ†ط§ظ‡ ظˆط³طھظڈظ†ط´ط£ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¹ظ†ط¯ ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط©.
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
          vehicleId: null, // ط£ظٹ طھط¹ط¯ظٹظ„ ظٹط¯ظˆظٹ ظٹظڈظپطµظ„ ط§ظ„ط±ط¨ط·
          vehicleMake: patch.make ?? draft.vehicleMake,
          vehicleModel: patch.model ?? draft.vehicleModel,
          vehiclePlate: patch.plate ?? draft.vehiclePlate,
          vehicleYear: patch.year ?? draft.vehicleYear,
          vehicleColor: patch.color ?? draft.vehicleColor,
          vehicleVin: patch.vin ?? draft.vehicleVin,
        })}
      />

      <div className="border-t pt-4 mt-4">
        <SectionHeader icon={Phone} title="ظ…ط§ظ„ظƒ ط§ظ„ط³ظٹط§ط±ط© (ظ„طھط³ظ„ظٹظ…ظ‡ط§)" desc="ط¨ظٹط§ظ†ط§طھ طµط§ط­ط¨ ط§ظ„ط³ظٹط§ط±ط© ظ„ط§ط³طھظ„ط§ظ…ظ‡ط§ ط¨ط¹ط¯ ط§ظ„ط¥طµظ„ط§ط­" small />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <div className="space-y-1.5">
            <Label>ط§ط³ظ… ط§ظ„ظ…ط§ظ„ظƒ</Label>
            <Input
              value={draft.ownerName}
              onChange={(e) => update({ ownerName: e.target.value })}
              placeholder="ط§ظ„ط§ط³ظ… ط§ظ„ظƒط§ظ…ظ„"
            />
          </div>
          <div className="space-y-1.5">
            <Label>ظ‡ط§طھظپ ط§ظ„ظ…ط§ظ„ظƒ</Label>
            <Input
              value={draft.ownerPhone}
              onChange={(e) => update({ ownerPhone: e.target.value })}
              onBlur={() => update({ ownerPhone: toE164(draft.ownerPhone) })}
              placeholder="+968 9XXX XXXX"
              dir="ltr"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Truck size={13} /> طھط§ط±ظٹط® ط§ظ„طھط³ظ„ظٹظ… ط§ظ„ظ…طھظˆظ‚ط¹</Label>
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
              <div className="font-semibold">ط¹ظ…ظٹظ„ ظ…ظˆط¬ظˆط¯ ط¨ظ†ظپط³ ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ</div>
              <div className="text-muted-foreground">
                {existingCustomerByPhone.name} â€” <span dir="ltr">{existingCustomerByPhone.phone}</span>
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
              ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¹ظ…ظٹظ„ ط§ظ„ظ…ظˆط¬ظˆط¯
            </Button>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="font-semibold text-foreground">ط¥ظ†ط´ط§ط، ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯</div>
            <div className="text-muted-foreground mt-1">
              ط¥ط°ط§ ظ„ظ… ظٹظˆط¬ط¯ ط¹ظ…ظٹظ„ ط¨ظ†ظپط³ ط§ظ„ظ‡ط§طھظپ ط£ظˆ ط§ظ„ط§ط³ظ…طŒ ط³ظٹطھظ… ط¥ظ†ط´ط§ط، ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯ ط¹ظ†ط¯ ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط©.
            </div>
          </div>
          <button
            type="button"
            disabled={!existingCustomerByPhone}
            onClick={() => existingCustomerByPhone && update({
              customerId: existingCustomerByPhone.id,
              ownerName: existingCustomerByPhone.name,
              ownerPhone: existingCustomerByPhone.phone || draft.ownerPhone,
            })}
            className="rounded-lg border border-info/40 bg-info/5 p-3 text-right transition hover:bg-info/10 disabled:opacity-50 disabled:hover:bg-info/5"
          >
            <div className="font-semibold text-foreground">ط§ط®طھظٹط§ط± ط¹ظ…ظٹظ„ ظ…ط­ظپظˆط¸</div>
            <div className="text-muted-foreground mt-1">
              {existingCustomerByPhone ? existingCustomerByPhone.name : "ظٹط¸ظ‡ط± طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط¹ظ†ط¯ طھط·ط§ط¨ظ‚ ط±ظ‚ظ… ط§ظ„ظ‡ط§طھظپ."}
            </div>
          </button>
          <button
            type="button"
            disabled={!draft.company.trim()}
            onClick={() => update({
              customerId: null,
              ownerName: draft.company.trim(),
              ownerPhone: "",
            })}
            className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-right transition hover:bg-amber-500/15 disabled:opacity-50 disabled:hover:bg-amber-500/10"
          >
            <div className="font-semibold text-foreground">ط§ظ„ط¹ظ…ظٹظ„ = ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†</div>
            <div className="text-muted-foreground mt-1">
              ظٹط³طھط®ط¯ظ… ط§ط³ظ… ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† ظƒط¹ظ…ظٹظ„ ط¹ظ†ط¯ ط¹ط¯ظ… ظˆط¬ظˆط¯ ظ…ط§ظ„ظƒ ظ…ط­ط¯ط¯.
            </div>
          </button>
        </div>
      </div>

      {/* Vehicle picker dialog */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold"><Car size={16} className="text-primary" /> ط§ط®طھط± ظ…ط±ظƒط¨ط© ظ…ظ† ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ</div>
              <Button variant="ghost" size="icon" onClick={() => setPickerOpen(false)}><X size={14} /></Button>
            </div>
            <div className="p-3 border-b border-border">
              <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ط§ط¨ط­ط« ط¨ط±ظ‚ظ… ط§ظ„ظ„ظˆط­ط© ط£ظˆ ط§ظ„ظ…ط§ط±ظƒط© ط£ظˆ ط§ط³ظ… ط§ظ„ظ…ط§ظ„ظƒ..." />
            </div>
            <div className="overflow-auto flex-1 divide-y divide-border">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  ظ„ط§ طھظˆط¬ط¯ ظ…ط±ظƒط¨ط§طھ. ط£ط؛ظ„ظ‚ ظ‡ط°ظ‡ ط§ظ„ظ†ط§ظپط°ط© ظˆط£ط¯ط®ظ„ ط¨ظٹط§ظ†ط§طھظ‡ط§ ظٹط¯ظˆظٹط§ظ‹طŒ ط£ظˆ ط³ط¬ظ‘ظ„ظ‡ط§ ط£ظˆظ„ط§ظ‹ ظ…ظ† طµظپط­ط© ط§ظ„ظ…ط±ظƒط¨ط§طھ.
                </div>
              ) : filtered.map((v) => (
                <button key={v.id} className="w-full text-right p-3 hover:bg-secondary/50 transition flex items-center justify-between gap-3" onClick={() => pickVehicle(v)}>
                  <div>
                    <div className="font-mono text-sm" dir="ltr">{formatVehiclePlateForClaim(v)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{v.brand} {v.model} {v.year ? `â€¢ ${v.year}` : ""}</div>
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط®ط·ظˆط© 2: ظˆطµظپ ط§ظ„ط¶ط±ط± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Step2({ draft, update }: { draft: Draft; update: (p: Partial<Draft>) => void }) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={AlertTriangle} title="ظˆطµظپ ط§ظ„ط¶ط±ط±" desc="ظ…ط§ ط§ظ„ط°ظٹ ظٹط­طھط§ط¬ ط¥طµظ„ط§ط­ظ‡ ظپظٹ ط§ظ„ط³ظٹط§ط±ط©طں" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1"><CalendarClock size={13} /> طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹط± *</Label>
          <Input
            type="date"
            value={draft.incidentDate}
            onChange={(e) => update({ incidentDate: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground">ط§ظ„ظٹظˆظ… ط§ظ„ط°ظٹ ط§ط³طھظ„ظ…طھ ظپظٹظ‡ ط§ظ„ط³ظٹط§ط±ط© ظپظٹ ط§ظ„ظƒط±ط§ط¬.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>ظˆطµظپ ط§ظ„ط¶ط±ط± / ط§ظ„ط£ط¹ظ…ط§ظ„ ط§ظ„ظ…ط·ظ„ظˆط¨ط©</Label>
          <AiWriteButton
            value={draft.damageDescription}
            onChange={(t) => update({ damageDescription: t })}
            context={`ظ…ط·ط§ظ„ط¨ط© طھط£ظ…ظٹظ† - ط³ظٹط§ط±ط© ${draft.vehicleMake || ""} ${draft.vehicleModel || ""} ظ„ظˆط­ط© ${draft.vehiclePlate || ""}`}
            placeholder="ظ…ط«ط§ظ„: ط­ط§ط¯ط« ط£ظ…ط§ظ…ظٹطŒ ظٹط­طھط§ط¬ طµط¯ط§ظ… ظˆط±ظپط±ظپ ظˆطµط¨ط§ط؛ط©"
          />
        </div>
        <Textarea
          value={draft.damageDescription}
          onChange={(e) => update({ damageDescription: e.target.value })}
          placeholder="ظ…ط«ط§ظ„: طµط¯ظ…ط© ظپظٹ ط§ظ„ظˆط§ط¬ظ‡ط© ط§ظ„ط£ظ…ط§ظ…ظٹط© - ظٹط­طھط§ط¬ ط§ط³طھط¨ط¯ط§ظ„ طµط¯ط§ظ… + ط±ظپط±ظپ ط£ظٹظ…ظ† + طµط¨ط§ط؛ط©..."
          rows={5}
        />
      </div>

      <Card className="p-3 bg-info/5 border-info/20">
        <div className="flex items-start gap-2 text-xs">
          <Camera size={14} className="text-info mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-info">ظ†طµظٹط­ط©</div>
            <div className="text-muted-foreground mt-0.5">
              طµظˆط± ظ‚ط¨ظ„/ط¨ط¹ط¯ ظˆظ…ط³طھظ†ط¯ط§طھ ط§ظ„ظپط­طµ ظٹظ…ظƒظ† ط±ظپط¹ظ‡ط§ ط¨ط¹ط¯ ط­ظپط¸ ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ…ظ† طµظپط­ط© ط§ظ„طھظپط§طµظٹظ„.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط®ط·ظˆط© 3: ط§ظ„طھط³ط¹ظٹط± â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Step3({
  draft, update, uplTotal, finalEstimate, vatAmount, finalWithVat,
}: {
  draft: Draft; update: (p: Partial<Draft>) => void;
  uplTotal: number; finalEstimate: number; vatAmount: number; finalWithVat: number;
}) {
  return (
    <div className="space-y-5">
      <SectionHeader icon={Calculator} title="طھط³ط¹ظٹط± ط§ظ„ظƒط±ط§ط¬" desc="ط§ظ„ط³ط¹ط± ط§ظ„ط°ظٹ ط³طھط·ط§ظ„ط¨ ط¨ظ‡ ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†" />

      {/* ظ†ظˆط¹ ط§ظ„طھظ‚ط¯ظٹط± â€” ط£ط²ط±ط§ط± ظ…ظ‚ط·ظ‘ط¹ط© (Segmented) ظˆط§ط¶ط­ط© ظˆظ‚ط§ط¨ظ„ط© ظ„ظ„طھط¨ط¯ظٹظ„ */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">ط·ط±ظٹظ‚ط© ط§ظ„طھط³ط¹ظٹط±</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-1 rounded-lg bg-muted border">
          <button
            type="button"
            onClick={() => update({ estimationType: "auto" })}
            className={`px-4 py-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-0.5 ${
              draft.estimationType === "auto"
                ? "bg-background shadow text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>طھظ‚ط¯ظٹط± ط£ظˆظ„ظٹ طھظ„ظ‚ط§ط¦ظٹ</span>
            <span className="text-[10px] font-normal opacity-70">ظ…ط¨ظ„ط؛ ظپظ‚ط· ط¨ط¯ظˆظ† ط®طھظ… ظپظٹ ط§ظ„ظˆط±ظ‚ط©</span>
          </button>
          <button
            type="button"
            onClick={() => update({ estimationType: "lump_sum" })}
            className={`px-4 py-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-0.5 ${
              draft.estimationType === "lump_sum"
                ? "bg-background shadow text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>ظ…ط¨ظ„ط؛ ط¥ط¬ظ…ط§ظ„ظٹ (Lump Sum)</span>
            <span className="text-[10px] font-normal opacity-70">ط±ظ‚ظ… ظˆط§ط­ط¯ ظ„ظ„ظ…ط·ط§ظ„ط¨ط©</span>
          </button>
          <button
            type="button"
            onClick={() => update({
              estimationType: "upl",
              uplItems: draft.uplItems.length ? draft.uplItems : DEFAULT_UPL_ITEMS.map((item) => ({ ...item })),
            })}
            className={`px-4 py-3 rounded-md text-sm font-semibold transition flex flex-col items-center gap-0.5 ${
              draft.estimationType === "upl"
                ? "bg-background shadow text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>طھط³ط¹ظٹط± ط¨ط§ظ„ط¨ظ†ظˆط¯ (UPL)</span>
            <span className="text-[10px] font-normal opacity-70">ظ‚ط§ط¦ظ…ط© ط£ط³ط¹ط§ط± ظ…ظˆط­ظ‘ط¯ط© ط¨ط§ظ„طھظپطµظٹظ„</span>
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          ظٹظ…ظƒظ†ظƒ ط§ظ„طھط¨ط¯ظٹظ„ ط¨ظٹظ† ط§ظ„ط·ط±ظٹظ‚طھظٹظ† ط§ظ„ط¢ظ† ط£ظˆ ظ„ط§ط­ظ‚ط§ظ‹ ط¹ظ†ط¯ طھط¹ط¯ظٹظ„ ط§ظ„ظ…ط·ط§ظ„ط¨ط©.
        </p>
      </div>

      {draft.estimationType === "upl" ? (
        <UplItemsEditor items={draft.uplItems} onChange={(items) => update({ uplItems: items })} suggestedAmount={parseMoneyInput(draft.estimatedCost) || 0} />
      ) : (
        <div className="space-y-1.5">
          <Label>ط§ظ„ظ…ط¨ظ„ط؛ ط§ظ„ظ…ط·ط§ظ„ط¨ ط¨ظ‡ (ط±.ط¹) *</Label>
          <Input
            type="text"
            value={draft.estimatedCost}
            onChange={(e) => update({ estimatedCost: e.target.value })}
            placeholder="0.000"
            inputMode="decimal"
            dir="ltr"
          />
        </div>
      )}

      {/* ظ…ظ„ط®طµ ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ„ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ† */}
      <Card className="p-4 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 space-y-2">
        <div className="text-xs font-semibold text-primary mb-2 flex items-center gap-1">
          <Calculator size={13} /> ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط·ط§ظ„ط¨ ط¨ظ‡ ظ…ظ† ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†
        </div>
        <Row label="ط§ظ„ظ…ط¬ظ…ظˆط¹ ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط©" value={finalEstimate} />
        <Row label="ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (5%)" value={vatAmount} />
        <Row label="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظپط§طھظˆط±ط©" value={finalWithVat} bold />
      </Card>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>ظ…ظ„ط§ط­ط¸ط§طھ</Label>
          <AiWriteButton
            value={draft.notes}
            onChange={(t) => update({ notes: t })}
            context="ظ…ظ„ط§ط­ط¸ط§طھ ط¯ط§ط®ظ„ظٹط© ظ„ظ„ظ…ط·ط§ظ„ط¨ط©"
          />
        </div>
        <Textarea
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="ط£ظٹ ظ…ظ„ط§ط­ط¸ط§طھ ظ„ظ„ط£ط±ط´ظٹظپ ط§ظ„ط¯ط§ط®ظ„ظٹ..."
          rows={3}
        />
      </div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ط§ظ„ط®ط·ظˆط© 4: ط§ظ„ظ…ط±ط§ط¬ط¹ط© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Step4({
  draft, finalEstimate, vatAmount, finalWithVat, goTo,
}: {
  draft: Draft; finalEstimate: number; vatAmount: number; finalWithVat: number;
  goTo: (s: Step) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader icon={ClipboardList} title="ظ…ط±ط§ط¬ط¹ط© ظ†ظ‡ط§ط¦ظٹط©" desc="ط±ط§ط¬ط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ‚ط¨ظ„ ط§ظ„ط­ظپط¸. ط§ط¶ط؛ط· ط¹ظ„ظ‰ ط£ظٹ ظ‚ط³ظ… ظ„طھط¹ط¯ظٹظ„ظ‡" />

      <ReviewBlock title="ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†" icon={Building2} onEdit={() => goTo(0)}>
        <KV k="ط§ظ„ط´ط±ظƒط©" v={draft.company} />
        <KV k="ط±ظ‚ظ… ط§ظ„ظ…ط·ط§ظ„ط¨ط©" v={draft.claimNumber} ltr />
      </ReviewBlock>

      <ReviewBlock title="ط§ظ„ط³ظٹط§ط±ط© ظˆط§ظ„ظ…ط§ظ„ظƒ" icon={Car} onEdit={() => goTo(1)}>
        <KV k="ط§ظ„ط³ظٹط§ط±ط©" v={`${draft.vehicleMake} ${draft.vehicleModel} ${draft.vehicleYear ? `(${draft.vehicleYear})` : ""}`} />
        <KV k="ط§ظ„ظ„ظˆط­ط©" v={draft.vehiclePlate} ltr />
        <KV k="ط§ظ„ظ„ظˆظ†" v={draft.vehicleColor || "â€”"} />
        <KV k="ط§ظ„ظ…ط§ظ„ظƒ" v={draft.ownerName || "â€”"} />
        <KV k="ظ‡ط§طھظپ ط§ظ„ظ…ط§ظ„ظƒ" v={draft.ownerPhone || "â€”"} ltr />
        <KV k="ط§ظ„طھط³ظ„ظٹظ… ط§ظ„ظ…طھظˆظ‚ط¹" v={draft.expectedDeliveryDate || "â€”"} ltr />
      </ReviewBlock>

      <ReviewBlock title="ط§ظ„ط¶ط±ط±" icon={AlertTriangle} onEdit={() => goTo(2)}>
        <KV k="طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹط±" v={draft.incidentDate} ltr />
        <KV k="ط§ظ„ظˆطµظپ" v={draft.damageDescription || "â€”"} full />
      </ReviewBlock>

      <ReviewBlock title="ط§ظ„ظ…ط·ط§ظ„ط¨ط© ظ„ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†" icon={Calculator} onEdit={() => goTo(3)}>
        <KV k="ظ†ظˆط¹ ط§ظ„طھط³ط¹ظٹط±" v={draft.estimationType === "upl" ? "ط¨ظ†ظˆط¯ UPL" : draft.estimationType === "auto" ? "طھظ‚ط¯ظٹط± ط£ظˆظ„ظٹ طھظ„ظ‚ط§ط¦ظٹ" : "ظ…ط¨ظ„ط؛ ط¥ط¬ظ…ط§ظ„ظٹ"} />
        {draft.estimationType === "upl" && (
          <KV k="ط¹ط¯ط¯ ط§ظ„ط¨ظ†ظˆط¯" v={String(draft.uplItems.length)} ltr />
        )}
        <KV k="ط§ظ„ظ…ط¬ظ…ظˆط¹" v={`${toEnglishDigits(finalEstimate.toFixed(3))} OMR`} ltr />
        <KV k="ط§ظ„ط¶ط±ظٹط¨ط© (5%)" v={`${toEnglishDigits(vatAmount.toFixed(3))} OMR`} ltr />
        <KV k="ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظپط§طھظˆط±ط©" v={`${toEnglishDigits(finalWithVat.toFixed(3))} OMR`} ltr highlight />
      </ReviewBlock>

      <Card className="p-4 bg-success/5 border-success/30 flex items-start gap-3">
        <CheckCircle2 className="text-success mt-0.5 shrink-0" size={20} />
        <div className="text-sm">
          <div className="font-semibold text-success">ط¬ط§ظ‡ط²ط© ظ„ظ„ط­ظپط¸</div>
          <div className="text-xs text-muted-foreground mt-1">
            ط³طھظڈط­ظپط¸ ط¨ط­ط§ظ„ط© "ط¨ط§ظ†طھط¸ط§ط± ط§ظ„ط§ط¹طھظ…ط§ط¯". ط¨ط¹ط¯ ط§ظ„ط­ظپط¸ ظٹظ…ظƒظ†ظƒ ط±ظپط¹ طµظˆط± ظ‚ط¨ظ„/ط¨ط¹ط¯طŒ ط¥طµط¯ط§ط± ظپط§طھظˆط±ط©طŒ ظˆطھطھط¨ط¹ ط§ظ„طھط­طµظٹظ„ ظ…ظ† ط´ط±ظƒط© ط§ظ„طھط£ظ…ظٹظ†.
          </div>
        </div>
      </Card>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ظ…ظƒظˆظ†ط§طھ ظ…ط³ط§ط¹ط¯ط© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        <Button variant="ghost" size="sm" onClick={onEdit}>طھط¹ط¯ظٹظ„</Button>
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
