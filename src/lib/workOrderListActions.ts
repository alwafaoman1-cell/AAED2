import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { fetchActualExpenseCostsForOrders, fetchWorkOrderFromCloudByIdentifier, type WorkOrder } from "@/lib/workOrdersStore";

/** List rows are display projections, never editable/persistable snapshots. */
export async function resolveWorkOrderListAction(
  identity: string | Pick<WorkOrder, "id" | "cloudId">,
  tenantId: string,
): Promise<WorkOrder> {
  if (!tenantId || await getCurrentTenantId() !== tenantId) throw new Error("WORK_ORDER_READ_SCOPE_CHANGED");
  const id = typeof identity === "string" ? identity : identity.cloudId || identity.id;
  const record = await fetchWorkOrderFromCloudByIdentifier(id);
  if (await getCurrentTenantId() !== tenantId) throw new Error("WORK_ORDER_READ_SCOPE_CHANGED");
  if (!record || record.deletedAt) throw new Error("WORK_ORDER_UNAVAILABLE_REOPEN_LIST");
  if (record.summaryOnly) throw new Error("WORK_ORDER_FULL_RECORD_REQUIRED");
  return record;
}

/** Bound concurrency and retain selection order, including selections on another page. */
export async function resolveSelectedWorkOrderActions(ids: readonly string[], tenantId: string): Promise<WorkOrder[]> {
  const records: WorkOrder[] = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 4) {
    records.push(...await Promise.all(unique.slice(offset, offset + 4).map(id => resolveWorkOrderListAction(id, tenantId))));
  }
  return records;
}

/** Canonical detail reads omit expense totals; exports must use the existing scoped cost reader. */
export async function resolveSelectedWorkOrderExport(ids: readonly string[], tenantId: string): Promise<WorkOrder[]> {
  const records = await resolveSelectedWorkOrderActions(ids, tenantId);
  const costs = await fetchActualExpenseCostsForOrders(tenantId, records.map(order => ({
    id: order.cloudId || order.id, order_number: order.displayNumber || order.id,
  })));
  if (await getCurrentTenantId() !== tenantId) throw new Error("WORK_ORDER_READ_SCOPE_CHANGED");
  return records.map(order => ({ ...order, actualExpenseCost: costs.get(order.cloudId || order.id) || 0 }));
}
