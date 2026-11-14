import { supabase } from "@/integrations/supabase/client";

/** Explicit local harness only; release builds keep the normal Edge endpoint. */
export function localSignatureMediaUrl(configured: string | undefined, supabaseUrl: string, hostname: string) {
  if (!configured || supabaseUrl !== "https://rrhyglrnlveygyiandhs.supabase.co" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "5196" && url.pathname === "/vehicle-entry-signature-media" && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

export async function loadVehicleSignatureMedia(token: string, purpose?: "inspection_release") {
  const localUrl = localSignatureMediaUrl(import.meta.env.VITE_VEHICLE_SIGNATURE_MEDIA_LOCAL_URL, import.meta.env.VITE_SUPABASE_URL, window.location.hostname);
  if (!localUrl) return supabase.functions.invoke("vehicle-entry-signature-media", { body: { token, ...(purpose ? { purpose } : {}) } });
  try {
    // The link itself is the credential. Never forward the staff's session to a local service.
    const response = await fetch(localUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...(purpose ? { purpose } : {}) }), cache: "no-store", credentials: "omit" });
    const data = await response.json();
    return { data, error: response.ok ? null : new Error(data.error || "media_unavailable") };
  } catch (error) { return { data: null, error }; }
}

/** Session-bound media for the unified portal; legacy bearer tokens are rejected. */
export async function loadUnifiedVehiclePortalMedia(token: string, session: string, entryId: string, revision?: number) {
 const body = { portal_token: token, portal_session: session, entry_id: entryId, ...(revision == null ? {} : { revision }) };
 const localUrl = localSignatureMediaUrl(import.meta.env.VITE_VEHICLE_SIGNATURE_MEDIA_LOCAL_URL, import.meta.env.VITE_SUPABASE_URL, window.location.hostname);
 if (!localUrl) return supabase.functions.invoke("vehicle-entry-signature-media", { body });
 try {
  const response = await fetch(localUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", cache: "no-store" });
  const data = await response.json(); return { data, error: response.ok ? null : new Error(data.error || "media_unavailable") };
 } catch (error) { return { data: null, error }; }
}
