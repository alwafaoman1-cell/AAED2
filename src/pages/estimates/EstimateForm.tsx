import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileUp, Loader2, Plus, Save, Search, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatOMR } from "@/lib/money";
import { extractFromFile } from "@/lib/aiExtract";
import {
  ESTIMATE_CATEGORY_LABEL,
  calculateEstimateTotals,
  createUnifiedEstimate,
  getUnifiedEstimate,
  updateUnifiedEstimate,
  type EstimateItemCategory,
  type EstimateItemInput,
  type EstimateType,
  type UnifiedEstimate,
} from "@/lib/unifiedEstimates";

const emptyItem: EstimateItemInput = {
  category: "labor",
  description_ar: "",
  description_en: "",
  quantity: 1,
  unit_price: 0,
  vat_rate: 5,
};

type EstimateSearchResult = {
  type: "vehicle" | "claim" | "work_order";
  id: string;
  title: string;
  subtitle: string;
  customer_id: string | null;
  vehicle_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  customer?: { id?: string; name?: string | null; phone?: string | null; customer_code?: string | null } | null;
  vehicle?: { id?: string; brand?: string | null; make?: string | null; model?: string | null; year?: number | null; plate_number?: string | null; vin_number?: string | null } | null;
};

type ExtractedField = {
  key: string;
  label: string;
  current: string;
  extracted: string;
  confidence: "high" | "medium" | "low";
  apply: boolean;
};

const AI_FIELD_LABELS: Record<string, string> = {
  estimate_number: "Estimate Number",
  estimate_date: "Estimate Date",
  valid_until: "Valid Until",
  customer_name: "Customer Name",
  customer_phone: "Customer Phone",
  customer_email: "Customer Email",
  customer_code: "Customer Code",
  vehicle_make: "Vehicle Make",
  vehicle_model: "Vehicle Model",
  vehicle_year: "Vehicle Year",
  plate_number: "Plate Number",
  plate_letters: "Plate Letters",
  vin: "VIN",
  color: "Color",
  insurance_company: "Insurance Company",
  claim_number: "Claim Number",
  policy_number: "Policy Number",
  surveyor: "Surveyor",
  insurance_employee: "Insurance Employee",
  subtotal: "Subtotal",
  vat_rate: "VAT Rate",
  vat_amount: "VAT Amount",
  total: "Total",
  accident_description: "Accident Description",
  visible_damage: "Visible Damage",
  hidden_damage: "Hidden Damage",
  parts_notes: "Parts Notes",
  general_notes: "General Notes",
  terms: "Terms",
};

function confidenceForKey(key: string, value: string): ExtractedField["confidence"] {
  if (!value.trim()) return "low";
  if (/number|date|vin|plate|total|subtotal|amount|rate/i.test(key)) return "high";
  if (/notes|description|damage|terms/i.test(key)) return "medium";
  return "high";
}

function parseExtractedItems(raw: unknown): EstimateItemInput[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: any): EstimateItemInput => ({
      category: ([
        "labor",
        "parts",
        "paint_materials",
        "mechanical",
        "electrical",
        "programming",
        "diagnosis",
        "sublet",
        "transport",
        "other",
      ].includes(String(row.category)) ? row.category : "other") as EstimateItemCategory,
      description_ar: String(row.description || row.description_ar || row.description_en || "").trim(),
      description_en: String(row.description_en || "").trim(),
      quantity: Number(row.quantity || 1),
      unit_price: Number(row.unit_price || row.rate || 0),
      vat_rate: 5,
      notes: null,
    })).filter((item) => item.description_ar || item.description_en || item.unit_price > 0);
  } catch {
    return [];
  }
}

export default function EstimateForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const isEdit = Boolean(id);
  const defaultType = (searchParams.get("type") as EstimateType | null) || "independent";

  const { data: existing } = useQuery({
    queryKey: queryKeys.estimates.detail(id),
    queryFn: () => getUnifiedEstimate(id!),
    enabled: isEdit,
  });
  const { data: lookups } = useQuery({
    queryKey: queryKeys.estimates.lookups,
    queryFn: async () => {
      const [customers, vehicles, claims, workOrders, estimates] = await Promise.all([
        supabase.from("customers" as any).select("id,name,phone,email,customer_code").order("created_at", { ascending: false }).limit(200),
        supabase.from("vehicles" as any).select("id,brand,make,model,plate_number,plate_letters,vin,vin_number,year,color,customer_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("insurance_claims" as any).select("id,claim_number,insurance_company,insurance_employee_name,policy_number,surveyor,customer_id,vehicle_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("job_orders" as any).select("id,order_number,status,customer_id,vehicle_id,claim_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("estimates" as any).select("id,estimate_number,estimate_type,total").order("created_at", { ascending: false }).limit(200),
      ]);
      for (const result of [customers, vehicles, claims, workOrders, estimates]) {
        if (result.error) throw result.error;
      }
      return {
        customers: customers.data || [],
        vehicles: vehicles.data || [],
        claims: claims.data || [],
        workOrders: workOrders.data || [],
        estimates: estimates.data || [],
      };
    },
  });

  const [form, setForm] = useState<Partial<UnifiedEstimate>>({
    estimate_type: defaultType,
    status: "draft",
    claim_id: searchParams.get("claimId"),
    work_order_id: searchParams.get("workOrderId"),
    parent_estimate_id: searchParams.get("parentEstimateId"),
    estimate_date: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    vat_rate: 5,
    vat_enabled: false,
    currency: "OMR",
  });
  const [items, setItems] = useState<EstimateItemInput[]>([{ ...emptyItem }]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<EstimateSearchResult[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<EstimateSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiDocType, setAiDocType] = useState("auto");
  const [aiLanguage, setAiLanguage] = useState("auto");
  const [aiStatus, setAiStatus] = useState<"idle" | "uploading" | "processing" | "ready" | "failed">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<ExtractedField[]>([]);
  const [aiItems, setAiItems] = useState<EstimateItemInput[]>([]);
  const [aiVatSuggested, setAiVatSuggested] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setForm({ ...existing, vat_enabled: Boolean(existing.vat_enabled) });
    setItems((existing.items || []).map((item) => ({
      category: item.category,
      description_ar: item.description_ar,
      description_en: item.description_en,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      notes: item.notes,
    })));
  }, [existing]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(async () => {
      try {
        const pattern = `%${term.replace(/[%_]/g, "")}%`;
        const [vehiclesRes, claimsRes, ordersRes, customersRes] = await Promise.all([
          supabase
            .from("vehicles" as any)
            .select("id,brand,model,year,plate_number,plate_letters,vin_number,customer_id,customer:customers(id,name,phone,customer_code)")
            .or(`plate_number.ilike.${pattern},plate_letters.ilike.${pattern},vin_number.ilike.${pattern},brand.ilike.${pattern},model.ilike.${pattern}`)
            .limit(8),
          supabase
            .from("insurance_claims" as any)
            .select("id,claim_number,insurance_company,customer_id,vehicle_id,job_order_id,auto_job_order_id,customer:customers(id,name,phone,customer_code),vehicle:vehicles(id,brand,model,year,plate_number,vin_number)")
            .or(`claim_number.ilike.${pattern},insurance_company.ilike.${pattern}`)
            .limit(8),
          supabase
            .from("job_orders" as any)
            .select("id,order_number,status,customer_id,vehicle_id,claim_id,customer:customers(id,name,phone,customer_code),vehicle:vehicles(id,brand,model,year,plate_number,vin_number)")
            .or(`order_number.ilike.${pattern},description.ilike.${pattern}`)
            .limit(8),
          supabase
            .from("customers" as any)
            .select("id,name,phone,customer_code,vehicles(id,brand,model,year,plate_number,plate_letters,vin_number,customer_id)")
            .or(`name.ilike.${pattern},phone.ilike.${pattern},customer_code.ilike.${pattern}`)
            .limit(6),
        ]);
        for (const result of [vehiclesRes, claimsRes, ordersRes, customersRes]) {
          if (result.error) throw result.error;
        }
        if (cancelled) return;
        const vehicleRows = ((vehiclesRes.data || []) as any[]).map((v): EstimateSearchResult => ({
          type: "vehicle",
          id: v.id,
          title: `${[v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim() || v.plate_number || "Vehicle"} • ${[v.brand, v.model, v.year].filter(Boolean).join(" ")}`,
          subtitle: `${v.customer?.customer_code || ""} ${v.customer?.name || ""} ${v.customer?.phone || ""}`.trim(),
          customer_id: v.customer_id || null,
          vehicle_id: v.id,
          claim_id: null,
          work_order_id: null,
          customer: v.customer || null,
          vehicle: v,
        }));
        const claimRows = ((claimsRes.data || []) as any[]).map((c): EstimateSearchResult => ({
          type: "claim",
          id: c.id,
          title: `${c.claim_number || "Claim"} • ${c.insurance_company || "—"}`,
          subtitle: `${c.customer?.customer_code || ""} ${c.customer?.name || ""} • ${c.vehicle?.plate_number || ""}`.trim(),
          customer_id: c.customer_id || null,
          vehicle_id: c.vehicle_id || null,
          claim_id: c.id,
          work_order_id: c.job_order_id || c.auto_job_order_id || null,
          customer: c.customer || null,
          vehicle: c.vehicle || null,
        }));
        const orderRows = ((ordersRes.data || []) as any[]).map((o): EstimateSearchResult => ({
          type: "work_order",
          id: o.id,
          title: `${o.order_number || "WO"} • ${o.status || "—"}`,
          subtitle: `${o.customer?.customer_code || ""} ${o.customer?.name || ""} • ${o.vehicle?.plate_number || ""}`.trim(),
          customer_id: o.customer_id || null,
          vehicle_id: o.vehicle_id || null,
          claim_id: o.claim_id || null,
          work_order_id: o.id,
          customer: o.customer || null,
          vehicle: o.vehicle || null,
        }));
        const customerVehicleRows = ((customersRes.data || []) as any[]).flatMap((c): EstimateSearchResult[] => {
          const customerVehicles = Array.isArray(c.vehicles) ? c.vehicles : [];
          if (customerVehicles.length === 0) return [{ type: "vehicle", id: `customer-${c.id}`, title: `${c.customer_code || ""} ${c.name || "Customer"}`.trim(), subtitle: c.phone || "", customer_id: c.id, vehicle_id: null, claim_id: null, work_order_id: null, customer: c, vehicle: null }];
          return customerVehicles.map((v: any) => ({ type: "vehicle", id: v.id, title: `${[v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim() || "Vehicle"} • ${[v.brand, v.model, v.year].filter(Boolean).join(" ")}`, subtitle: `${c.customer_code || ""} ${c.name || ""} ${c.phone || ""}`.trim(), customer_id: c.id, vehicle_id: v.id, claim_id: null, work_order_id: null, customer: c, vehicle: v }));
        });
        const uniqueResults = new Map<string, EstimateSearchResult>();
        [...claimRows, ...orderRows, ...vehicleRows, ...customerVehicleRows].forEach((row) => uniqueResults.set(`${row.type}-${row.id}`, row));
        setSearchResults([...uniqueResults.values()].slice(0, 12));
      } catch (error: any) {
        if (!cancelled) setSearchError(error?.message || "فشل البحث");
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!lookups || isEdit) return;
    setForm((current) => {
      const next = { ...current };
      if (current.claim_id) {
        const claim = lookups.claims.find((claim: any) => claim.id === current.claim_id) as any;
        if (claim) {
          next.customer_id = next.customer_id || claim.customer_id || null;
          next.vehicle_id = next.vehicle_id || claim.vehicle_id || null;
        }
      }
      if (current.work_order_id) {
        const workOrder = lookups.workOrders.find((order: any) => order.id === current.work_order_id) as any;
        if (workOrder) {
          next.customer_id = next.customer_id || workOrder.customer_id || null;
          next.vehicle_id = next.vehicle_id || workOrder.vehicle_id || null;
          next.claim_id = next.claim_id || workOrder.claim_id || null;
        }
      }
      return next;
    });
  }, [isEdit, lookups]);

  const totals = useMemo(() => calculateEstimateTotals(items, Number(form.vat_rate ?? 5), Boolean(form.vat_enabled)), [form.vat_enabled, form.vat_rate, items]);
  const selectedCustomer = useMemo<any>(
    () => lookups?.customers.find((customer: any) => customer.id === form.customer_id) || (selectedRecord?.customer as any) || null,
    [form.customer_id, lookups?.customers, selectedRecord],
  );
  const selectedVehicle = useMemo<any>(
    () => lookups?.vehicles.find((vehicle: any) => vehicle.id === form.vehicle_id) || (selectedRecord?.vehicle as any) || null,
    [form.vehicle_id, lookups?.vehicles, selectedRecord],
  );
  const selectedClaim = useMemo<any>(
    () => lookups?.claims.find((claim: any) => claim.id === form.claim_id) || null,
    [form.claim_id, lookups?.claims],
  );
  const selectedWorkOrder = useMemo<any>(
    () => lookups?.workOrders.find((order: any) => order.id === form.work_order_id) || null,
    [form.work_order_id, lookups?.workOrders],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (form.estimate_type === "supplementary" && !form.parent_estimate_id) {
        throw new Error("التقدير الإضافي يجب أن يرتبط بتقدير أصلي.");
      }
      const estimatePayload = { ...form };
      delete (estimatePayload as any).vehicle_received_at;
      delete (estimatePayload as any).work_started_at;
      delete (estimatePayload as any).vehicle_delivered_at;
      delete (estimatePayload as any).vehicle_presence_status;
      delete (estimatePayload as any).vehicle_location_section;
      delete (estimatePayload as any).vehicle_location_bay;
      delete (estimatePayload as any).vehicle_location_note;
      if (isEdit && id) {
        await updateUnifiedEstimate(id, { estimate: estimatePayload, items });
        return { id };
      }
      return createUnifiedEstimate({ estimate: estimatePayload, items });
    },
    onSuccess: (estimate: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.estimates.all });
      toast.success("تم حفظ التقدير");
      navigate(`/estimates/${estimate.id}`);
    },
    onError: (error: any) => toast.error(error?.message || "فشل حفظ التقدير"),
  });

  function patchItem(index: number, patch: Partial<EstimateItemInput>) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function addItem() {
    setItems((current) => [...current, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index));
  }

  function onClaimChange(claimId: string) {
    const claim = lookups?.claims.find((c: any) => c.id === claimId) as any;
    setForm({
      ...form,
      claim_id: claimId === "none" ? null : claimId,
      customer_id: claim?.customer_id || form.customer_id || null,
      vehicle_id: claim?.vehicle_id || form.vehicle_id || null,
    });
  }

  function selectSearchResult(result: EstimateSearchResult) {
    setSelectedRecord(result);
    setSearchTerm(result.title);
    setSearchResults([]);
    setForm((current) => ({
      ...current,
      customer_id: result.customer_id || current.customer_id || null,
      vehicle_id: result.vehicle_id || current.vehicle_id || null,
      claim_id: result.claim_id || current.claim_id || null,
      work_order_id: result.work_order_id || current.work_order_id || null,
      estimate_type: result.claim_id ? "insurance" : current.estimate_type,
    }));
  }

  function currentValueForField(key: string) {
    if (key === "estimate_date") return String(form.estimate_date || "");
    if (key === "valid_until") return String(form.valid_until || "");
    if (key === "terms") return String(form.terms || "");
    if (key === "general_notes") return String(form.notes || "");
    return "";
  }

  async function analyzeAiFile() {
    if (!aiFile) {
      toast.error("اختر ملفًا أولًا");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(aiFile.type) && !/\.(jpg|jpeg|png|webp|pdf)$/i.test(aiFile.name)) {
      setAiStatus("failed");
      setAiError("صيغة غير مدعومة. ارفع JPG/PNG/WEBP/PDF.");
      return;
    }
    setAiStatus("processing");
    setAiError(null);
    setAiFields([]);
    setAiItems([]);
    setAiVatSuggested(false);
    try {
      let data: Record<string, string>;
      try {
        data = await extractFromFile(aiFile, "estimate_document");
      } catch (primaryError: any) {
        const primaryMessage = String(primaryError?.message || "");
        if (!primaryMessage.toLowerCase().includes("unknown schema")) throw primaryError;
        data = await extractFromFile(aiFile, "insurance_claim");
      }
      const ignored = new Set(["items_json", "vat_detected"]);
      const fields = Object.entries(data)
        .filter(([key, value]) => !ignored.has(key) && String(value || "").trim())
        .map(([key, value]): ExtractedField => {
          const extracted = String(value || "").trim();
          return {
            key,
            label: AI_FIELD_LABELS[key] || key,
            current: currentValueForField(key),
            extracted,
            confidence: confidenceForKey(key, extracted),
            apply: confidenceForKey(key, extracted) !== "low",
          };
        });
      setAiFields(fields);
      setAiItems(parseExtractedItems((data as any).items_json));
      setAiVatSuggested(String((data as any).vat_detected || "").toLowerCase() === "true" || Boolean((data as any).vat_amount));
      setAiStatus("ready");
      void logAiExtraction("ready", { extracted_fields_count: fields.length });
    } catch (error: any) {
      setAiStatus("failed");
      setAiError(error?.message || "فشل تحليل الملف بالذكاء الاصطناعي");
      void logAiExtraction("failed", { failed_reason: error?.message || "AI extraction failed" });
    }
  }

  function patchAiField(index: number, patch: Partial<ExtractedField>) {
    setAiFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  async function logAiExtraction(status: string, extras: Record<string, unknown> = {}) {
    try {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      const { data: auth } = await supabase.auth.getUser();
      if (!tenantId) return;
      await supabase.from("ai_extraction_logs" as any).insert({
        tenant_id: tenantId,
        user_id: auth.user?.id || null,
        file_name: aiFile?.name || null,
        file_type: aiFile?.type || null,
        document_type: aiDocType,
        provider: "active_ai_provider",
        processing_status: status,
        ...extras,
      });
    } catch {
      // AI audit must not block estimate editing.
    }
  }

  function applyExtractedFields(applyAll = false) {
    const selected = aiFields.filter((field) => applyAll || field.apply);
    const nextForm = { ...form };
    const noteLines: string[] = [];
    for (const field of selected) {
      if (field.key === "estimate_date") nextForm.estimate_date = field.extracted;
      else if (field.key === "valid_until") nextForm.valid_until = field.extracted;
      else if (field.key === "terms") nextForm.terms = field.extracted;
      else if (field.key === "general_notes" || field.key.endsWith("_notes") || field.key.includes("description") || field.key.includes("damage")) {
        noteLines.push(`${field.label}: ${field.extracted}`);
      } else {
        noteLines.push(`${field.label}: ${field.extracted}`);
      }
    }
    if (noteLines.length) {
      nextForm.notes = [nextForm.notes, "AI extracted data (reviewed, not auto-saved):", ...noteLines].filter(Boolean).join("\n");
    }
    setForm(nextForm);
    if (aiItems.length > 0) {
      setItems(aiItems);
    }
    void logAiExtraction("applied", { applied_fields_count: selected.length, extracted_fields_count: aiFields.length });
    toast.success(`تمت تعبئة ${selected.length} حقلًا و${aiItems.length} بنود من الملف. يرجى المراجعة قبل الحفظ.`);
    setAiOpen(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "تعديل تقدير" : "إنشاء تقدير موحد"}</h1>
          <p className="text-sm text-muted-foreground">كل الأسعار هنا قبل الضريبة. VAT يضاف فوق السعر فقط.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAiOpen(true)} className="gap-2">
            <FileUp size={16} /> Extract from Image / Document
          </Button>
        <Button variant="outline" onClick={() => navigate("/estimates")} className="gap-2">
          <ArrowRight size={16} /> رجوع
        </Button>
        </div>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Estimate Type</Label>
          <Select value={form.estimate_type || "independent"} onValueChange={(v) => setForm({ ...form, estimate_type: v as EstimateType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="independent">Independent Estimate</SelectItem>
              <SelectItem value="insurance">Insurance Estimate</SelectItem>
              <SelectItem value="supplementary">Supplementary Estimate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 relative">
          <Label>Search Vehicle / Claim / Work Order</Label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث عن المركبة أو رقم المطالبة أو أمر العمل"
              className="pr-9"
            />
            {searchLoading && <Loader2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {(searchResults.length > 0 || searchError || (searchTerm.trim().length >= 2 && !searchLoading)) && (
            <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-lg">
              {searchError && <div className="p-2 text-sm text-destructive">{searchError}</div>}
              {!searchError && searchResults.length === 0 && <div className="p-2 text-sm text-muted-foreground">No results</div>}
              {searchResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => selectSearchResult(result)}
                  className="w-full rounded-sm px-3 py-2 text-right hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{result.title}</span>
                    <span className="text-[11px] uppercase text-muted-foreground">{result.type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{result.subtitle || "—"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRecord && (
          <div className="md:col-span-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">Selected: {selectedRecord.title}</div>
            <div className="text-muted-foreground">{selectedRecord.subtitle || "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              روابط محفوظة: customer_id {selectedRecord.customer_id ? "✓" : "—"} • vehicle_id {selectedRecord.vehicle_id ? "✓" : "—"} • claim_id {selectedRecord.claim_id ? "✓" : "—"} • work_order_id {selectedRecord.work_order_id ? "✓" : "—"}
            </div>
          </div>
        )}
        {(selectedCustomer || selectedVehicle || selectedClaim || selectedWorkOrder) && (
          <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-slate-50/70 p-3 text-sm">
              <div className="mb-2 font-semibold">Customer</div>
              <div>{selectedCustomer?.customer_code || "—"} • {selectedCustomer?.name || "—"}</div>
              <div className="text-muted-foreground">{selectedCustomer?.phone || "—"}</div>
              <div className="text-muted-foreground">{selectedCustomer?.email || "—"}</div>
            </div>
            <div className="rounded-lg border bg-slate-50/70 p-3 text-sm">
              <div className="mb-2 font-semibold">Vehicle</div>
              <div>{[selectedVehicle?.brand || selectedVehicle?.make, selectedVehicle?.model, selectedVehicle?.year].filter(Boolean).join(" ") || "—"}</div>
              <div className="text-muted-foreground">{[selectedVehicle?.plate_letters, selectedVehicle?.plate_number].filter(Boolean).join(" ") || "—"}</div>
              <div className="text-muted-foreground">VIN: {selectedVehicle?.vin_number || selectedVehicle?.vin || "—"} • Color: {selectedVehicle?.color || "—"}</div>
            </div>
            <div className="rounded-lg border bg-slate-50/70 p-3 text-sm">
              <div className="mb-2 font-semibold">Insurance / Source</div>
              <div>{selectedClaim?.claim_number || "—"} • {selectedClaim?.insurance_company || "—"}</div>
              <div className="text-muted-foreground">Work Order: {selectedWorkOrder?.order_number || "—"}</div>
              <div className="text-muted-foreground">Policy: {selectedClaim?.policy_number || "—"} • Surveyor: {selectedClaim?.surveyor || "—"}</div>
            </div>
          </div>
        )}
        <div>
          <Label>Estimate Date</Label>
          <Input type="date" value={form.estimate_date || ""} onChange={(e) => setForm({ ...form, estimate_date: e.target.value })} />
        </div>
        <div>
          <Label>Valid Until</Label>
          <Input type="date" value={form.valid_until || ""} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
        </div>
        <div>
          <Label>Customer</Label>
          <Select value={form.customer_id || "none"} onValueChange={(v) => setForm({ ...form, customer_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.customer_code || "CUST"} • {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Vehicle</Label>
          <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر المركبة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate_number || "—"} • {[v.brand || v.make, v.model].filter(Boolean).join(" ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.estimate_type === "insurance" && (
        <div>
          <Label>Claim</Label>
          <Select value={form.claim_id || "none"} onValueChange={onClaimChange}>
            <SelectTrigger><SelectValue placeholder="اختر المطالبة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.claims.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.claim_number} • {c.insurance_company}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        )}
        <div>
          <Label>Work Order</Label>
          <Select value={form.work_order_id || "none"} onValueChange={(v) => setForm({ ...form, work_order_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر أمر العمل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.workOrders.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.order_number} • {w.status}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.estimate_type === "supplementary" && (
          <div>
            <Label>Parent Estimate</Label>
            <Select value={form.parent_estimate_id || "none"} onValueChange={(v) => setForm({ ...form, parent_estimate_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="اختر التقدير الأصلي" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— اختر —</SelectItem>
                {lookups?.estimates.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.estimate_number} • {formatOMR(e.total)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Purpose / Reason</Label>
          <Input value={form.purpose || ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">البنود</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-2"><Plus size={14} /> بند</Button>
        </div>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 md:col-span-2">
                <Label>الفئة</Label>
                <Select value={item.category} onValueChange={(v) => patchItem(index, { category: v as EstimateItemCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ESTIMATE_CATEGORY_LABEL).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label.ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-12 md:col-span-4">
                <Label>الوصف</Label>
                <Input value={item.description_ar || ""} onChange={(e) => patchItem(index, { description_ar: e.target.value })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label>الكمية</Label>
                <Input type="number" step="0.001" value={item.quantity} onChange={(e) => patchItem(index, { quantity: Number(e.target.value) })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label>السعر قبل VAT</Label>
                <Input type="number" step="0.001" value={item.unit_price} onChange={(e) => patchItem(index, { unit_price: Number(e.target.value) })} />
              </div>
              <div className="col-span-3 md:col-span-1 text-sm font-mono pb-2">{formatOMR((Number(item.quantity) || 0) * (Number(item.unit_price) || 0), "")}</div>
              <div className="col-span-1">
                <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} className="text-destructive">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
        <Card className="p-4 space-y-3">
          <div>
            <Label>Terms</Label>
            <Textarea rows={4} value={form.terms || ""} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="font-semibold">تفعيل الضريبة VAT 5%</div>
              <div className="text-xs text-muted-foreground">OFF افتراضيًا. عند الإغلاق يبقى subtotal = total.</div>
            </div>
            <Switch checked={Boolean(form.vat_enabled)} onCheckedChange={(checked) => setForm({ ...form, vat_enabled: checked })} />
          </div>
          <div className="flex justify-between"><span>Subtotal before VAT</span><strong>{formatOMR(totals.subtotal)}</strong></div>
          <div className="flex justify-between"><span>{form.vat_enabled ? "VAT 5%" : "VAT: Not Applied"}</span><strong>{formatOMR(totals.vat_amount)}</strong></div>
          <div className="flex justify-between text-lg border-t pt-2"><span>Total</span><strong>{formatOMR(totals.total)}</strong></div>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="w-full gap-2 mt-3">
            <Save size={16} /> حفظ
          </Button>
        </Card>
      </div>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Extract from Image / Document</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-3">
              <div>
                <Label>File</Label>
                <Input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setAiFile(event.target.files?.[0] || null)}
                />
                {aiFile && <div className="mt-1 text-xs text-muted-foreground">{aiFile.name} • {(aiFile.size / 1024).toFixed(1)} KB • {aiFile.type || "unknown"}</div>}
              </div>
              <div>
                <Label>Document Type</Label>
                <Select value={aiDocType} onValueChange={setAiDocType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto Detect</SelectItem>
                    <SelectItem value="estimate">Estimate</SelectItem>
                    <SelectItem value="insurance_estimate">Insurance Estimate</SelectItem>
                    <SelectItem value="parts_quotation">Parts Quotation</SelectItem>
                    <SelectItem value="inspection_report">Inspection Report</SelectItem>
                    <SelectItem value="claim_document">Claim Document</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Language</Label>
                <Select value={aiLanguage} onValueChange={setAiLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="ar">Arabic</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar_en">Arabic + English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" onClick={analyzeAiFile} disabled={aiStatus === "processing"} className="w-full gap-2">
                {aiStatus === "processing" ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                Analyze File
              </Button>
              <div className="rounded-md border p-2 text-xs">
                Status: <strong>{aiStatus}</strong>
                {aiError && <div className="mt-1 text-destructive">{aiError}</div>}
                {aiVatSuggested && (
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.vat_enabled)} onChange={(e) => setForm({ ...form, vat_enabled: e.target.checked })} />
                    VAT 5% was detected. Enable VAT in this estimate.
                  </label>
                )}
              </div>
            </div>
            <div className="md:col-span-2 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-right">Field</th>
                    <th className="p-2 text-right">Current</th>
                    <th className="p-2 text-right">Extracted</th>
                    <th className="p-2 text-right">Confidence</th>
                    <th className="p-2 text-right">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {aiFields.length === 0 && (
                    <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No extracted fields yet.</td></tr>
                  )}
                  {aiFields.map((field, index) => (
                    <tr key={`${field.key}-${index}`} className="border-t">
                      <td className="p-2 font-medium">{field.label}</td>
                      <td className="p-2 text-muted-foreground">{field.current || "—"}</td>
                      <td className="p-2">
                        <Input value={field.extracted} onChange={(event) => patchAiField(index, { extracted: event.target.value })} />
                      </td>
                      <td className="p-2">
                        <span className={field.confidence === "high" ? "text-emerald-700" : field.confidence === "medium" ? "text-amber-700" : "text-red-700"}>
                          {field.confidence}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={field.apply} onChange={(event) => patchAiField(index, { apply: event.target.checked })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {aiItems.length > 0 && (
                <div className="border-t p-3 text-sm">
                  <div className="font-semibold">Draft items extracted: {aiItems.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Items are applied only after confirmation. Review quantities and prices before saving.</div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" type="button" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button variant="secondary" type="button" onClick={analyzeAiFile} disabled={aiStatus === "processing"}>Re-analyze</Button>
            <Button variant="outline" type="button" onClick={() => applyExtractedFields(false)} disabled={aiFields.length === 0 && aiItems.length === 0}>Apply Selected</Button>
            <Button type="button" onClick={() => applyExtractedFields(true)} disabled={aiFields.length === 0 && aiItems.length === 0}>Apply All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
