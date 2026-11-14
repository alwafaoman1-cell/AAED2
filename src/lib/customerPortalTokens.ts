import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export interface CustomerPortalTokenInfo {
  token: string; signed_at?: string | null; enabled?: boolean; expires_at?: string | null;
  vehicle_make?: string | null; vehicle_model?: string | null; vehicle_year?: string | number | null; customer_name?: string | null;
}
export async function customerPortalEntryForOrder(jobOrderId: string): Promise<string | null> {
  if (!jobOrderId) return null;
  const { data, error } = await supabase.rpc("vehicle_customer_portal_entry_for_order" as any, { p_job_order_id: jobOrderId } as any);
  if (error) throw error;
  const row = data as unknown as { entry_id?: string } | null;
  return row?.entry_id || null;
}
/** Reads never create a public capability. The server owns tenant and visit authority. */
export async function readCustomerPortalToken(jobOrderId: string, tenantId: string): Promise<CustomerPortalTokenInfo | null> {
  if (!tenantId || await getCurrentTenantId() !== tenantId) throw new Error("TENANT_NOT_FOUND");
  const entryId = await customerPortalEntryForOrder(jobOrderId);
  if (!entryId) return null;
  const { data, error } = await supabase.rpc("vehicle_customer_portal_context" as any, { p_entry_id: entryId } as any);
  if (error) throw error;
  const row = data as unknown as CustomerPortalTokenInfo | null;
  return row?.token ? row : null;
}
export function buildCustomerPortalUrl(token?: string | null): string {
  return token && typeof window !== "undefined" ? `${window.location.origin}/customer/vehicle/${encodeURIComponent(token)}` : "";
}
/** Kept as a compatibility export: signing and tracking now share one protected URL. */
export const buildWorkOrderSignatureUrl = buildCustomerPortalUrl;
export async function ensureCustomerPortalToken(jobOrderId: string): Promise<CustomerPortalTokenInfo | null> {
  const entryId = await customerPortalEntryForOrder(jobOrderId);
  if (!entryId) throw new Error("CUSTOMER_PORTAL_VISIT_REQUIRED");
  const { data, error } = await supabase.rpc("ensure_vehicle_customer_portal" as any, { p_entry_id: entryId } as any);
  if (error) throw error;
  const row = data as unknown as CustomerPortalTokenInfo | null;
  if (!row?.token) throw new Error("CUSTOMER_PORTAL_TOKEN_NOT_CONFIRMED");
  return row;
}
