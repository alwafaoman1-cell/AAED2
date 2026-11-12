import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export interface CustomerPortalTokenInfo {
  token: string;
  signed_at?: string | null;
}

/** A page read must never create a public capability as a side effect. */
export async function readCustomerPortalToken(jobOrderId: string, tenantId: string): Promise<CustomerPortalTokenInfo | null> {
  const {data,error}=await supabase.from("customer_portal_tokens" as any).select("token,signed_at")
    .eq("tenant_id",tenantId).eq("job_order_id",jobOrderId).maybeSingle();
  if(error)throw error;
  const row=data as unknown as CustomerPortalTokenInfo|null;
  return row?.token?{token:String(row.token),signed_at:row.signed_at||null}:null;
}

function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildCustomerPortalUrl(token?: string | null): string {
  if (!token || typeof window === "undefined") return "";
  return `${window.location.origin}/p/${encodeURIComponent(token)}`;
}

export function buildWorkOrderSignatureUrl(token?: string | null): string {
  if (!token || typeof window === "undefined") return "";
  return `${window.location.origin}/sign/${encodeURIComponent(token)}`;
}

/**
 * Ensures a durable public token exists for a cloud job order.
 * The token table is the official public-link source; job_orders.tracking_token
 * is kept only as a legacy fallback for older links and QR codes.
 */
export async function ensureCustomerPortalToken(jobOrderId: string): Promise<CustomerPortalTokenInfo | null> {
  if (!jobOrderId) return null;
  const tenantId=await getCurrentTenantId();
  if(!tenantId)throw new Error("TENANT_NOT_FOUND");
  const existing=await readCustomerPortalToken(jobOrderId,tenantId);
  if(existing)return existing;

  const orderResult = await supabase
    .from("job_orders" as any)
    .select("tenant_id, tracking_token")
    .eq("tenant_id",tenantId)
    .eq("id", jobOrderId)
    .maybeSingle();

  const order = orderResult.data as any;
  if(orderResult.error)throw orderResult.error;
  if (!order?.tenant_id) return null;

  const preferredToken = order.tracking_token ? String(order.tracking_token) : randomHex();
  const inserted = await supabase
    .from("customer_portal_tokens" as any)
    .insert({
      tenant_id: order.tenant_id,
      job_order_id: jobOrderId,
      token: preferredToken,
    })
    .select("token, signed_at")
    .maybeSingle();

  if ((inserted.data as any)?.token) {
    return {
      token: String((inserted.data as any).token),
      signed_at: (inserted.data as any).signed_at || null,
    };
  }

  // Race-safe fallback if another client/session created it first.
  const afterRace = await supabase
    .from("customer_portal_tokens" as any)
    .select("token, signed_at")
    .eq("tenant_id",tenantId)
    .eq("job_order_id", jobOrderId)
    .maybeSingle();

  if(afterRace.error)throw afterRace.error;

  if ((afterRace.data as any)?.token) {
    return {
      token: String((afterRace.data as any).token),
      signed_at: (afterRace.data as any).signed_at || null,
    };
  }

  if (inserted.error) throw inserted.error;
  throw new Error("CUSTOMER_PORTAL_TOKEN_NOT_CONFIRMED");
}
