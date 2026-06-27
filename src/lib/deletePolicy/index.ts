import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import type { WorkOrder } from "@/lib/workOrdersStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeleteMode =
  | "archive_only"
  | "delete_keep_financial"
  | "delete_with_related"
  | "archive_customer_only"
  | "archive_customer_operational"
  | "delete_customer_related";

export interface ImpactSummary {
  expenses: number;
  invoices: number;
  payments: number;
  messages: number;
  photos: number;
  requiredParts: number;
  attachments: number;
  audits: number;
  claims: number;
  vehicles?: number;
  workOrders?: number;
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || null;
}

export async function writeOperationalAudit(input: {
  action: string;
  entityType: string;
  entityId: string;
  relatedEntities?: Record<string, unknown>;
  reason?: string;
  deleteMode?: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
}) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("tenant_not_found");
  const { error } = await (supabase.from("operational_audit_log" as any) as any).insert({
    tenant_id: tenantId,
    user_id: await currentUserId(),
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    related_entities: input.relatedEntities || {},
    reason: input.reason || null,
    delete_mode: input.deleteMode || null,
    before_snapshot: input.beforeSnapshot || null,
    after_snapshot: input.afterSnapshot || null,
  });
  if (error) throw error;
}

async function resolveWorkOrder(order: WorkOrder) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("tenant_not_found");
  if (order.cloudId) return { tenantId, cloudId: order.cloudId, orderNumber: order.displayNumber || order.id };
  const q = supabase.from("job_orders").select("id,order_number").eq("tenant_id", tenantId);
  const { data, error } = UUID_RE.test(order.id)
    ? await q.or(`order_number.eq.${order.displayNumber || order.id},id.eq.${order.id}`).maybeSingle()
    : await q.eq("order_number", order.displayNumber || order.id).maybeSingle();
  if (error) throw error;
  return { tenantId, cloudId: (data as any)?.id || null, orderNumber: (data as any)?.order_number || order.displayNumber || order.id };
}

export async function getWorkOrderImpact(order: WorkOrder): Promise<ImpactSummary> {
  const { tenantId, cloudId, orderNumber } = await resolveWorkOrder(order);
  const ids = [cloudId, orderNumber, order.id].filter(Boolean) as string[];
  const count = async (table: string, build: (q: any) => any) => {
    const { count: c } = await build((supabase.from(table as any) as any).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId));
    return c || 0;
  };
  const expenses = await count("expenses", (q) => q.in("linked_work_order_id", ids));
  const invoices = await count("sales_documents", (q) => q.in("work_order_id", ids));
  const messages = cloudId ? await count("whatsapp_logs", (q) => q.eq("job_order_id", cloudId)) : 0;
  const claims = cloudId ? await count("insurance_claims", (q) => q.or(`job_order_id.eq.${cloudId},auto_job_order_id.eq.${cloudId}`)) : 0;
  return {
    expenses,
    invoices,
    payments: 0,
    messages,
    photos: order.photos?.length || 0,
    requiredParts: order.partsNeeded?.length || 0,
    attachments: 0,
    audits: 0,
    claims,
  };
}

export async function archiveWorkOrder(order: WorkOrder, reason = "archive work order only") {
  const { tenantId, cloudId, orderNumber } = await resolveWorkOrder(order);
  const archivedAt = new Date().toISOString();
  const before = { ...order };
  if (cloudId) {
    const { error } = await supabase
      .from("job_orders")
      .update({ archived_at: archivedAt } as any)
      .eq("tenant_id", tenantId)
      .eq("id", cloudId);
    if (error) throw error;
  }
  await writeOperationalAudit({
    action: "work_order_archive_requested",
    entityType: "work_order",
    entityId: orderNumber,
    reason,
    deleteMode: "archive_only",
    beforeSnapshot: before,
    afterSnapshot: { archived_at: archivedAt },
  });
  return { archivedAt };
}

export async function deleteWorkOrderKeepFinancial(order: WorkOrder, reason: string) {
  const result = await archiveWorkOrder(order, reason || "delete work order keep financial records");
  await writeOperationalAudit({
    action: "work_order_delete_requested",
    entityType: "work_order",
    entityId: order.displayNumber || order.id,
    reason,
    deleteMode: "delete_keep_financial",
    beforeSnapshot: order,
    afterSnapshot: { archived_at: result.archivedAt, financial_records_kept: true },
  });
  return result;
}

export async function deleteWorkOrderWithRelated(order: WorkOrder, reason: string) {
  const { tenantId, cloudId, orderNumber } = await resolveWorkOrder(order);
  if (!reason.trim()) throw new Error("Delete reason is required");
  const archivedAt = new Date().toISOString();
  const ids = [cloudId, orderNumber, order.id].filter(Boolean) as string[];

  await supabase
    .from("expenses")
    .update({ archived_at: archivedAt } as any)
    .eq("tenant_id", tenantId)
    .in("linked_work_order_id", ids);

  await supabase
    .from("sales_documents")
    .update({ status: "cancelled", archived_at: archivedAt } as any)
    .eq("tenant_id", tenantId)
    .in("work_order_id", ids);

  if (cloudId) {
    const { error } = await supabase
      .from("job_orders")
      .update({ archived_at: archivedAt, status: "delivered" } as any)
      .eq("tenant_id", tenantId)
      .eq("id", cloudId);
    if (error) throw error;
  }

  await writeOperationalAudit({
    action: "work_order_deleted_with_related_records",
    entityType: "work_order",
    entityId: orderNumber,
    reason,
    deleteMode: "delete_with_related",
    relatedEntities: { expenses_archived: true, invoices_cancelled: true },
    beforeSnapshot: order,
    afterSnapshot: { archived_at: archivedAt },
  });
  return { archivedAt };
}

export async function getCustomerImpact(customerId: string): Promise<ImpactSummary> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("tenant_not_found");
  const count = async (table: string, column: string) => {
    const { count: c } = await (supabase.from(table as any) as any).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq(column, customerId);
    return c || 0;
  };
  return {
    vehicles: await count("vehicles", "customer_id"),
    workOrders: await count("job_orders", "customer_id"),
    claims: await count("insurance_claims", "customer_id"),
    invoices: await count("sales_documents", "customer_id"),
    expenses: 0,
    payments: 0,
    messages: 0,
    photos: 0,
    requiredParts: 0,
    attachments: 0,
    audits: 0,
  };
}

export async function archiveCustomer(customerId: string, reason: string, operational = false) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("tenant_not_found");
  const archivedAt = new Date().toISOString();
  const { data: before } = await supabase.from("customers").select("*").eq("tenant_id", tenantId).eq("id", customerId).maybeSingle();
  const { error } = await supabase
    .from("customers")
    .update({ archived: true, archived_at: archivedAt, archived_reason: reason || null } as any)
    .eq("tenant_id", tenantId)
    .eq("id", customerId);
  if (error) throw error;
  if (operational) {
    await supabase.from("vehicles").update({ archived: true, archived_at: archivedAt, archived_reason: reason || null } as any).eq("tenant_id", tenantId).eq("customer_id", customerId);
    await supabase.from("job_orders").update({ archived_at: archivedAt } as any).eq("tenant_id", tenantId).eq("customer_id", customerId);
  }
  await writeOperationalAudit({
    action: operational ? "customer_archive_operational_requested" : "customer_archive_requested",
    entityType: "customer",
    entityId: customerId,
    reason,
    deleteMode: operational ? "archive_customer_operational" : "archive_customer_only",
    beforeSnapshot: before,
    afterSnapshot: { archived: true, archived_at: archivedAt },
  });
  return { archivedAt };
}
