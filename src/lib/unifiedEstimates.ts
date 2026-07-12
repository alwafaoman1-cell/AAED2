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
  vat_enabled?: boolean | null;
  vat_amount: number;
  total: number;
  vehicle_received_at?: string | null;
  work_started_at?: string | null;
  vehicle_delivered_at?: string | null;
  vehicle_presence_status?: "in_workshop" | "with_customer" | "at_insurer" | "at_copart" | "external_vendor" | null;
  vehicle_location_section?: string | null;
  vehicle_location_bay?: string | null;
  vehicle_location_note?: string | null;
  legacy_source?: string | null;
  legacy_id?: string | null;
  legacy_number?: string | null;
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
  claim?: { id: string; claim_number: string | null; insurance_company: string | null; job_order_id?: string | null; auto_job_order_id?: string | null } | null;
  work_order?: { id: string; order_number: string | null; status: string | null } | null;
  items?: UnifiedEstimateItem[];
}

export type EstimateConversionTarget = "work_order" | "insurance_claim" | "insurance_work_order" | "supplementary_link";

export interface EstimateConversionResult {
  target: EstimateConversionTarget;
  target_entity_type: "work_order" | "insurance_claim" | "estimate";
  target_entity_id: string | null;
  target_number?: string | null;
  existing_record_used: boolean;
  message: string;
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

export function calculateEstimateItem(item: EstimateItemInput, fallbackVatRate = 5, vatEnabled = true) {
  const quantity = roundMoney(item.quantity || 0);
  const unitPrice = roundMoney(item.unit_price || 0);
  const vatRatePercent = Number(item.vat_rate ?? fallbackVatRate);
  const lineSubtotal = roundMoney(quantity * unitPrice);
  if (!vatEnabled) {
    return {
      quantity,
      unit_price: unitPrice,
      line_subtotal: lineSubtotal,
      vat_rate: vatRatePercent,
      vat_amount: 0,
      line_total: lineSubtotal,
    };
  }
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

export function calculateEstimateTotals(items: EstimateItemInput[], vatRate = 5, vatEnabled = true) {
  const calculated = items.map((item) => calculateEstimateItem(item, vatRate, vatEnabled));
  const subtotal = roundMoney(calculated.reduce((sum, item) => sum + item.line_subtotal, 0));
  const vatAmount = roundMoney(calculated.reduce((sum, item) => sum + item.vat_amount, 0));
  const total = roundMoney(subtotal + vatAmount);
  return { subtotal, vat_rate: vatRate, vat_amount: vatAmount, total };
}

const estimateSelect = `
  *,
  customer:customers(id,name,phone,customer_code),
  vehicle:vehicles(id,brand,model,plate_number,vin,vin_number,year),
  claim:insurance_claims(id,claim_number,insurance_company,job_order_id,auto_job_order_id),
  work_order:job_orders(id,order_number,status)
`;

function isMissingSchemaColumnError(error: unknown): boolean {
  const raw = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return raw.includes("pgrst204") || (raw.includes("schema cache") && raw.includes("could not find"));
}

function requireEstimateIdentity(estimate: UnifiedEstimate) {
  if (!estimate.customer_id) throw new Error("لا يمكن التحويل بدون عميل مرتبط بالتقدير.");
  if (!estimate.vehicle_id) throw new Error("لا يمكن التحويل بدون مركبة مرتبطة بالتقدير.");
}

function parseNumber(value: string, prefix: string) {
  const match = String(value || "").trim().match(new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`, "i"));
  return match ? { year: match[1], seq: Number(match[2]), padding: match[2].length } : null;
}

async function allocateWorkOrderNumber(tenantId: string) {
  const year = new Date().getFullYear().toString();
  const { data, error } = await supabase
    .from("job_orders" as any)
    .select("order_number")
    .eq("tenant_id", tenantId)
    .ilike("order_number", `WO-${year}-%`)
    .limit(10000);
  if (error) throw error;
  let max = 0;
  for (const row of (data || []) as Array<{ order_number?: string | null }>) {
    const parsed = parseNumber(row.order_number || "", "WO");
    if (parsed?.year === year && Number.isFinite(parsed.seq)) max = Math.max(max, parsed.seq);
  }
  return `WO-${year}-${String(max + 1).padStart(4, "0")}`;
}

async function insertClaimAudit(tenantId: string, claimId: string | null | undefined, action: string, details: Record<string, unknown>, userId?: string | null) {
  if (!claimId) return;
  const { error } = await supabase.from("claim_audit_logs" as any).insert({
    tenant_id: tenantId,
    claim_id: claimId,
    user_id: userId || null,
    action,
    category: "estimate_conversion",
    details,
  } as any);
  if (error) console.warn("[estimate conversion] claim audit skipped", error);
}

async function insertConversionAudit(args: {
  tenantId: string;
  estimateId: string;
  conversionType: string;
  targetEntityType: "work_order" | "insurance_claim" | "estimate";
  targetEntityId: string | null;
  existingRecordUsed: boolean;
  notes?: string;
  userId?: string | null;
}) {
  const { error } = await supabase.from("estimate_conversion_audit" as any).insert({
    tenant_id: args.tenantId,
    estimate_id: args.estimateId,
    conversion_type: args.conversionType,
    target_entity_type: args.targetEntityType,
    target_entity_id: args.targetEntityId,
    converted_by: args.userId || null,
    existing_record_used: args.existingRecordUsed,
    notes: args.notes || null,
  } as any);
  if (error && !isMissingSchemaColumnError(error)) throw error;
}

async function fetchEstimateForConversion(id: string) {
  const estimate = await getUnifiedEstimate(id);
  if (!estimate) throw new Error("التقدير غير موجود.");
  return estimate;
}

async function findWorkOrderByEstimateOrClaim(estimate: UnifiedEstimate) {
  if (estimate.work_order_id) {
    const { data, error } = await supabase
      .from("job_orders" as any)
      .select("id,order_number,status")
      .eq("id", estimate.work_order_id)
      .maybeSingle();
    if (error) throw error;
    const row = data as any;
    if (row?.id) return row;
  }

  let bySource = await supabase
    .from("job_orders" as any)
    .select("id,order_number,status")
    .eq("tenant_id", estimate.tenant_id)
    .eq("source_estimate_id", estimate.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (bySource.error && isMissingSchemaColumnError(bySource.error)) {
    bySource = { data: null, error: null } as any;
  }
  if (bySource.error) throw bySource.error;
  const bySourceRow = bySource.data as any;
  if (bySourceRow?.id) return bySourceRow;

  if (estimate.claim_id) {
    const { data, error } = await supabase
      .from("job_orders" as any)
      .select("id,order_number,status")
      .eq("tenant_id", estimate.tenant_id)
      .eq("claim_id", estimate.claim_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const row = data as any;
    if (row?.id) return row;
  }
  return null;
}

async function findClaimByEstimateOrNumber(estimate: UnifiedEstimate, claimNumber?: string) {
  if (estimate.claim_id) {
    const { data, error } = await supabase
      .from("insurance_claims" as any)
      .select("id,claim_number,insurance_company,job_order_id,auto_job_order_id")
      .eq("id", estimate.claim_id)
      .maybeSingle();
    if (error) throw error;
    const row = data as any;
    if (row?.id) return row;
  }

  let bySource = await supabase
    .from("insurance_claims" as any)
    .select("id,claim_number,insurance_company,job_order_id,auto_job_order_id")
    .eq("tenant_id", estimate.tenant_id)
    .eq("source_estimate_id", estimate.id)
    .maybeSingle();
  if (bySource.error && isMissingSchemaColumnError(bySource.error)) {
    bySource = { data: null, error: null } as any;
  }
  if (bySource.error) throw bySource.error;
  const bySourceRow = bySource.data as any;
  if (bySourceRow?.id) return bySourceRow;

  if (claimNumber) {
    const { data, error } = await supabase
      .from("insurance_claims" as any)
      .select("id,claim_number,insurance_company,job_order_id,auto_job_order_id")
      .eq("tenant_id", estimate.tenant_id)
      .eq("claim_number", claimNumber)
      .maybeSingle();
    if (error) throw error;
    const row = data as any;
    if (row?.id) return row;
  }
  return null;
}

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
  const vatEnabled = Boolean(payload.estimate.vat_enabled);
  const totals = calculateEstimateTotals(payload.items, Number(payload.estimate.vat_rate ?? 5), vatEnabled);
  const { data: estimate, error } = await supabase
    .from("estimates" as any)
    .insert({
      ...payload.estimate,
      tenant_id: tenantId,
      created_by: userData.user?.id ?? null,
      currency: payload.estimate.currency || "OMR",
      estimate_date: payload.estimate.estimate_date || new Date().toISOString().slice(0, 10),
      vat_enabled: vatEnabled,
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
    ...calculateEstimateItem(item, Number(payload.estimate.vat_rate ?? 5), vatEnabled),
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
    const vatEnabled = Boolean(payload.estimate.vat_enabled);
    patch.vat_enabled = vatEnabled;
    Object.assign(patch, calculateEstimateTotals(payload.items, Number(payload.estimate.vat_rate ?? 5), vatEnabled));
  }
  const { error } = await supabase.from("estimates" as any).update(patch as any).eq("id", id);
  if (error) throw error;

  if (payload.items) {
    const { data: current, error: currentError } = await supabase
      .from("estimates" as any)
      .select("tenant_id,vat_rate,vat_enabled")
      .eq("id", id)
      .single();
    if (currentError) throw currentError;
    const currentEstimate = current as any;
    const vatEnabled = Boolean((payload.estimate as any).vat_enabled ?? currentEstimate.vat_enabled);
    await supabase.from("estimate_items" as any).delete().eq("estimate_id", id);
    const rows = payload.items.map((item, index) => ({
      tenant_id: currentEstimate.tenant_id,
      estimate_id: id,
      category: item.category || "other",
      description_ar: item.description_ar || null,
      description_en: item.description_en || null,
      notes: item.notes || null,
      sort_order: index,
      ...calculateEstimateItem(item, Number(currentEstimate.vat_rate ?? 5), vatEnabled),
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

export async function convertUnifiedEstimate(id: string, target: EstimateConversionTarget): Promise<EstimateConversionResult> {
  const estimate = await fetchEstimateForConversion(id);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  const convertedAt = new Date().toISOString();

  if (target === "supplementary_link") {
    if (estimate.estimate_type !== "supplementary") throw new Error("هذا الإجراء مخصص للتقدير الإضافي فقط.");
    if (!estimate.parent_estimate_id) throw new Error("التقدير الإضافي غير مرتبط بتقدير أصلي.");
    const parent = await getUnifiedEstimate(estimate.parent_estimate_id);
    if (!parent) throw new Error("التقدير الأصلي غير موجود.");
    const claimId = estimate.claim_id || parent.claim_id || null;
    const workOrderId = estimate.work_order_id || parent.work_order_id || null;
    if (!claimId && !workOrderId) throw new Error("لا توجد مطالبة أو أمر عمل أصلي للربط.");
    const { error } = await supabase
      .from("estimates" as any)
      .update({
        claim_id: claimId,
        work_order_id: workOrderId,
        status: "converted",
        converted_at: convertedAt,
      } as any)
      .eq("id", estimate.id);
    if (error) throw error;
    await insertConversionAudit({
      tenantId: estimate.tenant_id,
      estimateId: estimate.id,
      conversionType: "supplementary_link",
      targetEntityType: claimId ? "insurance_claim" : "work_order",
      targetEntityId: claimId || workOrderId,
      existingRecordUsed: true,
      notes: `Linked supplementary estimate to parent ${parent.estimate_number}`,
      userId,
    });
    await insertClaimAudit(estimate.tenant_id, claimId, "supplementary_estimate_linked", { estimate_number: estimate.estimate_number, parent_estimate_id: parent.id }, userId);
    return {
      target,
      target_entity_type: claimId ? "insurance_claim" : "work_order",
      target_entity_id: claimId || workOrderId,
      existing_record_used: true,
      message: "تم ربط التقدير الإضافي بالسجل الأصلي بدون إنشاء سجلات مكررة.",
    };
  }

  if (target === "work_order") {
    if (estimate.estimate_type !== "independent") throw new Error("تحويل أمر العمل المباشر مخصص للتقدير المستقل.");
    requireEstimateIdentity(estimate);
    const existing = await findWorkOrderByEstimateOrClaim(estimate);
    if (existing?.id) {
      await supabase.from("estimates" as any).update({ work_order_id: existing.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
      await insertConversionAudit({
        tenantId: estimate.tenant_id,
        estimateId: estimate.id,
        conversionType: "independent_to_work_order",
        targetEntityType: "work_order",
        targetEntityId: existing.id,
        existingRecordUsed: true,
        notes: "Existing linked work order reused",
        userId,
      });
      return { target, target_entity_type: "work_order", target_entity_id: existing.id, target_number: existing.order_number, existing_record_used: true, message: "يوجد أمر عمل مرتبط مسبقًا، تم فتح/استخدام الموجود." };
    }

    let created: any = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const orderNumber = await allocateWorkOrderNumber(estimate.tenant_id);
      const payload: Record<string, unknown> = {
        tenant_id: estimate.tenant_id,
        customer_id: estimate.customer_id,
        vehicle_id: estimate.vehicle_id,
        order_number: orderNumber,
        status: "received",
        description: estimate.purpose || estimate.title || `Estimate ${estimate.estimate_number}`,
        diagnosis: estimate.notes || null,
        labor_cost: 0,
        parts_cost: 0,
        subtotal: estimate.subtotal,
        vat: estimate.vat_amount,
        final_total: estimate.total,
        work_order_type: "general_customer",
        source_estimate_id: estimate.id,
        work_items: (estimate.items || []).map((item) => ({ title: item.description_ar || item.description_en || item.category, note: item.notes || null })),
        metadata: { source: "estimate_conversion", estimate_id: estimate.id, estimate_number: estimate.estimate_number },
      };
      const { data, error } = await supabase.from("job_orders" as any).insert(payload as any).select("id,order_number,status").single();
      if (error && isMissingSchemaColumnError(error)) {
        delete payload.source_estimate_id;
        const fallback = await supabase.from("job_orders" as any).insert(payload as any).select("id,order_number,status").single();
        if (fallback.error) throw fallback.error;
        created = fallback.data;
      } else if (error && `${error.message || ""}`.toLowerCase().includes("duplicate")) {
        continue;
      } else if (error) {
        throw error;
      } else {
        created = data;
      }
    }
    if (!created?.id) throw new Error("تعذر إنشاء أمر العمل بدون تكرار. أعد المحاولة.");
    await supabase.from("estimates" as any).update({ work_order_id: created.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
    await insertConversionAudit({
      tenantId: estimate.tenant_id,
      estimateId: estimate.id,
      conversionType: "independent_to_work_order",
      targetEntityType: "work_order",
      targetEntityId: created.id,
      existingRecordUsed: false,
      notes: "Created work order from independent estimate",
      userId,
    });
    return { target, target_entity_type: "work_order", target_entity_id: created.id, target_number: created.order_number, existing_record_used: false, message: "تم إنشاء أمر العمل من التقدير المستقل." };
  }

  if (target === "insurance_claim") {
    if (estimate.estimate_type !== "insurance") throw new Error("تحويل المطالبة مخصص لتقدير التأمين.");
    requireEstimateIdentity(estimate);
    const generatedClaimNumber = `CLM-${estimate.estimate_number.replace(/^EST-/i, "")}`;
    const existing = await findClaimByEstimateOrNumber(estimate, generatedClaimNumber);
    if (existing?.id) {
      await supabase.from("estimates" as any).update({ claim_id: existing.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
      await insertConversionAudit({
        tenantId: estimate.tenant_id,
        estimateId: estimate.id,
        conversionType: "insurance_to_claim",
        targetEntityType: "insurance_claim",
        targetEntityId: existing.id,
        existingRecordUsed: true,
        notes: "Existing linked claim reused",
        userId,
      });
      await insertClaimAudit(estimate.tenant_id, existing.id, "estimate_linked", { estimate_number: estimate.estimate_number }, userId);
      return { target, target_entity_type: "insurance_claim", target_entity_id: existing.id, target_number: existing.claim_number, existing_record_used: true, message: "يوجد مطالبة مرتبطة مسبقًا، تم استخدام الموجودة." };
    }

    const claimPayload: Record<string, unknown> = {
      tenant_id: estimate.tenant_id,
      customer_id: estimate.customer_id,
      vehicle_id: estimate.vehicle_id,
      claim_number: generatedClaimNumber,
      insurance_company: estimate.claim?.insurance_company || "Insurance Company",
      estimated_amount: estimate.subtotal,
      approved_amount: estimate.subtotal,
      status: "pending",
      estimation_type: "lump_sum",
      source_estimate_id: estimate.id,
      notes: estimate.notes || `Created from estimate ${estimate.estimate_number}`,
    };
    let { data: claim, error } = await supabase.from("insurance_claims" as any).insert(claimPayload as any).select("id,claim_number,insurance_company").single();
    if (error && isMissingSchemaColumnError(error)) {
      delete claimPayload.source_estimate_id;
      ({ data: claim, error } = await supabase.from("insurance_claims" as any).insert(claimPayload as any).select("id,claim_number,insurance_company").single());
    }
    if (error) throw error;
    const createdClaim = claim as any;
    await supabase.from("estimates" as any).update({ claim_id: createdClaim.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
    await insertConversionAudit({
      tenantId: estimate.tenant_id,
      estimateId: estimate.id,
      conversionType: "insurance_to_claim",
      targetEntityType: "insurance_claim",
      targetEntityId: createdClaim.id,
      existingRecordUsed: false,
      notes: "Created insurance claim from insurance estimate",
      userId,
    });
    await insertClaimAudit(estimate.tenant_id, createdClaim.id, "created_from_estimate", { estimate_number: estimate.estimate_number }, userId);
    return { target, target_entity_type: "insurance_claim", target_entity_id: createdClaim.id, target_number: createdClaim.claim_number, existing_record_used: false, message: "تم إنشاء مطالبة التأمين من التقدير." };
  }

  if (target === "insurance_work_order") {
    if (estimate.estimate_type !== "insurance") throw new Error("أمر العمل التأميني مخصص لتقدير التأمين.");
    requireEstimateIdentity(estimate);
    let claim = await findClaimByEstimateOrNumber(estimate, `CLM-${estimate.estimate_number.replace(/^EST-/i, "")}`);
    if (!claim?.id) {
      const claimResult = await convertUnifiedEstimate(estimate.id, "insurance_claim");
      claim = await findClaimByEstimateOrNumber({ ...estimate, claim_id: claimResult.target_entity_id } as UnifiedEstimate);
    }
    if (!claim?.id) throw new Error("تعذر إنشاء/ربط المطالبة قبل أمر العمل التأميني.");
    const withClaim = { ...estimate, claim_id: claim.id };
    const existing = await findWorkOrderByEstimateOrClaim(withClaim as UnifiedEstimate);
    if (existing?.id) {
      await supabase.from("estimates" as any).update({ claim_id: claim.id, work_order_id: existing.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
      await insertConversionAudit({
        tenantId: estimate.tenant_id,
        estimateId: estimate.id,
        conversionType: "insurance_to_work_order",
        targetEntityType: "work_order",
        targetEntityId: existing.id,
        existingRecordUsed: true,
        notes: "Existing insurance work order reused",
        userId,
      });
      await insertClaimAudit(estimate.tenant_id, claim.id, "estimate_work_order_linked", { estimate_number: estimate.estimate_number, work_order_id: existing.id }, userId);
      return { target, target_entity_type: "work_order", target_entity_id: existing.id, target_number: existing.order_number, existing_record_used: true, message: "يوجد أمر عمل تأميني مرتبط مسبقًا، تم استخدام الموجود." };
    }

    const orderNumber = await allocateWorkOrderNumber(estimate.tenant_id);
    const orderPayload: Record<string, unknown> = {
      tenant_id: estimate.tenant_id,
      customer_id: estimate.customer_id,
      vehicle_id: estimate.vehicle_id,
      order_number: orderNumber,
      status: "received",
      description: estimate.purpose || `Insurance estimate ${estimate.estimate_number}`,
      diagnosis: estimate.notes || null,
      labor_cost: 0,
      parts_cost: 0,
      subtotal: estimate.subtotal,
      vat: estimate.vat_amount,
      final_total: estimate.total,
      work_order_type: "insurance",
      claim_id: claim.id,
      insurance_company: claim.insurance_company || estimate.claim?.insurance_company || null,
      insurance_claim_number: claim.claim_number || null,
      source_estimate_id: estimate.id,
      work_items: (estimate.items || []).map((item) => ({ title: item.description_ar || item.description_en || item.category, note: item.notes || null })),
      metadata: { source: "estimate_conversion", estimate_id: estimate.id, estimate_number: estimate.estimate_number },
    };
    let { data: workOrder, error } = await supabase.from("job_orders" as any).insert(orderPayload as any).select("id,order_number,status").single();
    if (error && isMissingSchemaColumnError(error)) {
      delete orderPayload.source_estimate_id;
      ({ data: workOrder, error } = await supabase.from("job_orders" as any).insert(orderPayload as any).select("id,order_number,status").single());
    }
    if (error) throw error;
    const createdWorkOrder = workOrder as any;
    await supabase.from("insurance_claims" as any).update({ job_order_id: createdWorkOrder.id, auto_job_order_id: createdWorkOrder.id } as any).eq("id", claim.id);
    await supabase.from("estimates" as any).update({ claim_id: claim.id, work_order_id: createdWorkOrder.id, status: "converted", converted_at: convertedAt } as any).eq("id", estimate.id);
    await insertConversionAudit({
      tenantId: estimate.tenant_id,
      estimateId: estimate.id,
      conversionType: "insurance_to_work_order",
      targetEntityType: "work_order",
      targetEntityId: createdWorkOrder.id,
      existingRecordUsed: false,
      notes: "Created insurance work order from insurance estimate",
      userId,
    });
    await insertClaimAudit(estimate.tenant_id, claim.id, "work_order_created_from_estimate", { estimate_number: estimate.estimate_number, work_order_id: createdWorkOrder.id }, userId);
    return { target, target_entity_type: "work_order", target_entity_id: createdWorkOrder.id, target_number: createdWorkOrder.order_number, existing_record_used: false, message: "تم إنشاء أمر العمل التأميني من التقدير." };
  }

  throw new Error("نوع تحويل غير مدعوم.");
}
