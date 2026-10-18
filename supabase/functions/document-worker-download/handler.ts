/** Narrow storage bridge: only the holder of an active database lease can read its file. */
type Environment = {
  url: string;
  serviceKey: string;
  workerSecret: string;
  fetcher?: typeof fetch;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const maxBytes = 12 * 1024 * 1024;
const forbidden = () => new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

async function equalSecrets(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))));
  let difference = left.length ^ right.length;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function createDocumentDownloadHandler(environment: Environment) {
  const fetcher = environment.fetcher ?? fetch;
  const base = new URL(environment.url);
  if (base.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname) ||
      !environment.serviceKey || environment.workerSecret.length < 48) {
    throw new Error("DOCUMENT_WORKER_DOWNLOAD_CONFIGURATION_INVALID");
  }
  const headers = { apikey: environment.serviceKey, Authorization: `Bearer ${environment.serviceKey}` };
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || !(await equalSecrets(request.headers.get("X-Worker-Secret") ?? "", environment.workerSecret))) {
      return forbidden();
    }
    let payload: { extraction_id?: unknown; tenant_id?: unknown; lease_token?: unknown };
    try {
      const body = await request.text();
      if (body.length > 512) return forbidden();
      payload = JSON.parse(body);
    } catch { return forbidden(); }
    const { extraction_id: id, tenant_id: tenantId, lease_token: lease } = payload;
    if (typeof id !== "string" || typeof tenantId !== "string" || typeof lease !== "string" ||
        !uuid.test(id) || !uuid.test(tenantId) || !uuid.test(lease)) return forbidden();
    try {
      const extractionUrl = new URL("/rest/v1/document_extractions", base);
      extractionUrl.search = new URLSearchParams({
        select: "id,tenant_id,file_id,status,lease_token,engine_version",
        id: `eq.${id}`, tenant_id: `eq.${tenantId}`, status: "eq.processing", lease_token: `eq.${lease}`,
        limit: "1",
      }).toString();
      const extractionResponse = await fetcher(extractionUrl, { headers, redirect: "manual" });
      if (!extractionResponse.ok) return forbidden();
      const [extraction] = await extractionResponse.json() as Array<Record<string, unknown>>;
      if (!extraction || extraction.id !== id || extraction.tenant_id !== tenantId ||
          extraction.lease_token !== lease || extraction.status !== "processing" ||
          !["1.0.0-worker", "1.0.1-worker"].includes(String(extraction.engine_version)) ||
          typeof extraction.file_id !== "string" || !uuid.test(extraction.file_id)) return forbidden();

      const fileUrl = new URL("/rest/v1/document_files", base);
      fileUrl.search = new URLSearchParams({
        select: "id,tenant_id,storage_bucket,storage_path,sha256,mime_type,byte_size",
        id: `eq.${extraction.file_id}`, tenant_id: `eq.${tenantId}`, limit: "1",
      }).toString();
      const fileResponse = await fetcher(fileUrl, { headers, redirect: "manual" });
      if (!fileResponse.ok) return forbidden();
      const [file] = await fileResponse.json() as Array<Record<string, unknown>>;
      if (!file || file.tenant_id !== tenantId || file.id !== extraction.file_id ||
          file.storage_bucket !== "temo-documents" || typeof file.sha256 !== "string" || !hash.test(file.sha256) ||
          !Number.isInteger(file.byte_size) || Number(file.byte_size) < 1 || Number(file.byte_size) > maxBytes ||
          typeof file.storage_path !== "string" ||
          !new RegExp(`^${tenantId}/(operational|finance|restricted)/${file.sha256}\\.(pdf|jpg|png|webp)$`).test(file.storage_path)) return forbidden();

      const objectUrl = new URL(`/storage/v1/object/authenticated/temo-documents/${file.storage_path.split("/").map(encodeURIComponent).join("/")}`, base);
      const objectResponse = await fetcher(objectUrl, { headers, redirect: "manual" });
      if (!objectResponse.ok || objectResponse.status !== 200 || !objectResponse.body) return forbidden();
      const contentLength = Number(objectResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) return forbidden();
      return new Response(objectResponse.body, {
        status: 200,
        headers: { "Content-Type": String(file.mime_type), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return forbidden();
    }
  };
}
