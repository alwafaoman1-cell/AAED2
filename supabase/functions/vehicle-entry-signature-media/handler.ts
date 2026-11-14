// @ts-nocheck


const allowedOrigins = new Set([
  "https://aaed-2.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

export function corsHeaders(request: Request, env: (key: string) => string | undefined) {
  const origin = request.headers.get("origin") || "";
  const extraOrigins = (env("VEHICLE_SIGNATURE_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  // Loopback is enabled only for the named Development project, never Production.
  const development = env("SUPABASE_URL") === "https://rrhyglrnlveygyiandhs.supabase.co";
  let loopback = false;
  try {
    const url = new URL(origin);
    loopback = development && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.origin === origin;
  } catch { /* An opaque or malformed origin is not trusted. */ }
  return {
    ...(allowedOrigins.has(origin) || extraOrigins.includes(origin) || loopback ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

export function createSignatureMediaHandler(createClient, env: (key: string) => string | undefined) {
function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request, env), "Content-Type": "application/json" },
  });
}

return async (request: Request) => {
  if (request.headers.has("origin") && !corsHeaders(request, env)["Access-Control-Allow-Origin"]) return json(request, { error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request, env) });
  if (request.method !== "POST") return json(request, { error: "method_not_allowed" }, 405);

  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 4096) return json(request, { error: "request_too_large" }, 413);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4096) return json(request, { error: "request_too_large" }, 413);
    let body; try { body = JSON.parse(raw); } catch { body = null; }
    const token = String(body?.portal_token || "").trim();
    const session = String(body?.portal_session || "").trim();
    const requestedEntry = String(body?.entry_id || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(token) || !/^[a-f0-9]{64}$/i.test(session) || !/^[a-f0-9-]{36}$/i.test(requestedEntry)) return json(request, { error: "portal_access_required" }, 401);
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(request, { error: "service_unavailable" }, 503);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: scope, error: scopeError } = await admin.rpc("customer_vehicle_portal_media_scope", { p_token: token, p_session: session, p_entry_id: requestedEntry });
    if (scopeError || !scope?.entry_id || !scope?.tenant_id) return json(request, { error: "portal_access_required" }, 403);
    if (body.revision != null && Number(body.revision) !== scope.revision) return json(request, { error: "portal_revision_changed" }, 409);
    const tenantId = scope.tenant_id; const entryId = scope.entry_id; const linkRevision = scope.revision;
    const frozenIds = Array.isArray(scope.media_ids) ? [...new Set(scope.media_ids)] : null;
    const mediaQuery = () => admin
      .from("vehicle_media")
      .select("id,storage_bucket,storage_path,category,file_name,mime_type,caption,uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("vehicle_entry_id", entryId)
      .eq("media_type", "image")
      .is("deleted_at", null);
    const mediaRows = [];
    if (frozenIds) {
      // A signed document must include every recorded image. The preview limit
      // for an unsigned intake must not truncate its immutable signed evidence.
      for (let offset = 0; offset < frozenIds.length; offset += 50) {
        const ids = frozenIds.slice(offset, offset + 50);
        const { data, error } = await mediaQuery().in("id", ids)
          .order("uploaded_at", { ascending: true }).limit(ids.length);
        if (error) throw error;
        mediaRows.push(...(data || []));
      }
      mediaRows.sort((a, b) => String(a.uploaded_at || "").localeCompare(String(b.uploaded_at || "")) || String(a.id).localeCompare(String(b.id)));
    } else {
      const { data, error } = await mediaQuery()
        .order("uploaded_at", { ascending: true }).limit(12);
      if (error) throw error;
      mediaRows.push(...(data || []));
    }

    const media = [];
    let unavailableCount = frozenIds ? frozenIds.filter(id => !(mediaRows || []).some(row => row.id === id)).length : 0;
    for (const row of mediaRows || []) {
      const bucket = String(row.storage_bucket || "insurance-docs");
      const path = String(row.storage_path || "").replace(/^\/+/, "");
      if (!path || path.includes("..") || !path.startsWith(`${tenantId}/vehicle-entry/${entryId}/`)) { unavailableCount++; continue; }
      if (row.mime_type && !String(row.mime_type).startsWith("image/")) { unavailableCount++; continue; }

      const { data: signed, error: signError } = await admin.storage.from(bucket).createSignedUrl(path, 60);
      if (signError || !signed?.signedUrl) { unavailableCount++; continue; }
      media.push({
        id: row.id,
        url: signed.signedUrl,
        category: row.category || "other",
        file_name: row.file_name || "Vehicle entry photo",
        caption: row.caption || null,
      });
    }

    const { data: current, error: currentError } = await admin.rpc("customer_vehicle_portal_media_scope", { p_token: token, p_session: session, p_entry_id: requestedEntry });
    if (currentError || !current || current.revision !== linkRevision) return json(request, { error: "portal_access_required" }, 403);
    return json(request, { media, revision: linkRevision, expires_in: 60, unavailable_count: unavailableCount });
  } catch (error) {
    console.error("vehicle-entry-signature-media", error instanceof Error ? error.message : "unknown_error");
    return json(request, { error: "media_unavailable" }, 500);
  }
};
}
