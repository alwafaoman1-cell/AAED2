import { supabase } from "@/integrations/supabase/client";
import { calculateVatExclusive, roundMoney } from "@/lib/money";

export type EstimateType = "independent" | "insurance" | "supplementary";
export type EstimateStatus = "draft" | "issued" | "approved" | "rejected" | "converted" | "expired" | "archived";
export type EstimateItemCategory =
  | "labor"
  | "parts"
  | "paint_materials"
  | "mechanical"
  | "electrical"
  | "programming"
  | "diagnosis"
  | "sublet"
  | "transport"
  | "other";

export interface EstimateItemInput {
  id?: string;
  category: EstimateItemCategory;
  description_ar?: string | null;
  description_en?: string | null;
  quantity: number;
  unit_price: number;
  vat_rate?: number;
  notes?: string | null;
}

export interface UnifiedEstimate {
  id: string;
  tenant_id: string;
  estimate_number: string;
  estimate_type: EstimateType;
  status: EstimateStatus;
  customer_id: string | null;
  vehicle_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  insurance_company_id: string | null;
  insurance_employee_id: string | null;
  parent_estimate_id: string | null;
  title: string | null;
  purpose: string | null;
  estimate_date: string;
  valid_until: string | null;
  currency: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  internal_notes: string | null;
  issued_at: string | null;
  issued_by: string | null;
  converted_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  customer?: { id: string; name: string | null; phone: string | null; customer_code?: string | null } | null;
  vehicle?: { id: string; brand?: string | null; make?: string | null; model: string | null; plate_number: string | null; vin?: string | null; vin_number?: string | null; year?: number | null } | null;
  claim?: { id: string; claim_number: string | null; insurance_company: string | null } | null;
  work_order?: { id: string; order_number: string | null; status: string | null } | null;
  items?: UnifiedEstimateItem[];
}

export interface UnifiedEstimateItem extends EstimateItemInput {
  id: string;
  tenant_id: string;
  estimate_id: string;
  line_subtotal: number;
  vat_rate: number;
  vat_amount: number;
  line_total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const ESTIMATE_TYPE_LABEL: Record<EstimateType, { ar: string; en: string }> = {
  independent: { ar: "تقدير إصلاح مستقل", en: "Independent Repair Estimate" },
  insurance: { ar: "تقدير تأمين", en: "Insurance Estimate" },
  supplementary: { ar: "تقدير إضافي", en: "Supplementary Estimate" },
};

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatus, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  issued: { ar: "صادر", en: "Issued" },
  approved: { ar: "معتمد", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  converted: { ar: "محول", en: "Converted" },
  expired: { ar: "منتهي", en: "Expired" },
  archived: { ar: "مؤرشف", en: "Archived" },
};

export const ESTIMATE_CATEGORY_LABEL: Record<EstimateItemCategory, { ar: string; en: string }> = {
  labor: { ar: "عمالة", en: "Labor" },
  parts: { ar: "قطع غيار", en: "Parts" },
  paint_materials: { ar: "دهان ومواد", en: "Paint/Materials" },
  mechanical: { ar: "ميكانيك", en: "Mechanical" },
  electrical: { ar: "كهرباء", en: "Electrical" },
  programming: { ar: "برمجة", en: "Programming" },
  diagnosis: { ar: "فحص وتشخيص", en: "Diagnosis" },
  sublet: { ar: "عمل خارجي", en: "Sublet" },
  transport: { ar: "نقل", en: "Transport" },
  other: { ar: "أخرى", en: "Other" },
};

export function calculateEstimateItem(item: EstimateItemInput, fallbackVatRate = 5) {
  const quantity = roundMoney(item.quantity || 0);
  const unitPrice = roundMoney(item.unit_price || 0);
  const vatRatePercent = Number(item.vat_rate ?? fallbackVatRate);
  const lineSubtotal = roundMoney(quantity * unitPrice);
  const vat = calculateVatExclusive(lineSubtotal, vatRatePercent / 100);
  return {
    quantity,
    unit_price: unitPrice,
    line_subtotal: vat.subtotalBeforeVat,
    vat_rate: vatRatePercent,
    vat_amount: vat.vatAmount,
    line_total: vat.totalIncludingVat,
  };
}

export function calculateEstimateTotals(items: EstimateItemInput[], vatRate = 5) {
  const calculated = items.map((item) => calculateEstimateItem(item, vatRate));
  const subtotal = roundMoney(calculated.reduce((sum, item) => sum + item.line_subtotal, 0));
  const vatAmount = roundMoney(calculated.reduce((sum, item) => sum + item.vat_amount, 0));
  const total = roundMoney(subtotal + vatAmount);
  return { subtotal, vat_rate: vatRate, vat_amount: vatAmount, total };
}

const estimateSelect = `
  *,
  customer:customers(id,name,phone,customer_code),
  vehicle:vehicles(id,brand,model,plate_number,vin,vin_number,year),
  claim:insurance_claims(id,claim_number,insurance_company),
  work_order:job_orders(id,order_number,status)
`;

export async function listUnifiedEstimates() {
  const { data, error } = await supabase
    .from("estimates" as any)
    .select(estimateSelect)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as UnifiedEstimate[];
}

export async function getUnifiedEstimate(id: string) {
  const { data, error } = await supabase
    .from("estimates" as any)
    .select(estimateSelect)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: items, error: itemsError } = await supabase
    .from("estimate_items" as any)
    .select("*")
    .eq("estimate_id", id)
    .order("sort_order", { ascending: true });
  if (itemsError) throw itemsError;
  return { ...(data as any), items: items || [] } as UnifiedEstimate;
}

export async function createUnifiedEstimate(payload: {
  estimate: Partial<UnifiedEstimate>;
  items: EstimateItemInput[];
}) {
  const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
  if (tenantError) throw tenantError;
  if (!tenantId) throw new Error("تعذر تحديد المستأجر الحالي");
  const { data: userData } = await supabase.auth.getUser();
  const totals = calculateEstimateTotals(payload.items, Number(payload.estimate.vat_rate ?? 5));
  const { data: estimate, error } = await supabase
    .from("estimates" as any)
    .insert({
      ...payload.estimate,
      tenant_id: tenantId,
      created_by: userData.user?.id ?? null,
      currency: payload.estimate.currency || "OMR",
      estimate_date: payload.estimate.estimate_date || new Date().toISOString().slice(0, 10),
      ...totals,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  const savedEstimate = estimate as any;

  const rows = payload.items.map((item, index) => ({
    tenant_id: tenantId,
    estimate_id: savedEstimate.id,
    category: item.category || "other",
    description_ar: item.description_ar || null,
    description_en: item.description_en || null,
    notes: item.notes || null,
    sort_order: index,
    ...calculateEstimateItem(item, Number(payload.estimate.vat_rate ?? 5)),
  }));
  if (rows.length) {
    const { error: itemsError } = await supabase.from("estimate_items" as any).insert(rows as any);
    if (itemsError) throw itemsError;
  }
  return savedEstimate as UnifiedEstimate;
}

export async function updateUnifiedEstimate(id: string, payload: {
  estimate: Partial<UnifiedEstimate>;
  items?: EstimateItemInput[];
}) {
  const patch: Record<string, unknown> = { ...payload.estimate };
  if (payload.items) {
    Object.assign(patch, calculateEstimateTotals(payload.items, Number(payload.estimate.vat_rate ?? 5)));
  }
  const { error } = await supabase.from("estimates" as any).update(patch as any).eq("id", id);
  if (error) throw error;

  if (payload.items) {
    const { data: current, error: currentError } = await supabase
      .from("estimates" as any)
      .select("tenant_id,vat_rate")
      .eq("id", id)
      .single();
    if (currentError) throw currentError;
    const currentEstimate = current as any;
    await supabase.from("estimate_items" as any).delete().eq("estimate_id", id);
    const rows = payload.items.map((item, index) => ({
      tenant_id: currentEstimate.tenant_id,
      estimate_id: id,
      category: item.category || "other",
      description_ar: item.description_ar || null,
      description_en: item.description_en || null,
      notes: item.notes || null,
      sort_order: index,
      ...calculateEstimateItem(item, Number(currentEstimate.vat_rate ?? 5)),
    }));
    if (rows.length) {
      const { error: itemsError } = await supabase.from("estimate_items" as any).insert(rows as any);
      if (itemsError) throw itemsError;
    }
  }
}

export async function issueUnifiedEstimate(id: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("estimates" as any)
    .update({
      status: "issued",
      issued_at: new Date().toISOString(),
      issued_by: userData.user?.id ?? null,
    } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function archiveUnifiedEstimate(id: string) {
  const { error } = await supabase
    .from("estimates" as any)
    .update({ status: "archived", archived_at: new Date().toISOString() } as any)
    .eq("id", id);
  if (error) throw error;
}
