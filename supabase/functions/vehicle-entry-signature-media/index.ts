// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const allowedOrigins = new Set([
  "https://aaed-2.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://aaed-2.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "method_not_allowed" }, 405);

  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 4096) return json(request, { error: "request_too_large" }, 413);

    const body = await request.json().catch(() => null);
    const token = String(body?.token || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) return json(request, { error: "invalid_link" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(request, { error: "service_unavailable" }, 503);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date().toISOString();
    const { data: link, error: linkError } = await admin
      .from("vehicle_entry_signature_links")
      .select("tenant_id,vehicle_entry_id,expires_at,consumed_at")
      .eq("token", token)
      .is("revoked_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return json(request, { error: "invalid_link" }, 404);

    const { data: entry, error: entryError } = await admin
      .from("vehicle_entries")
      .select("id")
      .eq("id", link.vehicle_entry_id)
      .eq("tenant_id", link.tenant_id)
      .is("deleted_at", null)
      .neq("status", "Cancelled")
      .maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return json(request, { error: "entry_unavailable" }, 404);

    const { data: mediaRows, error: mediaError } = await admin
      .from("vehicle_media")
      .select("id,storage_bucket,storage_path,category,file_name,mime_type,caption,uploaded_at")
      .eq("tenant_id", link.tenant_id)
      .eq("vehicle_entry_id", link.vehicle_entry_id)
      .eq("media_type", "image")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: true })
      .limit(12);
    if (mediaError) throw mediaError;

    const media = [];
    for (const row of mediaRows || []) {
      const bucket = String(row.storage_bucket || "insurance-docs");
      const path = String(row.storage_path || "").replace(/^\/+/, "");
      if (!path || path.includes("..") || !path.startsWith(`${link.tenant_id}/vehicle-entry/${link.vehicle_entry_id}/`)) continue;
      if (row.mime_type && !String(row.mime_type).startsWith("image/")) continue;

      const { data: signed, error: signError } = await admin.storage.from(bucket).createSignedUrl(path, 900);
      if (signError || !signed?.signedUrl) continue;
      media.push({
        id: row.id,
        url: signed.signedUrl,
        category: row.category || "other",
        file_name: row.file_name || "Vehicle entry photo",
        caption: row.caption || null,
      });
    }

    return json(request, { media, expires_in: 900 });
  } catch (error) {
    console.error("vehicle-entry-signature-media", error instanceof Error ? error.message : "unknown_error");
    return json(request, { error: "media_unavailable" }, 500);
  }
});
