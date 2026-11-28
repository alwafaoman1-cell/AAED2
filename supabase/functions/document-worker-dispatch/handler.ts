/** User-JWT/RLS checked wakeup. The durable extraction stays in Postgres. */
type Environment = {
  url: string;
  anonKey: string;
  dispatchUrl: string;
  dispatchSecret: string;
  fetcher?: typeof fetch;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projects = { development: "rrhyglrnlveygyiandhs", production: "ifnfwssdtjuzdtshnrht" };
const previewHost = /^aaed-2-[a-z0-9-]+-alwafaoman1-cells-projects\.vercel\.app$/;
const workerVersions = new Set(["1.0.0-worker", "1.0.1-worker", "1.0.2-worker", "1.0.3-worker",
  "1.0.4-worker", "1.0.5-worker", "1.0.6-worker", "1.0.7-en-worker", "1.0.8-en-worker"]);
const finished = new Set(["extracted", "needs_review", "verified", "failed"]);

async function smallJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 512) { await reader.cancel(); throw new Error("BODY_LIMIT"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createDocumentDispatchHandler(environment: Environment) {
  const base = new URL(environment.url);
  const target = new URL(environment.dispatchUrl);
  const development = base.hostname === `${projects.development}.supabase.co`;
  const production = base.hostname === `${projects.production}.supabase.co`;
  if (base.protocol !== "https:" || (!development && !production) || base.username || base.password || base.port ||
      !environment.anonKey || environment.dispatchSecret.length < 48 || target.protocol !== "https:" ||
      target.username || target.password || target.port || target.search || target.hash ||
      target.pathname !== "/api/internal/document-ocr/run" ||
      (production ? target.hostname !== "aaed-2.vercel.app" : !previewHost.test(target.hostname))) {
    throw new Error("DOCUMENT_DISPATCH_CONFIGURATION_INVALID");
  }
  const fetcher = environment.fetcher ?? fetch;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const allowedOrigin = !origin || origin === "https://aaed-2.vercel.app" || origin === "https://alwafa.site" ||
      origin === "https://www.alwafa.site" || (() => {
        try {
          const value = new URL(origin);
          return development && ((value.protocol === "https:" && previewHost.test(value.hostname) && !value.port) ||
            (value.protocol === "http:" && ["localhost", "127.0.0.1"].includes(value.hostname)));
        } catch { return false; }
      })();
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
    if (origin && allowedOrigin) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (code: string, status: number) => Response.json({ code }, { status, headers });
    if (!allowedOrigin) return reply("DOCUMENT_ACCESS_DENIED", 403);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...headers,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version" } });
    }
    if (request.method !== "POST") return reply("DOCUMENT_DISPATCH_METHOD_INVALID", 405);
    const authorization = request.headers.get("Authorization") ?? "";
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) return reply("DOCUMENT_ACCESS_DENIED", 401);
    let payload: unknown;
    try { payload = await smallJson(request); } catch { return reply("DOCUMENT_DISPATCH_BODY_INVALID", 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 ||
        !("extraction_id" in payload) || typeof payload.extraction_id !== "string" || !uuid.test(payload.extraction_id)) {
      return reply("DOCUMENT_DISPATCH_BODY_INVALID", 400);
    }
    try {
      const userHeaders = { apikey: environment.anonKey, Authorization: authorization };
      const userResponse = await fetcher(new URL("/auth/v1/user", base), {
        headers: userHeaders, redirect: "manual", signal: AbortSignal.timeout(5000),
      });
      if (userResponse.status !== 200) return reply("DOCUMENT_ACCESS_DENIED", 401);
      const user = await userResponse.json();
      if (!user || typeof user.id !== "string" || !uuid.test(user.id)) return reply("DOCUMENT_ACCESS_DENIED", 401);
      const rowUrl = new URL("/rest/v1/document_extractions", base);
      rowUrl.search = new URLSearchParams({ select: "id,tenant_id,status,engine_version", id: `eq.${payload.extraction_id}`, limit: "1" }).toString();
      // Caller-scoped RLS enforces active membership, tenant and document scope.
      const rowResponse = await fetcher(rowUrl, { headers: userHeaders, redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (rowResponse.status !== 200) return reply("DOCUMENT_ACCESS_DENIED", 403);
      const rows = await rowResponse.json();
      const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      if (!row || row.id !== payload.extraction_id || typeof row.tenant_id !== "string" || !uuid.test(row.tenant_id)) {
        return reply("DOCUMENT_ACCESS_DENIED", 404);
      }
      if (!workerVersions.has(row.engine_version)) return reply("DOCUMENT_WORKER_VERSION_UNSUPPORTED", 409);
      if (finished.has(row.status)) return reply("DOCUMENT_DISPATCH_NOT_REQUIRED", 200);
      if (row.status === "processing") return reply("DOCUMENT_DISPATCH_ALREADY_PROCESSING", 202);
      if (!["queued", "retryable_failed"].includes(row.status)) return reply("DOCUMENT_DISPATCH_NOT_REQUIRED", 409);
      // This calls the short Vercel dispatcher, not the long OCR invocation.
      // The dispatcher uses Vercel waitUntil; cron rescues a lost wakeup.
      const dispatched = await fetcher(target, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${environment.dispatchSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ extraction_id: row.id }) });
      if (dispatched.status !== 202) return reply("DOCUMENT_DISPATCH_UNAVAILABLE", 503);
      return reply("DOCUMENT_DISPATCH_ACCEPTED", 202);
    } catch { return reply("DOCUMENT_DISPATCH_UNAVAILABLE", 503); }
  };
}
