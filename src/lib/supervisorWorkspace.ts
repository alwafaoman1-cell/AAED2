import { getVehicleEntryPresence } from "@/lib/vehicleEntryService";
import { hasConfirmedVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryWorkOrderLink";
import { getLinkedVehicleVisit, getVehicleVisitBillingKind, listVehicleVisitCenterPage, type VehicleCenterFilters, type VehicleCenterTab, type VehicleVisitItem, type VisitStage } from "@/lib/vehicleVisitLifecycle";
import { fetchWorkOrderFromCloudByIdentifier, fetchWorkOrderListPage, type WorkOrder } from "@/lib/workOrdersStore";
import { isInsuranceWorkOrder } from "@/lib/workOrderType";
import { supabase } from "@/integrations/supabase/client";

export type SupervisorChannel = "all" | "cash" | "insurance";
export type SupervisorTab = VehicleCenterTab | "legacy";
export type SupervisorAction = "expense" | "stages" | "photos" | "parts" | "qr" | "messages";
export const SUPERVISOR_PAGE_SIZE = 20;
// Parent-approved additive center contract; dataset parity is a release gate.
export const SUPERVISOR_CENTER_CHANNEL_SUPPORTED = true;

export interface SupervisorVehicle {
  key: string;
  entryId?: string;
  claimId?: string;
  workOrderId?: string;
  workOrderNumber?: string;
  number: string;
  customer: string;
  vehicle: string;
  plate: string;
  country: string;
  arrivalDate: string;
  channel: Exclude<SupervisorChannel, "all">;
  custody: "in_workshop" | "with_customer" | "needs_review";
  stage?: VisitStage;
  review: boolean;
  legacy: boolean;
  orderStatus?: string;
  visit?: VehicleVisitItem;
}

const text = (...values: unknown[]) => values.find((value) => typeof value === "string" && value.trim()) as string | undefined;

export function supervisorVehicleFromVisit(visit: VehicleVisitItem): SupervisorVehicle {
  const entry = visit.entry;
  const vehicle = { ...(entry.vehicle || {}), ...(entry.vehicle_snapshot || {}) };
  const customer = { ...(entry.customer || {}), ...(entry.customer_snapshot || {}) };
  const order = entry.work_order || entry.converted_work_order;
  const confirmedOrder = !entry._claimOnly && !entry.__inferredOrderLink && hasConfirmedVehicleEntryWorkOrderLink(entry, order);
  return {
    key: `${entry._claimOnly ? "claim" : "entry"}:${entry.id}`,
    entryId: entry._claimOnly ? undefined : entry.id,
    claimId: text(entry.insurance_claim_id, entry.converted_claim_id, entry.claim?.id, entry.converted_claim?.id),
    workOrderId: confirmedOrder ? order.id : undefined,
    workOrderNumber: confirmedOrder ? order.order_number : undefined,
    number: text(entry.entry_number, entry.claim?.claim_number) || "",
    customer: text(customer.name) || "",
    vehicle: [text(vehicle.make, vehicle.brand), text(vehicle.model), vehicle.year].filter(Boolean).join(" "),
    plate: [text(vehicle.plate_letters, vehicle.plateLetters), text(vehicle.plate_number, vehicle.plateNumber)].filter(Boolean).join(" "),
    country: text(vehicle.plate_country, vehicle.plateCountry) || "",
    arrivalDate: text(entry.arrival_date) || "",
    channel: getVehicleVisitBillingKind(entry),
    custody: getVehicleEntryPresence(entry),
    stage: visit.operationalStage,
    review: Boolean(visit.reviewReason || entry._claimOnly),
    legacy: false,
    orderStatus: confirmedOrder ? order.status : undefined,
    visit,
  };
}

export function supervisorVehicleFromLegacy(order: WorkOrder): SupervisorVehicle {
  return {
    key: `order:${order.cloudId || order.id}`,
    workOrderId: order.cloudId,
    workOrderNumber: order.displayNumber || order.id,
    claimId: order.claimId,
    number: order.displayNumber || order.id,
    customer: order.customer,
    vehicle: [order.vehicleType, order.model, order.year].filter(Boolean).join(" "),
    plate: order.plate,
    country: "",
    arrivalDate: order.entryDate,
    channel: isInsuranceWorkOrder(order) ? "insurance" : "cash",
    // No canonical visit means custody is unconfirmed, regardless of old status.
    custody: "needs_review",
    review: true,
    legacy: true,
    orderStatus: order.status,
  };
}

export function supervisorEntryPath(row: SupervisorVehicle, edit = false): string {
  if (row.entryId) return `/supervisor/entry/${encodeURIComponent(row.entryId)}/${edit ? "edit" : "complete"}`;
  if (row.workOrderId) return `/supervisor/entry/new?work_order=${encodeURIComponent(row.workOrderId)}`;
  if (row.claimId) return `/supervisor/entry/new?claim=${encodeURIComponent(row.claimId)}`;
  return "/supervisor/entry/new";
}

export function supervisorCanOpenAction(row: SupervisorVehicle, action: SupervisorAction): boolean {
  if (action === "messages") return Boolean(row.entryId || row.claimId);
  if (action === "stages") return Boolean(row.entryId);
  if (action === "expense") return Boolean(row.entryId || row.workOrderId);
  return Boolean(row.workOrderId);
}

export async function listSupervisorVisits(input: { tab: VehicleCenterTab; page: number; filters: VehicleCenterFilters & { channel?: SupervisorChannel } }) {
  if (input.filters.channel && input.filters.channel !== "all" && !SUPERVISOR_CENTER_CHANNEL_SUPPORTED) {
    throw new Error("SUPERVISOR_CHANNEL_NOT_SUPPORTED");
  }
  return listVehicleVisitCenterPage({ ...input, pageSize: SUPERVISOR_PAGE_SIZE });
}

/** Compatibility fallback: page the server's candidates, then resolve exact
 * visit links. Counts/pagination describe candidates, NEVER an unlinked total.
 * No full-cache scan, plate inference or unbounded fetch is permitted. */
export async function listSupervisorLegacyOrders(input: { tenantId: string; page: number; search: string; channel: SupervisorChannel }) {
  const result = await fetchWorkOrderListPage({
    tenantId: input.tenantId, page: input.page, pageSize: SUPERVISOR_PAGE_SIZE,
    search: input.search, filters: { archive: "active", ownership: input.channel },
  });
  const ids = result.rows.map((order) => order.cloudId);
  if (ids.some((id) => !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("SUPERVISOR_ORDER_ID_REQUIRED");
  if (!ids.length) return { rows: [], pagination: result.pagination };
  // Two bounded projections replace N detail reads per candidate. Check both
  // historical entry FKs AND the order backlink; never infer by plate/vehicle.
  const [backlinks, entries] = await Promise.all([
    (supabase.from("job_orders") as any).select("id,vehicle_entry_id").eq("tenant_id", input.tenantId).in("id", ids),
    (supabase.from("vehicle_entries") as any).select("id,work_order_id,converted_work_order_id").eq("tenant_id", input.tenantId)
      .or(`work_order_id.in.(${ids.join(",")}),converted_work_order_id.in.(${ids.join(",")})`),
  ]);
  if (backlinks.error) throw backlinks.error;
  if (entries.error) throw entries.error;
  if (!Array.isArray(backlinks.data) || backlinks.data.length !== ids.length || !Array.isArray(entries.data)) throw new Error("SUPERVISOR_ORDER_UNAVAILABLE");
  const linkedIds = new Set<string>(backlinks.data.filter((order: any) => order.vehicle_entry_id).map((order: any) => order.id));
  for (const entry of entries.data) {
    if (entry.work_order_id) linkedIds.add(entry.work_order_id);
    if (entry.converted_work_order_id) linkedIds.add(entry.converted_work_order_id);
  }
  return { rows: result.rows.filter((order) => !linkedIds.has(order.cloudId!)).map(supervisorVehicleFromLegacy), pagination: result.pagination };
}

/** Never feed a visible order code or stale list snapshot to write-capable tools. */
export async function readSupervisorOrder(row: SupervisorVehicle): Promise<WorkOrder> {
  if (!row.workOrderId) throw new Error("SUPERVISOR_ORDER_ID_REQUIRED");
  const order = await fetchWorkOrderFromCloudByIdentifier(row.workOrderId);
  if (!order || order.cloudId !== row.workOrderId || order.deletedAt || order.archivedAt) throw new Error("SUPERVISOR_ORDER_UNAVAILABLE");
  if (row.entryId) {
    const linked = await getLinkedVehicleVisit("work_order", row.workOrderId);
    if (linked?.entryId !== row.entryId || linked.reviewReason) throw new Error("SUPERVISOR_ORDER_LINK_CHANGED");
  }
  return order;
}
