import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { getVehicleEntry, getVehicleEntryPresence, getVehicleVisitBillingKind, listVehicleEntries, type VehicleEntryPresence } from "@/lib/vehicleEntryService";
import { getPrivateDocumentUrl } from "@/lib/documentExtraction/persistence";
import {workshopDateTime} from "@/lib/workshopDateTime";
import {hasConfirmedVehicleEntryWorkOrderLink} from "@/lib/vehicleEntryWorkOrderLink";

export const VISIT_STAGES = ["arrived", "approved", "in_progress", "ready", "delivered", "cancelled", "needs_review"] as const;
export type VisitStage = typeof VISIT_STAGES[number];
export type PersistedVisitStage = Exclude<VisitStage, "needs_review">;

export { getVehicleVisitBillingKind } from "@/lib/vehicleEntryService";

export interface VehicleVisitWorkflow {
  entry_id: string;
  tenant_id: string;
  vehicle_id: string;
  stage: PersistedVisitStage;
  revision: number;
  review_reason: string | null;
  changed_at: string;
  changed_by: string | null;
}

export interface VehicleVisitTransition {
  id: string;
  revision: number;
  from_stage: PersistedVisitStage | null;
  to_stage: PersistedVisitStage;
  occurred_at: string;
  recorded_at: string;
  recorded_by: string | null;
  responsible_user_id: string | null;
  source: string;
  notes: string | null;
  reason: string | null;
  requirements: Record<string, unknown>;
}

export interface VehicleVisitItem {
  entry: any;
  workflow: VehicleVisitWorkflow | null;
  stage: VisitStage;
  /** Read-only business milestone when an old entry has a separate custody/link conflict. */
  operationalStage: VisitStage;
  reviewReason: string | null;
  hasFinalHandover: boolean;
  /** Existing finalized release state (`signed`), including paper acknowledgement.
   * No electronic signature image is required or fetched. Not a stored custody source. */
  hasSignedTemporaryRelease?: boolean;
}

export const VEHICLE_CENTER_TABS = ["in_workshop", "with_customer", "delivered", "cancelled", "needs_review"] as const;
export type VehicleCenterTab = typeof VEHICLE_CENTER_TABS[number];
export interface VehicleCenterFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  technician?: string;
  location?: VehicleEntryPresence | "all";
  minDays?: number;
  stage?: VisitStage | "all";
}
export interface VehicleCenterPageRequest {
  tab: VehicleCenterTab;
  page?: number;
  pageSize?: number;
  filters?: VehicleCenterFilters;
}
export interface VehicleCenterPage {
  items: VehicleVisitItem[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Record<VehicleCenterTab, number>;
  stages: Record<VisitStage, number>;
  technicians: string[];
  entryCount: number;
  claimOnlyCount: number;
  scopeToken: string;
}

/** Terminal operational evidence wins over a historical review warning.
 * A claim alone is never proof of an arrival, inspection or temporary exit. */
export function getVehicleCenterTab(visit: VehicleVisitItem): VehicleCenterTab {
  if (visit.entry?._claimOnly) return "needs_review";
  if (visit.operationalStage === "delivered" || visit.operationalStage === "cancelled") return visit.operationalStage;
  if (visit.reviewReason) return "needs_review";
  const presence = getVehicleEntryPresence(visit.entry);
  if (presence === "in_workshop") return "in_workshop";
  return presence === "with_customer" && visit.hasSignedTemporaryRelease ? "with_customer" : "needs_review";
}

/** No unbounded fallback: missing candidate RPC is a visible release prerequisite. */
export async function listVehicleVisitCenterPage(request: VehicleCenterPageRequest): Promise<VehicleCenterPage> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  if (!VEHICLE_CENTER_TABS.includes(request.tab)) throw new Error("VEHICLE_CENTER_INVALID_TAB");
  const page = Math.max(1, Math.trunc(request.page || 1));
  const pageSize = Math.max(1, Math.min(100, Math.trunc(request.pageSize || 30)));
  const { data, error } = await supabase.rpc("vehicle_visit_center_page_v1" as any, {
    p_tenant_id: tenantId, p_tab: request.tab, p_page: page, p_page_size: pageSize,
    p_filters: request.filters || {},
  } as any);
  if (error) throw error;
  const result = data as any;
  if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0
    || result.page !== page || result.pageSize !== pageSize || result.items.length > pageSize
    || !result.tabs || !result.stages || !Array.isArray(result.technicians)
    || !/^[a-f0-9]{32}$/.test(result.scopeToken || "")) throw new Error("VEHICLE_CENTER_INVALID_RESPONSE");
  const items = result.items.map((raw: any) => {
    const entry = raw.entry;
    // Defense in depth: malformed/cross-tenant payloads must not reach cards or exports.
    if (!entry || entry.tenant_id !== tenantId || (raw.workflow && raw.workflow.tenant_id !== tenantId)
      || [entry.claim, entry.converted_claim, entry.work_order, entry.converted_work_order, entry.vehicle, entry.customer]
        .some((linked) => linked && linked.tenant_id !== tenantId)) throw new Error("VEHICLE_CENTER_TENANT_MISMATCH");
    const visit = entry._claimOnly ? projectClaimWithoutEntry(entry.claim, entry.work_order || null)
      : resolveVehicleVisit(entry, raw.workflow || null, raw.hasFinalHandover === true, raw.hasSignedTemporaryRelease === true);
    visit.entry = entry;
    visit.hasSignedTemporaryRelease = raw.hasSignedTemporaryRelease === true;
    if (raw.duplicateOpenVisit) {
      visit.stage = "needs_review";
      visit.operationalStage = "needs_review";
      visit.reviewReason ||= "duplicate_open_visit";
    }
    if (visit.stage !== raw.stage || visit.operationalStage !== raw.operationalStage || visit.reviewReason !== raw.reviewReason
      || getVehicleCenterTab(visit) !== request.tab) throw new Error("VEHICLE_CENTER_PROJECTION_MISMATCH");
    return visit;
  });
  for (const count of [...VEHICLE_CENTER_TABS.map((key) => result.tabs[key]), ...VISIT_STAGES.map((key) => result.stages[key]), result.entryCount, result.claimOnlyCount]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("VEHICLE_CENTER_INVALID_RESPONSE");
  }
  if (result.tabs[request.tab] !== result.total || result.entryCount + result.claimOnlyCount !== result.total
    || items.length > result.total || result.technicians.some((value: unknown) => typeof value !== "string")) {
    throw new Error("VEHICLE_CENTER_INVALID_RESPONSE");
  }
  return { ...result, items } as VehicleCenterPage;
}

/** Explicit all-matching export, bounded per request and fail-closed on drift/limits. */
export async function listAllMatchingVehicleCenter(request: Omit<VehicleCenterPageRequest, "page" | "pageSize">): Promise<VehicleVisitItem[]> {
  const items: VehicleVisitItem[] = [];
  const seen = new Set<string>();
  let expectedTotal: number | undefined;
  let expectedScope: string | undefined;
  for (let page = 1; ; page++) {
    const result = await listVehicleVisitCenterPage({ ...request, page, pageSize: 100 });
    expectedTotal ??= result.total;
    expectedScope ??= result.scopeToken;
    if (result.total !== expectedTotal || result.scopeToken !== expectedScope) throw new Error("VEHICLE_CENTER_EXPORT_CHANGED");
    if (result.total > MAX_ENTRIES) throw new Error("VEHICLE_VISIT_RESULT_LIMIT");
    for (const item of result.items) {
      if (seen.has(item.entry.id)) throw new Error("VEHICLE_CENTER_EXPORT_CHANGED");
      seen.add(item.entry.id);
      items.push(item);
    }
    if (items.length === result.total) return items;
    if (!result.items.length || items.length > result.total) throw new Error("VEHICLE_CENTER_EXPORT_CHANGED");
  }
}

/** Only an attested, unresolved workshop/linked-record conflict can use the existing custody repair RPC. */
export function canReconcileVehicleVisitCustody(visit: (VehicleVisitItem & { releases?: Array<{ status: string; returned_at: string | null }> }) | null | undefined): boolean {
  if (!visit || visit.reviewReason !== "custody_conflict" || visit.hasFinalHandover) return false;
  const entry = visit.entry;
  const claim = entry?.claim || entry?.converted_claim;
  const order = entry?.work_order || entry?.converted_work_order;
  return entry?.vehicle_location === "داخل الورشة"
    && (claim?.vehicle_presence_status === "with_customer" || order?.vehicle_presence_status === "with_customer")
    && !["cancelled", "rejected"].includes(claim?.status)
    && !claim?.vehicle_delivered_at && !claim?.delivered_at
    && order?.status !== "delivered" && !order?.vehicle_delivered_at
    && !(visit.releases || []).some((release) => release.status === "signed" && !release.returned_at);
}

const PAGE_SIZE = 200;
const MAX_ENTRIES = 10_000;

function chunk<T>(rows: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}

export function resolveVehicleVisit(entry: any, workflow: VehicleVisitWorkflow | null, hasFinalHandover: boolean, hasSignedTemporaryRelease = false): VehicleVisitItem {
  const order = entry.work_order || entry.converted_work_order;
  const claim = entry.claim || entry.converted_claim;
  const linkedOrder = entry.work_order_id || entry.converted_work_order_id;
  const linkedClaim = entry.insurance_claim_id || entry.converted_claim_id;
  let reviewReason = workflow?.review_reason || null;
  if (!entry.vehicle_id) reviewReason ||= "missing_vehicle";
  if (linkedOrder && (!order || order.vehicle_id !== entry.vehicle_id)) reviewReason ||= "work_order_link_conflict";
  if (entry.__inferredOrderLink) reviewReason ||= "work_order_link_conflict";
  if (entry.__inferredClaimLink) reviewReason ||= "claim_link_conflict";
  if (linkedClaim && (!claim || claim.vehicle_id !== entry.vehicle_id)) reviewReason ||= "claim_link_conflict";
  if (order && ((linkedClaim && (order.work_order_type !== "insurance" || order.claim_id !== linkedClaim))
    || (!linkedClaim && order.work_order_type === "insurance"))) reviewReason ||= "work_order_channel_conflict";
  if (getVehicleVisitBillingKind(entry) === "insurance" && !linkedClaim) reviewReason ||= "insurance_claim_required";
  if ((entry.status === "Cancelled" || ["cancelled", "rejected"].includes(claim?.status))
    && order && order.status !== "delivered") reviewReason ||= "cancelled_with_active_work_order";
  if (entry.work_order_id && entry.converted_work_order_id && entry.work_order_id !== entry.converted_work_order_id) reviewReason ||= "work_order_link_conflict";
  if (entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id) reviewReason ||= "claim_link_conflict";
  if (getVehicleEntryPresence(entry) === "needs_review") reviewReason ||= "custody_conflict";
  const arrivalInstant = Date.parse(`${String(entry.arrival_date || "").slice(0, 10)}T${String(entry.arrival_time || "00:00").slice(0, 5)}:00+04:00`);
  const deliveryDates = [order?.vehicle_delivered_at, claim?.vehicle_delivered_at, claim?.delivered_at].filter(Boolean);
  const deliverySinceArrival = deliveryDates.some((value) => {
    const instant = Date.parse(String(value));
    return Number.isFinite(instant) && (!Number.isFinite(arrivalInstant) || instant >= arrivalInstant);
  });
  const deliveredMarker = hasFinalHandover || deliverySinceArrival || (order?.status === "delivered" && deliveryDates.length === 0);
  if (deliveredMarker && !hasFinalHandover && (!reviewReason || reviewReason === "custody_conflict"))
    reviewReason = "delivery_without_signed_handover";
  if (workflow?.stage === "delivered" && !hasFinalHandover) reviewReason ||= "delivery_without_signed_handover";
  if (getVehicleEntryPresence(entry) === "with_customer" && !hasFinalHandover && !hasSignedTemporaryRelease
    && !claim?.cancelled_handover_signed_at) reviewReason ||= "exit_without_signed_release";
  // A legacy entry with no persisted workflow is a read-only projection. Never
  // rewrite or advance its history simply because the dashboard was opened.
  let stage: PersistedVisitStage = workflow?.stage || "arrived";
  if (!workflow) {
    if (entry.status === "Cancelled" || ["cancelled", "rejected"].includes(claim?.status)) stage = "cancelled";
    else if (hasFinalHandover && deliveredMarker) stage = "delivered";
    else if (["completed", "delivered"].includes(order?.status) || order?.work_completed_at
      || claim?.work_completed_at || ["ready", "quality_check", "delivered"].includes(claim?.repair_stage)) stage = "ready";
    else if (["in_progress", "waiting_parts"].includes(order?.status) || order?.work_started_at
      || claim?.work_started_at || ["repairing", "in_progress"].includes(claim?.repair_stage)) stage = "in_progress";
    else if (["approved", "paid"].includes(claim?.status) || claim?.approved_at || claim?.insurance_approved_at) stage = "approved";
  }
  let operationalStage: VisitStage = reviewReason ? "needs_review" : stage;
  if (reviewReason) {
    // A historical custody conflict must remain reviewable, but a cancelled
    // claim or documented work milestone must still appear in its real stage.
    // This is display-only: transition guards continue to use stage/reviewReason.
    if (entry.status === "Cancelled" || ["cancelled", "rejected"].includes(claim?.status)) {
      operationalStage = "cancelled";
    } else if (deliveredMarker && (hasFinalHandover || claim?.vehicle_presence_status === "with_customer"
      || order?.vehicle_presence_status === "with_customer" || entry.vehicle_location === "مع العميل")) {
      operationalStage = "delivered";
    } else if (["completed", "delivered"].includes(order?.status) || order?.work_completed_at
      || claim?.work_completed_at || ["ready", "quality_check"].includes(claim?.repair_stage)) {
      operationalStage = "ready";
    } else if (["in_progress", "waiting_parts"].includes(order?.status) || order?.work_started_at
      || claim?.work_started_at || ["repairing", "in_progress"].includes(claim?.repair_stage)) {
      operationalStage = "in_progress";
    }
  }
  return { entry, workflow, stage: reviewReason ? "needs_review" : stage, operationalStage, reviewReason, hasFinalHandover };
}

function omanDateTime(value: string | null | undefined): { date: string; time: string } {
  return workshopDateTime(value);
}

/** Read-only stage projection: a claim does not become a signed entry or handover. */
export function deriveClaimOnlyStage(claim: any, order: any | null): VisitStage {
  if (!claim.vehicle_id || (order && (order.claim_id !== claim.id || order.vehicle_id !== claim.vehicle_id
    || order.work_order_type !== "insurance"))) return "needs_review";
  if (["cancelled", "rejected"].includes(claim.status)) return order ? "needs_review" : "cancelled";
  const delivered = Boolean(claim.delivered_at || claim.vehicle_delivered_at || order?.vehicle_delivered_at
    || order?.status === "delivered");
  if (delivered) return claim.vehicle_presence_status === "with_customer" ? "delivered" : "needs_review";
  if (order?.status === "completed" || order?.work_completed_at || claim.work_completed_at
    || ["ready", "quality_check"].includes(claim.repair_stage)) return "ready";
  if (["in_progress", "waiting_parts"].includes(order?.status) || order?.work_started_at
    || claim.work_started_at || ["repairing", "in_progress"].includes(claim.repair_stage)) {
    return claim.vehicle_presence_status === "with_customer" ? "needs_review" : "in_progress";
  }
  if (["approved", "paid"].includes(claim.status) || claim.approved_at || claim.insurance_approved_at) return "approved";
  return "arrived";
}

/** A claim is visible in the center without manufacturing a physical entry receipt. */
export function projectClaimWithoutEntry(claim: any, order: any | null): VehicleVisitItem {
  const arrival = omanDateTime(claim.workshop_arrival_date || claim.created_at);
  const recordedPresence = !claim.vehicle_id ? null : claim.vehicle_presence_status === "in_workshop" ? "داخل الورشة"
    : claim.vehicle_presence_status === "with_customer" ? "مع العميل" : null;
  const vehicle = {
    ...(claim.vehicle || {}),
    brand: claim.vehicle?.brand || claim.vehicle_make || "",
    model: claim.vehicle?.model || claim.vehicle_model || "",
    plate_number: claim.vehicle?.plate_number || claim.vehicle_plate || "",
  };
  const customer = {
    ...(claim.customer || {}),
    name: claim.customer?.name || claim.vehicle_owner_name || "",
    phone: claim.customer?.phone || claim.vehicle_owner_phone || "",
  };
  return {
    entry: {
      id: `claim:${claim.id}`,
      _claimOnly: true,
      entry_number: "",
      status: claim.status,
      arrival_date: arrival.date,
      arrival_time: arrival.time,
      _arrivalSource: claim.workshop_arrival_date ? "workshop_arrival_date" : "claim_registration",
      created_at: claim.created_at,
      vehicle_location: recordedPresence,
      vehicle_id: claim.vehicle_id,
      customer_id: claim.customer_id,
      insurance_claim_id: claim.id,
      claim,
      work_order: order,
      vehicle,
      customer,
      vehicle_snapshot: { make: claim.vehicle_make, model: claim.vehicle_model, plate_number: claim.vehicle_plate },
      customer_snapshot: { name: claim.vehicle_owner_name, phone: claim.vehicle_owner_phone },
      insurance_snapshot: { claim_number: claim.claim_number, company_name: claim.insurance_company },
    },
    workflow: null,
    stage: deriveClaimOnlyStage(claim, order),
    operationalStage: deriveClaimOnlyStage(claim, order),
    reviewReason: "claim_without_entry",
    hasFinalHandover: false,
  };
}

export function getVehicleVisitNextBlocker(
  next: PersistedVisitStage | null | undefined,
  entry: any,
  hasRole: (...roles: string[]) => boolean,
  hasFinalHandover: boolean,
): string | null {
  if (!next || !entry) return null;
  const claim = entry.claim || entry.converted_claim;
  const order = entry.work_order || entry.converted_work_order;
  const billingKind = getVehicleVisitBillingKind(entry);
  return next === "approved" && !hasRole("admin", "manager", "insurance") ? "approvalPermissionRequired"
    : next === "in_progress" && !hasRole("admin", "manager", "supervisor", "technician") ? "workPermissionRequired"
    : (next === "ready" || next === "delivered") && !hasRole("admin", "manager", "supervisor") ? "completionPermissionRequired"
    : next === "approved" && billingKind === "insurance" && !["approved", "paid"].includes(claim?.status) ? "claimApprovalRequired"
    : next === "approved" && billingKind === "cash" && !order ? "cashWorkOrderRequired"
    : next === "in_progress" && !order ? "workOrderRequired"
    : next === "in_progress" && billingKind === "insurance" && !["approved", "paid"].includes(claim?.status) ? "claimApprovalRequired"
    : next === "in_progress" && (entry.vehicle_location !== "داخل الورشة"
      || order?.vehicle_presence_status === "with_customer" || claim?.vehicle_presence_status === "with_customer") ? "workshopPresenceRequired"
    : next === "in_progress" && order && !["received", "inspection", "waiting_parts", "in_progress"].includes(order.status) ? "workOrderStatusInvalid"
    : next === "ready" && order?.status !== "completed" ? "finishWorkFirst"
    : next === "delivered" && (!hasFinalHandover || order?.status !== "delivered" || !order?.vehicle_delivered_at) ? "signedHandoverRequired"
    : null;
}

export async function listVehicleVisitCenter(): Promise<VehicleVisitItem[]> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const entries: any[] = [];
  for (let page = 0; ; page += 1) {
    const batch = await listVehicleEntries({}, page, PAGE_SIZE);
    entries.push(...batch);
    if (entries.length > MAX_ENTRIES) throw new Error("VEHICLE_VISIT_RESULT_LIMIT");
    if (batch.length < PAGE_SIZE) break;
  }
  const claims: any[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase.from("insurance_claims" as any)
      .select("id,claim_number,status,repair_stage,tenant_id,vehicle_id,customer_id,insurance_company,vehicle_presence_status,workshop_arrival_date,created_at,approved_at,insurance_approved_at,work_started_at,work_completed_at,delivered_at,vehicle_delivered_at,vehicle_entry_id,vehicle_owner_name,vehicle_owner_phone,vehicle_make,vehicle_model,vehicle_plate,customer:customers(id,name,phone),vehicle:vehicles(id,brand,model,plate_number,plate_letters,plate_country,year,vin_number)")
      .eq("tenant_id", tenantId).is("deleted_at", null).order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    claims.push(...(data || []));
    if (claims.length > MAX_ENTRIES) throw new Error("VEHICLE_VISIT_RESULT_LIMIT");
    if ((data || []).length < PAGE_SIZE) break;
  }
  const linkedClaimIds = new Set(entries.flatMap((entry) => [entry.insurance_claim_id, entry.converted_claim_id].filter(Boolean)));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const claim of claims) {
    if (linkedClaimIds.has(claim.id) || !claim.vehicle_entry_id) continue;
    const entry = entryById.get(claim.vehicle_entry_id);
    if (!entry || !claim.vehicle_id || entry.vehicle_id !== claim.vehicle_id
      || (entry.insurance_claim_id && entry.insurance_claim_id !== claim.id)
      || (entry.converted_claim_id && entry.converted_claim_id !== claim.id)) continue;
    linkedClaimIds.add(claim.id);
    if (!entry.insurance_claim_id && !entry.converted_claim_id) {
      entry.claim = claim;
      entry.__inferredClaimLink = true;
    }
  }
  const claimOnly = claims.filter((claim) => !linkedClaimIds.has(claim.id));
  const claimOnlyOrders: any[] = [];
  for (const ids of chunk(claimOnly.map((claim) => claim.id), 100)) {
    const result = await supabase.from("job_orders" as any)
      .select("id,order_number,status,technician_name,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_id,vehicle_presence_status,vehicle_delivered_at,vehicle_entry_id")
      .eq("tenant_id", tenantId).is("deleted_at", null).in("claim_id", ids).limit(500);
    if (result.error) throw result.error;
    if ((result.data || []).length >= 500) throw new Error("VEHICLE_VISIT_ORDER_RESULT_LIMIT");
    claimOnlyOrders.push(...(result.data || []));
  }
  const claimOrders = new Map<string, any[]>();
  for (const order of claimOnlyOrders) claimOrders.set(order.claim_id, [...(claimOrders.get(order.claim_id) || []), order]);
  // Older claim-created orders sometimes have only claim_id, not the visit FK.
  // Surface a unique, vehicle-matching candidate for review; never silently
  // repair the historical link or allow it to advance the visit.
  const unlinkedClaims = [...new Set(entries
    .filter((entry) => !entry.work_order_id && !entry.converted_work_order_id)
    .map((entry) => entry.insurance_claim_id || entry.converted_claim_id)
    .filter(Boolean))] as string[];
  const candidateOrders: any[] = [];
  for (const ids of chunk(unlinkedClaims, 100)) {
    const result = await supabase.from("job_orders" as any)
      .select("id,order_number,status,technician_name,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_id,vehicle_presence_status,vehicle_delivered_at,vehicle_entry_id")
      .eq("tenant_id", tenantId).is("deleted_at", null).in("claim_id", ids).limit(500);
    if (result.error) throw result.error;
    if ((result.data || []).length >= 500) throw new Error("VEHICLE_VISIT_ORDER_RESULT_LIMIT");
    candidateOrders.push(...(result.data || []));
  }
  const ordersByClaim = new Map<string, any[]>();
  for (const order of candidateOrders) ordersByClaim.set(order.claim_id, [...(ordersByClaim.get(order.claim_id) || []), order]);
  for (const entry of entries) {
    if (entry.work_order_id || entry.converted_work_order_id) continue;
    const claimId = entry.insurance_claim_id || entry.converted_claim_id;
    if (!claimId) continue;
    const candidates = (ordersByClaim.get(claimId) || []).filter((order) => order.vehicle_id === entry.vehicle_id);
    if (!candidates.length) continue;
    entry.__inferredOrderLink = true;
    if (candidates.length === 1 && (!candidates[0].vehicle_entry_id || candidates[0].vehicle_entry_id === entry.id)) {
      entry.work_order = candidates[0];
    }
  }
  const workflows: VehicleVisitWorkflow[] = [];
  const handovers: Array<{ vehicle_entry_id: string; work_order_id: string | null }> = [];
  const releases: Array<{ vehicle_entry_id: string }> = [];
  for (const ids of chunk(entries.map((entry) => entry.id))) {
    const [workflowsResult, handoversResult, releasesResult] = await Promise.all([
      supabase.from("vehicle_visit_workflows" as any).select("entry_id,tenant_id,vehicle_id,stage,revision,review_reason,changed_at,changed_by")
        .eq("tenant_id", tenantId).in("entry_id", ids),
      supabase.from("vehicle_handover_records" as any).select("vehicle_entry_id,work_order_id")
        .eq("tenant_id", tenantId).eq("status", "finalized").in("vehicle_entry_id", ids),
      supabase.from("vehicle_inspection_releases" as any).select("vehicle_entry_id")
        .eq("tenant_id", tenantId).eq("status", "signed").is("returned_at", null).in("vehicle_entry_id", ids),
    ]);
    if (workflowsResult.error) throw workflowsResult.error;
    if (handoversResult.error) throw handoversResult.error;
    if (releasesResult.error) throw releasesResult.error;
    workflows.push(...((workflowsResult.data || []) as unknown as VehicleVisitWorkflow[]));
    handovers.push(...((handoversResult.data || []) as unknown as Array<{ vehicle_entry_id: string; work_order_id: string | null }>));
    releases.push(...((releasesResult.data || []) as unknown as Array<{ vehicle_entry_id: string }>));
  }
  const byEntry = new Map(workflows.map((workflow) => [workflow.entry_id, workflow]));
  const signedEntries = new Set(handovers.filter((handover) => {
    const entry = entryById.get(handover.vehicle_entry_id);
    return Boolean(entry && handover.work_order_id &&
      [entry.work_order_id, entry.converted_work_order_id].includes(handover.work_order_id));
  }).map((handover) => handover.vehicle_entry_id));
  const temporaryEntries = new Set(releases.map((release) => release.vehicle_entry_id));
  const visits = entries.map((entry) => resolveVehicleVisit(entry, byEntry.get(entry.id) || null, signedEntries.has(entry.id), temporaryEntries.has(entry.id)));
  // Historical duplicates are shown for manual review, never silently merged.
  const activeByVehicle = new Map<string, VehicleVisitItem[]>();
  for (const visit of visits) {
    if (!visit.entry.vehicle_id || ["cancelled", "delivered"].includes(visit.operationalStage)) continue;
    const key = String(visit.entry.vehicle_id);
    activeByVehicle.set(key, [...(activeByVehicle.get(key) || []), visit]);
  }
  for (const group of activeByVehicle.values()) {
    if (group.length < 2) continue;
    for (const visit of group) {
      visit.stage = "needs_review";
      visit.operationalStage = "needs_review";
      visit.reviewReason ||= "duplicate_open_visit";
    }
  }
  const claimCards = claimOnly.map((claim) => {
    const candidates = (claimOrders.get(claim.id) || []).filter((order) => order.vehicle_id === claim.vehicle_id);
    const card = projectClaimWithoutEntry(claim, candidates.length === 1 ? candidates[0] : null);
    if (candidates.length > 1) {
      card.stage = "needs_review";
      card.operationalStage = "needs_review";
      card.reviewReason = "duplicate_open_visit";
    }
    return card;
  });
  // Two claims for the same vehicle and registration day may be separate jobs,
  // but must be reviewed before one is treated as a confirmed visit.
  const claimCardsByVisit = new Map<string, VehicleVisitItem[]>();
  for (const card of claimCards) {
    if (!card.entry.vehicle_id || !card.entry.arrival_date || ["cancelled", "delivered"].includes(card.stage)) continue;
    const key = `${card.entry.vehicle_id}:${card.entry.arrival_date}`;
    claimCardsByVisit.set(key, [...(claimCardsByVisit.get(key) || []), card]);
  }
  for (const group of claimCardsByVisit.values()) {
    if (group.length < 2) continue;
    for (const card of group) {
      card.stage = "needs_review";
      card.operationalStage = "needs_review";
      card.reviewReason = "duplicate_open_visit";
    }
  }
  return [...visits, ...claimCards];
}

export async function getVehicleVisitDetail(entryId: string, options?: { includeOperationalFile?: boolean }) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const lightweight = options?.includeOperationalFile === false;
  const entry = await getVehicleEntry(entryId, { includeAttachments: !lightweight });
  if (!entry) return null;
  if (!entry.work_order_id && !entry.converted_work_order_id) {
    const claimId = entry.insurance_claim_id || entry.converted_claim_id;
    if (claimId) {
      const candidates = await supabase.from("job_orders" as any)
        .select("id,order_number,status,technician_name,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_id,vehicle_presence_status,vehicle_delivered_at,vehicle_entry_id")
        .eq("tenant_id", tenantId).eq("claim_id", claimId).eq("vehicle_id", entry.vehicle_id).is("deleted_at", null).limit(3);
      if (candidates.error) throw candidates.error;
      const matching = ((candidates.data || []) as any[]).filter((order: any) => order.vehicle_id === entry.vehicle_id);
      if (matching.length) {
        entry.__inferredOrderLink = true;
        if (matching.length === 1 && (!matching[0].vehicle_entry_id || matching[0].vehicle_entry_id === entry.id)) {
          entry.work_order = matching[0];
        }
      }
    }
  }
  const [workflowResult, eventsResult, handoversResult, releasesResult] = await Promise.all([
    supabase.from("vehicle_visit_workflows" as any).select("*").eq("tenant_id", tenantId).eq("entry_id", entryId).maybeSingle(),
    lightweight ? Promise.resolve({ data: [], error: null }) : supabase.from("vehicle_visit_transitions" as any).select("*").eq("tenant_id", tenantId).eq("entry_id", entryId).order("revision", { ascending: false }).limit(500),
    supabase.from("vehicle_handover_records" as any).select("id,work_order_id,receipt_number,status,delivered_at,finalized_at,cancellation_reason")
      .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).order("created_at", { ascending: false }).limit(30),
    supabase.from("vehicle_inspection_releases" as any).select("id,release_number,status,released_at,returned_at")
      .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (workflowResult.error) throw workflowResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (handoversResult.error) throw handoversResult.error;
  if (releasesResult.error) throw releasesResult.error;
  const handovers = (handoversResult.data || []) as any[];
  const releases = (releasesResult.data || []) as any[];
  const order = entry.work_order || entry.converted_work_order;
  const claim = entry.claim || entry.converted_claim;
  const item = resolveVehicleVisit(entry, (workflowResult.data as unknown as VehicleVisitWorkflow) || null,
    handovers.some((row) => row.status === "finalized" && row.work_order_id === order?.id),
    releases.some((row) => row.status === "signed" && !row.returned_at));
  if (lightweight) return {
    ...item,
    transitions: [] as VehicleVisitTransition[], handovers, releases,
    documents: [], documentFiles: [], expenses: [], cashInvoices: [], insuranceInvoices: [], mediaCount: 0,
  };
  // Keep contradictory rows visible to the review projection above, but never
  // load another vehicle's expenses/invoices/documents through a stale FK.
  const safeOrder=hasConfirmedVehicleEntryWorkOrderLink(entry,order)?order:null;
  const safeClaim=claim?.tenant_id===entry.tenant_id && claim?.vehicle_id===entry.vehicle_id
    && !(entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id!==entry.converted_claim_id)?claim:null;
  const entityIds = [entryId, safeOrder?.id, safeClaim?.id].filter(Boolean) as string[];
  const linked = await Promise.all([
    supabase.from("document_links" as any).select("id,file_id,entity_type,entity_id")
      .eq("tenant_id", tenantId).is("removed_at", null).in("entity_id", entityIds).limit(300),
    safeOrder?.id ? supabase.from("expenses" as any).select("id,voucher_number,total,amount,description")
      .eq("tenant_id", tenantId).eq("work_order_id", safeOrder.id).is("deleted_at", null).limit(300) : Promise.resolve({ data: [], error: null }),
    safeOrder?.id ? supabase.from("expenses" as any).select("id,voucher_number,total,amount,description")
      .eq("tenant_id", tenantId).in("linked_work_order_id", [safeOrder.id, safeOrder.order_number].filter(Boolean)).is("deleted_at", null).limit(300) : Promise.resolve({ data: [], error: null }),
    safeOrder?.id ? supabase.from("sales_documents" as any).select("id,doc_number,status,total")
      .eq("tenant_id", tenantId).in("work_order_id", [safeOrder.id, safeOrder.order_number].filter(Boolean)).eq("doc_type", "invoice").is("deleted_at", null).limit(100) : Promise.resolve({ data: [], error: null }),
    safeClaim?.id ? supabase.from("insurance_invoices" as any).select("id,invoice_number,status,total")
      .eq("tenant_id", tenantId).eq("claim_id", safeClaim.id).limit(100) : Promise.resolve({ data: [], error: null }),
    safeOrder?.id || safeClaim?.id ? supabase.from("vehicle_media" as any).select("id,media_type,category")
      .eq("tenant_id", tenantId).is("deleted_at", null)
      .or([safeOrder?.id && `work_order_id.eq.${safeOrder.id}`, safeClaim?.id && `claim_id.eq.${safeClaim.id}`].filter(Boolean).join(","))
      .limit(300) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of linked) if (result.error) throw result.error;
  const documentLinks = (linked[0].data || []) as unknown as Array<{ file_id: string; entity_type: string }>;
  const fileIds = [...new Set(documentLinks.map((row) => row.file_id))];
  const filesResult = fileIds.length ? await supabase.from("document_files" as any)
    .select("id,original_file_name,mime_type")
    .eq("tenant_id", tenantId).in("id", fileIds).limit(300) : { data: [], error: null };
  if (filesResult.error) throw filesResult.error;
  const expenses = [...new Map([...(linked[1].data || []) as any[], ...(linked[2].data || []) as any[]].map((row) => [row.id, row])).values()];
  return {
    ...item,
    transitions: (eventsResult.data || []) as unknown as VehicleVisitTransition[],
    handovers,
    releases,
    documents: documentLinks,
    documentFiles: filesResult.data || [],
    expenses,
    cashInvoices: linked[3].data || [],
    insuranceInvoices: linked[4].data || [],
    mediaCount: new Set([...(entry.vehicle_media || []).map((row: any) => row.id), ...((linked[5].data || []) as any[]).map((row) => row.id)]).size,
  };
}

/** The same visit/custody resolver used by the center, scoped to a claim or work order. */
export async function getLinkedVehicleVisit(source: "claim" | "work_order", id: string): Promise<{
  entryId: string | null;
  number: string | null;
  stage: VisitStage | null;
  presence: VehicleEntryPresence | null;
  reviewReason?: string | null;
} | null> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const fields = source === "claim" ? ["insurance_claim_id", "converted_claim_id"] : ["work_order_id", "converted_work_order_id"];
  const linked = await supabase.from("vehicle_entries" as any).select("id")
    .eq("tenant_id", tenantId).is("deleted_at", null)
    .or(fields.map((field) => `${field}.eq.${id}`).join(",")).limit(2);
  if (linked.error) throw linked.error;
  if (linked.data && linked.data.length > 1) return { entryId: null, number: null, stage: "needs_review", presence: "needs_review" };
  let entryId = (linked.data?.[0] as any)?.id as string | undefined;
  let inferredOrder: any = null;
  if (!entryId && source === "work_order") {
    const orderResult = await supabase.from("job_orders" as any)
      .select("id,order_number,status,technician_name,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_id,vehicle_presence_status,vehicle_delivered_at,vehicle_entry_id")
      .eq("tenant_id", tenantId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (orderResult.error) throw orderResult.error;
    inferredOrder = orderResult.data;
    if (inferredOrder?.vehicle_id && (inferredOrder.claim_id || inferredOrder.vehicle_entry_id)) {
      const filters = [
        ...(inferredOrder.claim_id ? [`insurance_claim_id.eq.${inferredOrder.claim_id}`, `converted_claim_id.eq.${inferredOrder.claim_id}`] : []),
        ...(inferredOrder.vehicle_entry_id ? [`id.eq.${inferredOrder.vehicle_entry_id}`] : []),
      ];
      const candidates = await supabase.from("vehicle_entries" as any).select("id")
        .eq("tenant_id", tenantId).eq("vehicle_id", inferredOrder.vehicle_id).is("deleted_at", null)
        .or(filters.join(",")).limit(2);
      if (candidates.error) throw candidates.error;
      if ((candidates.data || []).length > 1) return { entryId: null, number: null, stage: "needs_review", presence: "needs_review" };
      entryId = (candidates.data?.[0] as any)?.id;
    }
  }
  if (!entryId) {
    const claimId = source === "claim" ? id : inferredOrder?.claim_id;
    if (!claimId) return null;
    const claimResult = await supabase.from("insurance_claims" as any)
      .select("id,status,vehicle_id,vehicle_presence_status,workshop_arrival_date,created_at,approved_at,insurance_approved_at,work_started_at,work_completed_at,repair_stage,delivered_at,vehicle_delivered_at")
      .eq("tenant_id", tenantId).eq("id", claimId).is("deleted_at", null).maybeSingle();
    if (claimResult.error) throw claimResult.error;
    const claim = claimResult.data as any;
    if (!claim) return null;
    const ordersResult = await supabase.from("job_orders" as any)
      .select("id,status,work_order_type,claim_id,vehicle_id,vehicle_presence_status,vehicle_delivered_at,work_started_at,work_completed_at")
      .eq("tenant_id", tenantId).eq("claim_id", claimId).is("deleted_at", null).limit(3);
    if (ordersResult.error) throw ordersResult.error;
    const orders = (ordersResult.data || []) as any[];
    const matchingOrders = orders.filter((order) => order.vehicle_id === claim.vehicle_id);
    if (orders.length > 1 || (inferredOrder && inferredOrder.vehicle_id !== claim.vehicle_id)) {
      return { entryId: null, number: null, stage: "needs_review", presence: "needs_review" };
    }
    const card = projectClaimWithoutEntry(claim, matchingOrders[0] || null);
    return { entryId: null, number: null, stage: card.operationalStage, presence: getVehicleEntryPresence(card.entry), reviewReason: card.reviewReason };
  }
  const [entryResult, workflowResult, handoverResult, releaseResult] = await Promise.all([
    supabase.from("vehicle_entries" as any).select(
      "id,entry_number,arrival_date,arrival_time,vehicle_id,vehicle_location,status,insurance_company_id,insurance_snapshot,insurance_claim_id,converted_claim_id,work_order_id,converted_work_order_id,claim:insurance_claims!vehicle_entries_insurance_claim_id_fkey(id,vehicle_id,status,repair_stage,approved_at,insurance_approved_at,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at,delivered_at,cancelled_handover_signed_at),converted_claim:insurance_claims!vehicle_entries_converted_claim_id_fkey(id,vehicle_id,status,repair_stage,approved_at,insurance_approved_at,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at,delivered_at,cancelled_handover_signed_at),work_order:job_orders!vehicle_entries_work_order_id_fkey(id,vehicle_id,status,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at),converted_work_order:job_orders!vehicle_entries_converted_work_order_id_fkey(id,vehicle_id,status,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_presence_status,vehicle_delivered_at)"
    ).eq("tenant_id", tenantId).eq("id", entryId).is("deleted_at", null).maybeSingle(),
    supabase.from("vehicle_visit_workflows" as any).select("entry_id,tenant_id,vehicle_id,stage,revision,review_reason,changed_at,changed_by")
      .eq("tenant_id", tenantId).eq("entry_id", entryId).maybeSingle(),
    supabase.from("vehicle_handover_records" as any).select("work_order_id")
      .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).eq("status", "finalized").limit(2),
    supabase.from("vehicle_inspection_releases" as any).select("id")
      .eq("tenant_id", tenantId).eq("vehicle_entry_id", entryId).eq("status", "signed").is("returned_at", null).limit(1),
  ]);
  for (const result of [entryResult, workflowResult, handoverResult, releaseResult]) if (result.error) throw result.error;
  const entry = entryResult.data as any;
  if (!entry) return null;
  if (source === "claim" && !entry.work_order_id && !entry.converted_work_order_id && entry.vehicle_id) {
    // Match the center's read-only legacy projection. A claim and its work
    // order must report the same review stage without silently linking rows.
    const ordersResult = await supabase.from("job_orders" as any)
      .select("id,order_number,status,technician_name,work_order_type,claim_id,work_started_at,work_completed_at,vehicle_id,vehicle_presence_status,vehicle_delivered_at,vehicle_entry_id")
      .eq("tenant_id", tenantId).eq("claim_id", id).eq("vehicle_id", entry.vehicle_id)
      .is("deleted_at", null).limit(3);
    if (ordersResult.error) throw ordersResult.error;
    const orders = (ordersResult.data || []) as any[];
    if (orders.length) {
      entry.__inferredOrderLink = true;
      if (orders.length === 1 && (!orders[0].vehicle_entry_id || orders[0].vehicle_entry_id === entry.id)) {
        entry.work_order = orders[0];
      }
    }
  }
  if (inferredOrder) {
    const entryClaimId = entry.insurance_claim_id || entry.converted_claim_id;
    if (entryClaimId !== inferredOrder.claim_id || (inferredOrder.vehicle_entry_id && inferredOrder.vehicle_entry_id !== entry.id)
      || entry.work_order_id || entry.converted_work_order_id) {
      return { entryId: null, number: null, stage: "needs_review", presence: "needs_review" };
    }
    entry.work_order = inferredOrder;
    entry.__inferredOrderLink = true;
  }
  const order = entry.work_order || entry.converted_work_order;
  const finalized = ((handoverResult.data || []) as any[]).some((row) => row.work_order_id === order?.id);
  const visit = resolveVehicleVisit(entry, workflowResult.data as unknown as VehicleVisitWorkflow | null,
    finalized, Boolean(releaseResult.data?.length));
  const presence = getVehicleEntryPresence(entry);
  return { entryId, number: entry.entry_number, stage: visit.operationalStage, presence, reviewReason: visit.reviewReason };
}

export async function listVehicleVisitStaff(): Promise<Array<{ user_id: string; full_name: string | null }>> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  const { data, error } = await supabase.from("profiles" as any).select("user_id,full_name")
    .eq("tenant_id", tenantId).order("full_name").limit(200);
  if (error) throw error;
  return (data || []) as unknown as Array<{ user_id: string; full_name: string | null }>;
}

export async function getVehicleVisitDocumentUrl(fileId: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("TENANT_NOT_FOUND");
  return getPrivateDocumentUrl(fileId, tenantId);
}

export async function advanceVehicleVisit(input: {
  entryId: string;
  revision: number;
  stage: PersistedVisitStage;
  occurredAt: string;
  notes: string;
  reason: string;
  responsibleUserId: string;
  requirements: Record<string, unknown>;
}): Promise<VehicleVisitWorkflow> {
  const { data, error } = await supabase.rpc("advance_vehicle_visit" as any, {
    p_entry_id: input.entryId,
    p_expected_revision: input.revision,
    p_target_stage: input.stage,
    p_occurred_at: input.occurredAt,
    p_notes: input.notes || null,
    p_reason: input.reason || null,
    p_responsible_user_id: input.responsibleUserId,
    p_requirements: input.requirements,
  } as any);
  if (error) throw error;
  const row = data as unknown as VehicleVisitWorkflow | null;
  if (!row || row.entry_id !== input.entryId || row.stage !== input.stage || row.revision !== input.revision + 1) {
    throw new Error("VEHICLE_VISIT_SAVE_NOT_CONFIRMED");
  }
  return row;
}

export async function reconcileVehicleVisitCustody(entryId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("reconcile_vehicle_visit_custody" as any, {
    p_entry_id: entryId,
    p_reason: reason.trim(),
  } as any);
  if (error) throw error;
}
