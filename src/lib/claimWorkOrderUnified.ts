import { supabase } from "@/integrations/supabase/client";

export type UnifiedOperationalPatch = {
  vehicle_presence_status?: string | null;
  vehicle_location_section?: string | null;
  vehicle_location_bay?: string | null;
  vehicle_location_note?: string | null;
  vehicle_location_updated_at?: string | null;
  vehicle_location_updated_by?: string | null;
  repair_stage?: string | null;
  operational_status?: string | null;
  vehicle_received_at?: string | null;
  work_started_at?: string | null;
  work_completed_at?: string | null;
  vehicle_delivered_at?: string | null;
  insurance_approval_status?: string | null;
  invoice_status?: string | null;
  payment_status?: string | null;
  operational_notes?: string | null;
  parts_required?: unknown[];
  estimate_ids?: string[];
};

export type UnifiedOperationalRecord = UnifiedOperationalPatch & {
  id: string;
  tenant_id: string;
  claim_id: string | null;
  work_order_id: string | null;
  vehicle_id: string | null;
  customer_id: string | null;
  updated_at?: string | null;
};

export type UnifiedMediaRecord = {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  media_type: string;
  category: string;
  stage: string | null;
  caption: string | null;
  uploaded_at: string;
};

function isMissingUnifiedTable(error: unknown) {
  const text = `${(error as any)?.code || ""} ${(error as any)?.message || ""} ${(error as any)?.details || ""}`.toLowerCase();
  return text.includes("schema cache") || text.includes("could not find") || text.includes("does not exist") || text.includes("pgrst204");
}

function compactPayload<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as T;
}

async function mirrorUnifiedOperationalState(params: {
  tenantId: string;
  claimId?: string | null;
  workOrderId?: string | null;
  patch: UnifiedOperationalPatch;
}) {
  const { tenantId, claimId, workOrderId, patch } = params;

  const claimUpdates = compactPayload({
    vehicle_presence_status: patch.vehicle_presence_status,
    vehicle_location_section: patch.vehicle_location_section,
    vehicle_location_bay: patch.vehicle_location_bay,
    vehicle_location_note: patch.vehicle_location_note,
    vehicle_location_updated_at: patch.vehicle_location_updated_at,
    vehicle_location_updated_by: patch.vehicle_location_updated_by,
    repair_stage: patch.repair_stage,
    vehicle_received_at: patch.vehicle_received_at,
    received_at: patch.vehicle_received_at,
    workshop_arrival_date: patch.vehicle_received_at ? String(patch.vehicle_received_at).slice(0, 10) : undefined,
    work_started_at: patch.work_started_at,
    repair_started_at: patch.work_started_at,
    work_completed_at: patch.work_completed_at,
    vehicle_delivered_at: patch.vehicle_delivered_at,
    delivered_at: patch.vehicle_delivered_at,
    needed_parts: patch.parts_required as any,
  } as Record<string, unknown>);

  const workOrderUpdates = compactPayload({
    vehicle_presence_status: patch.vehicle_presence_status,
    vehicle_location_section: patch.vehicle_location_section,
    vehicle_location_bay: patch.vehicle_location_bay,
    vehicle_location_note: patch.vehicle_location_note,
    status: patch.operational_status,
    vehicle_received_at: patch.vehicle_received_at,
    received_at: patch.vehicle_received_at,
    work_started_at: patch.work_started_at,
    work_completed_at: patch.work_completed_at,
    vehicle_delivered_at: patch.vehicle_delivered_at,
    parts_needed: patch.parts_required as any,
  } as Record<string, unknown>);

  const writes: Array<PromiseLike<any>> = [];
  if (claimId && Object.keys(claimUpdates).length) {
    writes.push(
      supabase
        .from("insurance_claims" as any)
        .update(claimUpdates)
        .eq("tenant_id", tenantId)
        .eq("id", claimId),
    );
  }
  if (workOrderId && Object.keys(workOrderUpdates).length) {
    writes.push(
      supabase
        .from("job_orders" as any)
        .update(workOrderUpdates)
        .eq("tenant_id", tenantId)
        .eq("id", workOrderId),
    );
  }

  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[unified claim/work-order mirror] skipped", result.reason);
      continue;
    }
    if ((result.value as any)?.error && !isMissingUnifiedTable((result.value as any).error)) {
      console.warn("[unified claim/work-order mirror] skipped", (result.value as any).error);
    }
  }
}

export async function fetchUnifiedOperationalState(params: {
  claimId?: string | null;
  workOrderId?: string | null;
}): Promise<UnifiedOperationalRecord | null> {
  const filters = [params.claimId ? `claim_id.eq.${params.claimId}` : "", params.workOrderId ? `work_order_id.eq.${params.workOrderId}` : ""]
    .filter(Boolean)
    .join(",");
  if (!filters) return null;
  const { data, error } = await supabase
    .from("claim_work_order_operations" as any)
    .select("*")
    .or(filters)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingUnifiedTable(error)) return null;
    throw error;
  }
  return (data as unknown as UnifiedOperationalRecord) || null;
}

export function mergeUnifiedOperationalState<T extends Record<string, any>>(
  legacy: T,
  op: UnifiedOperationalRecord | null | undefined,
): T {
  if (!op) return legacy;
  return {
    ...legacy,
    vehicle_presence_status: op.vehicle_presence_status ?? legacy.vehicle_presence_status,
    vehicle_location_section: op.vehicle_location_section ?? legacy.vehicle_location_section,
    vehicle_location_bay: op.vehicle_location_bay ?? legacy.vehicle_location_bay,
    vehicle_location_note: op.vehicle_location_note ?? legacy.vehicle_location_note,
    vehicle_location_updated_at: op.vehicle_location_updated_at ?? legacy.vehicle_location_updated_at,
    vehicle_location_updated_by: op.vehicle_location_updated_by ?? legacy.vehicle_location_updated_by,
    repair_stage: op.repair_stage ?? legacy.repair_stage,
    status: op.operational_status ?? legacy.status,
    vehicle_received_at: op.vehicle_received_at ?? legacy.vehicle_received_at,
    received_at: op.vehicle_received_at ?? legacy.received_at,
    work_started_at: op.work_started_at ?? legacy.work_started_at,
    repair_started_at: op.work_started_at ?? legacy.repair_started_at,
    work_completed_at: op.work_completed_at ?? legacy.work_completed_at,
    vehicle_delivered_at: op.vehicle_delivered_at ?? legacy.vehicle_delivered_at,
    delivered_at: op.vehicle_delivered_at ?? legacy.delivered_at,
    needed_parts: Array.isArray(op.parts_required) && op.parts_required.length ? op.parts_required : legacy.needed_parts,
  };
}

export async function upsertUnifiedOperationalState(params: {
  tenantId: string;
  claimId?: string | null;
  workOrderId?: string | null;
  vehicleId?: string | null;
  customerId?: string | null;
  patch: UnifiedOperationalPatch;
  changedFrom: "claim" | "work_order" | "system";
  changedBy?: string | null;
}): Promise<UnifiedOperationalRecord | null> {
  const existing = await fetchUnifiedOperationalState({ claimId: params.claimId, workOrderId: params.workOrderId });
  const payload = compactPayload({
    tenant_id: params.tenantId,
    claim_id: params.claimId || existing?.claim_id || null,
    work_order_id: params.workOrderId || existing?.work_order_id || null,
    vehicle_id: params.vehicleId || existing?.vehicle_id || null,
    customer_id: params.customerId || existing?.customer_id || null,
    ...params.patch,
    last_changed_from: params.changedFrom,
    last_changed_by: params.changedBy || null,
  } as Record<string, unknown>);

  const query = existing?.id
    ? supabase.from("claim_work_order_operations" as any).update(payload).eq("id", existing.id).select("*").single()
    : supabase.from("claim_work_order_operations" as any).insert(payload).select("*").single();
  const { data, error } = await query;
  if (error) {
    if (isMissingUnifiedTable(error)) return null;
    throw error;
  }
  const record = data as unknown as UnifiedOperationalRecord;
  await mirrorUnifiedOperationalState({
    tenantId: params.tenantId,
    claimId: record.claim_id,
    workOrderId: record.work_order_id,
    patch: params.patch,
  });
  return record;
}

export async function addUnifiedVehicleMedia(params: {
  tenantId: string;
  claimId?: string | null;
  workOrderId?: string | null;
  vehicleId?: string | null;
  bucket: string;
  path: string;
  publicUrl?: string | null;
  category: string;
  stage?: string | null;
  caption?: string | null;
  uploadedBy?: string | null;
  source: "claim" | "work_order" | "migration" | "system";
}): Promise<UnifiedMediaRecord | null> {
  if (!params.path) return null;
  const { data, error } = await supabase
    .from("vehicle_media" as any)
    .upsert({
      tenant_id: params.tenantId,
      claim_id: params.claimId || null,
      work_order_id: params.workOrderId || null,
      vehicle_id: params.vehicleId || null,
      storage_bucket: params.bucket,
      storage_path: params.path,
      public_url: params.publicUrl || null,
      media_type: "image",
      category: params.category,
      stage: params.stage || null,
      caption: params.caption || null,
      source: params.source,
      uploaded_by: params.uploadedBy || null,
      uploaded_at: new Date().toISOString(),
    } as any, { onConflict: "tenant_id,storage_bucket,storage_path" })
    .select("*")
    .single();
  if (error) {
    if (isMissingUnifiedTable(error)) return null;
    throw error;
  }
  return data as unknown as UnifiedMediaRecord;
}

export async function listUnifiedVehicleMedia(params: {
  claimId?: string | null;
  workOrderId?: string | null;
  vehicleId?: string | null;
  limit?: number;
}): Promise<UnifiedMediaRecord[]> {
  const filters = [
    params.claimId ? `claim_id.eq.${params.claimId}` : "",
    params.workOrderId ? `work_order_id.eq.${params.workOrderId}` : "",
    params.vehicleId ? `vehicle_id.eq.${params.vehicleId}` : "",
  ].filter(Boolean).join(",");
  if (!filters) return [];
  const { data, error } = await supabase
    .from("vehicle_media" as any)
    .select("*")
    .or(filters)
    .order("uploaded_at", { ascending: false })
    .limit(params.limit || 200);
  if (error) {
    if (isMissingUnifiedTable(error)) return [];
    throw error;
  }
  return (data || []) as unknown as UnifiedMediaRecord[];
}
