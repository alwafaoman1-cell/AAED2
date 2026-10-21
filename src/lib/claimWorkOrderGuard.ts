import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";

export interface PrimaryClaimWorkOrder {
  id: string;
  order_number: string;
  vehicle_id: string | null;
  status: string | null;
  parent_work_order_id?: string | null;
  deleted_at?: string | null;
}

export class ClaimWorkOrderAlreadyExistsError extends Error {
  readonly code = "CLAIM_WORK_ORDER_ALREADY_EXISTS";

  constructor(readonly workOrder: PrimaryClaimWorkOrder) {
    super(i18n.t("claimWorkOrder.alreadyExists", { number: workOrder.order_number }));
    this.name = "ClaimWorkOrderAlreadyExistsError";
  }
}

export class ClaimWorkOrderConflictError extends Error {
  readonly code = "CLAIM_WORK_ORDER_CONFLICT";

  constructor(readonly workOrders: PrimaryClaimWorkOrder[]) {
    super(i18n.t("claimWorkOrder.conflict", { numbers: workOrders.map((row) => row.order_number).join(", ") }));
    this.name = "ClaimWorkOrderConflictError";
  }
}

/** A repeat visit must explicitly name its parent; it is not a second primary order. */
export function resolvePrimaryClaimWorkOrder(rows: PrimaryClaimWorkOrder[]): PrimaryClaimWorkOrder | null {
  const unique = new Map<string, PrimaryClaimWorkOrder>();
  for (const row of rows) {
    if (row.id && !row.deleted_at && !row.parent_work_order_id) unique.set(row.id, row);
  }
  const active = [...unique.values()];
  if (active.length > 1) throw new ClaimWorkOrderConflictError(active);
  return active[0] || null;
}

/** Reads both relational and legacy claim links before allowing a new order. */
export async function findPrimaryClaimWorkOrder(tenantId: string, claimId: string): Promise<PrimaryClaimWorkOrder | null> {
  const { data: claim, error: claimError } = await supabase
    .from("insurance_claims")
    .select("id,job_order_id,auto_job_order_id")
    .eq("tenant_id", tenantId)
    .eq("id", claimId)
    .is("deleted_at", null)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claim) throw new Error(i18n.t("claimWorkOrder.claimMissing"));

  const { data: byClaim, error: ordersError } = await supabase
    .from("job_orders")
    .select("id,order_number,vehicle_id,status,parent_work_order_id,deleted_at")
    .eq("tenant_id", tenantId)
    .eq("claim_id", claimId)
    .is("deleted_at", null)
    .is("parent_work_order_id", null);
  if (ordersError) throw ordersError;

  const rows = (byClaim || []) as PrimaryClaimWorkOrder[];
  const linkedIds = [claim.job_order_id, claim.auto_job_order_id]
    .filter((value): value is string => !!value && !rows.some((row) => row.id === value));
  if (linkedIds.length) {
    const { data: byId, error: linkedError } = await supabase
      .from("job_orders")
      .select("id,order_number,vehicle_id,status,parent_work_order_id,deleted_at")
      .eq("tenant_id", tenantId)
      .in("id", linkedIds)
      .is("deleted_at", null)
      .is("parent_work_order_id", null);
    if (linkedError) throw linkedError;
    rows.push(...((byId || []) as PrimaryClaimWorkOrder[]));
  }
  return resolvePrimaryClaimWorkOrder(rows);
}
