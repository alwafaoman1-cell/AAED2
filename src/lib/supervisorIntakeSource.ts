import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { defaultVehicleEntryForm, getVehicleEntryByClaimId, type VehicleEntryFormState } from "@/lib/vehicleEntryService";
import { findPrimaryClaimWorkOrder } from "@/lib/claimWorkOrderGuard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface SupervisorIntakeSource { existingEntryId: string | null; form?: VehicleEntryFormState; channel: "cash" | "insurance" }

/** Only explicit cloud identities may prefill a new intake. This does not
 * record an arrival, infer historical links, change ownership or create data. */
export async function loadSupervisorIntakeSource(source: { claimId?: string | null; workOrderId?: string | null }): Promise<SupervisorIntakeSource> {
  const tenant = await getCurrentTenantId();
  if (!tenant || (!source.claimId && !source.workOrderId) || [source.claimId, source.workOrderId].some(id => id && !UUID.test(id))) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  let order: any = null;
  let claim: any = null;
  if (source.workOrderId) {
    const result = await supabase.from("job_orders").select("*").eq("tenant_id", tenant).eq("id", source.workOrderId).is("deleted_at", null).maybeSingle();
    if (result.error) throw result.error;
    order = result.data;
    if (!order || order.tenant_id !== tenant || (source.claimId && order.claim_id !== source.claimId)) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  }
  const claimId = source.claimId || order?.claim_id;
  if (claimId) {
    const result = await supabase.from("insurance_claims").select("*").eq("tenant_id", tenant).eq("id", claimId).is("deleted_at", null).maybeSingle();
    if (result.error) throw result.error;
    claim = result.data;
    if (!claim || claim.tenant_id !== tenant || ["cancelled", "rejected"].includes(claim.status)) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
    if (!order) {
      const primary = await findPrimaryClaimWorkOrder(tenant, claim.id);
      if (primary) {
        const result = await supabase.from("job_orders").select("*").eq("tenant_id", tenant).eq("id", primary.id).is("deleted_at", null).maybeSingle();
        if (result.error) throw result.error;
        order = result.data;
        if (!order || order.claim_id !== claim.id) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
      }
    }
  }
  const vehicleId = claim?.vehicle_id || order?.vehicle_id;
  if (!vehicleId || (claim && order && (order.vehicle_id !== vehicleId || order.claim_id !== claim.id || order.work_order_type !== "insurance"))) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  const channel = claim ? "insurance" : "cash";
  if (!claim && order?.work_order_type === "insurance") throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  // Reuse confirmed links. A historical backlink without matching direct links
  // is a review case, not authorization for automatic relinking.
  const existing = claim ? await getVehicleEntryByClaimId(claim.id) : null;
  const ids = new Set<string>(existing?.id ? [existing.id] : []);
  if (order) {
    const byOrder = await supabase.from("vehicle_entries" as any).select("id,vehicle_id,work_order_id,converted_work_order_id")
      .eq("tenant_id", tenant).is("deleted_at", null).or(`work_order_id.eq.${order.id},converted_work_order_id.eq.${order.id}`).limit(2);
    if (byOrder.error) throw byOrder.error;
    for (const entry of (byOrder.data || []) as any[]) {
      if (entry.vehicle_id !== vehicleId) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
      ids.add(entry.id);
    }
    if (order.vehicle_entry_id) ids.add(order.vehicle_entry_id);
  }
  if (ids.size > 1) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  if (ids.size === 1) {
    const entryId = [...ids][0];
    const result = await supabase.from("vehicle_entries" as any).select("id,tenant_id,vehicle_id,insurance_claim_id,converted_claim_id,work_order_id,converted_work_order_id")
      .eq("tenant_id", tenant).eq("id", entryId).is("deleted_at", null).maybeSingle();
    if (result.error) throw result.error;
    const entry = result.data as any;
    if (!entry || entry.vehicle_id !== vehicleId || (claim && ![entry.insurance_claim_id, entry.converted_claim_id].includes(claim.id))
      || (order && ![entry.work_order_id, entry.converted_work_order_id].includes(order.id))) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
    return { existingEntryId: entry.id, channel };
  }
  if (order?.status === "delivered" || order?.vehicle_delivered_at || claim?.delivered_at || claim?.vehicle_delivered_at) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  const customerId = claim?.customer_id || order?.customer_id;
  const [vehicleResult, customerResult, companyResult] = await Promise.all([
    supabase.from("vehicles").select("*").eq("tenant_id", tenant).eq("id", vehicleId).is("deleted_at", null).maybeSingle(),
    customerId ? supabase.from("customers").select("*").eq("tenant_id", tenant).eq("id", customerId).is("deleted_at", null).maybeSingle() : Promise.resolve({ data: null, error: null }),
    claim?.insurance_company_id ? supabase.from("insurance_companies").select("id,name").eq("tenant_id", tenant).eq("id", claim.insurance_company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [vehicleResult, customerResult, companyResult]) if (result.error) throw result.error;
  if (!vehicleResult.data || (customerId && !customerResult.data) || (claim?.insurance_company_id && !companyResult.data)) throw new Error("SUPERVISOR_INTAKE_SOURCE_INVALID");
  const vehicle = vehicleResult.data;
  const customer = customerResult.data;
  const base = defaultVehicleEntryForm();
  const visitor = { ...base.customer, name: customer?.name || claim?.vehicle_owner_name || order?.customer_name || "", phone: customer?.phone || claim?.vehicle_owner_phone || order?.customer_phone || "",
    customer_code: customer?.customer_code || "", id_number: customer?.id_number || "", address: customer?.address || "" };
  return { existingEntryId: null, channel, form: {
    ...base, customer_id: customer?.id || null, vehicle_id: vehicle.id, insurance_claim_id: claim?.id || null, work_order_id: order?.id || null,
    insurance_company_id: claim?.insurance_company_id || null, customer: visitor,
    vehicle: { ...base.vehicle, plate_number: vehicle.plate_number || "", plate_letters: vehicle.plate_letters || "", plate_country: vehicle.plate_country || "OM", make: vehicle.brand || "", model: vehicle.model || "", year: String(vehicle.year || ""), vin: vehicle.vin_number || vehicle.vin || "", color: vehicle.color || "" },
    insurance: { ...base.insurance, is_insurance_related: !!claim, company_name: companyResult.data?.name || "", claim_number: claim?.claim_number || "", policy_number: claim?.policy_number || "" },
    delivered_by: { ...base.delivered_by, full_name: visitor.name, phone: visitor.phone, id_number: visitor.id_number },
  } };
}
