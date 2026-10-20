// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const allowedOrigins = new Set([
  "https://aaed-2.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const extraOrigins = (Deno.env.get("VEHICLE_SIGNATURE_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) || extraOrigins.includes(origin) ? origin : "https://aaed-2.vercel.app",
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
    const inspectionRelease = body?.purpose === "inspection_release";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(request, { error: "service_unavailable" }, 503);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date().toISOString();
    let tenantId = "";
    let entryId = "";
    let photoIds: string[] | null = null;
    if (inspectionRelease) {
      const bytes = new TextEncoder().encode(token);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const tokenHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { data: link, error: linkError } = await admin
        .from("vehicle_inspection_release_links")
        .select("tenant_id,release_id,expires_at")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", now)
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link) return json(request, { error: "invalid_link" }, 404);
      const { data: release, error: releaseError } = await admin
        .from("vehicle_inspection_releases")
        .select("tenant_id,vehicle_entry_id,photo_media_ids,status")
        .eq("tenant_id", link.tenant_id)
        .eq("id", link.release_id)
        .in("status", ["awaiting_signature", "signed"])
        .maybeSingle();
      if (releaseError) throw releaseError;
      if (!release) return json(request, { error: "release_unavailable" }, 404);
      tenantId = release.tenant_id;
      entryId = release.vehicle_entry_id;
      photoIds = Array.isArray(release.photo_media_ids) ? release.photo_media_ids.slice(0, 12) : [];
    } else {
      const { data: link, error: linkError } = await admin
        .from("vehicle_entry_signature_links")
        .select("tenant_id,vehicle_entry_id,expires_at,consumed_at")
        .eq("token", token)
        .is("revoked_at", null)
        .gt("expires_at", now)
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link) return json(request, { error: "invalid_link" }, 404);
      tenantId = link.tenant_id;
      entryId = link.vehicle_entry_id;
    }

    let entryQuery = admin
      .from("vehicle_entries")
      .select("id")
      .eq("id", entryId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    entryQuery = inspectionRelease
      ? entryQuery.in("status", ["Received", "Issued", "Converted to Claim", "Converted to Work Order"])
      : entryQuery.neq("status", "Cancelled");
    const { data: entry, error: entryError } = await entryQuery.maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return json(request, { error: "entry_unavailable" }, 404);

    let mediaQuery = admin
      .from("vehicle_media")
      .select("id,storage_bucket,storage_path,category,file_name,mime_type,caption,uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", entryId)
      .eq("media_type", "image")
      .is("deleted_at", null);
    if (photoIds) mediaQuery = photoIds.length ? mediaQuery.in("id", photoIds) : mediaQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    const { data: mediaRows, error: mediaError } = await mediaQuery
      .order("uploaded_at", { ascending: true }).limit(12);
    if (mediaError) throw mediaError;

    const media = [];
    for (const row of mediaRows || []) {
      const bucket = String(row.storage_bucket || "insurance-docs");
      const path = String(row.storage_path || "").replace(/^\/+/, "");
      if (!path || path.includes("..") || !path.startsWith(`${tenantId}/vehicle-entry/${entryId}/`)) continue;
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
