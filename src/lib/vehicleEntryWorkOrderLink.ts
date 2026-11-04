import i18n from "@/i18n";

interface EntryIdentity {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  insurance_claim_id?: string | null;
  converted_claim_id?: string | null;
  work_order_id?: string | null;
  converted_work_order_id?: string | null;
}
interface OrderIdentity {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  vehicle_entry_id?: string | null;
  claim_id?: string | null;
  work_order_type: string;
  deleted_at?: string | null;
  parent_work_order_id?: string | null;
}

/** A matching plate/customer is not proof of the same visit. Never repair a
 * different vehicle ID or backlink merely to make a link warning disappear. */
export function assertVehicleEntryWorkOrderLink(entry: EntryIdentity, order: OrderIdentity | null | undefined): void {
  if (!order?.id || !entry.id || !entry.tenant_id || order.tenant_id !== entry.tenant_id
    || order.deleted_at || (order.parent_work_order_id && entry.work_order_id!==order.id && entry.converted_work_order_id!==order.id)
    || !entry.vehicle_id || order.vehicle_id !== entry.vehicle_id
    || (order.vehicle_entry_id && order.vehicle_entry_id !== entry.id)
    || (entry.work_order_id && entry.work_order_id !== order.id)
    || (entry.converted_work_order_id && entry.converted_work_order_id !== order.id)
    || (entry.insurance_claim_id && entry.converted_claim_id && entry.insurance_claim_id !== entry.converted_claim_id)) {
    throw new Error(i18n.t("vehicleVisit.work_order_link_conflict"));
  }
  const claimId = entry.insurance_claim_id || entry.converted_claim_id;
  if (claimId ? order.claim_id !== claimId || order.work_order_type !== "insurance"
    : Boolean(order.claim_id) || order.work_order_type === "insurance") {
    throw new Error(i18n.t("vehicleVisit.work_order_channel_conflict"));
  }
}

/** Only confirmed visit FKs/backlinks may feed money/documents on an entry.
 * An inferred claim candidate is review evidence, not an accounting source. */
export function hasConfirmedVehicleEntryWorkOrderLink(entry: EntryIdentity | null | undefined, order: OrderIdentity | null | undefined): boolean {
  if(!entry || !order || (!([entry.work_order_id,entry.converted_work_order_id].includes(order.id)) && order.vehicle_entry_id!==entry.id)) return false;
  try{assertVehicleEntryWorkOrderLink(entry,order);return true;}catch{return false;}
}
