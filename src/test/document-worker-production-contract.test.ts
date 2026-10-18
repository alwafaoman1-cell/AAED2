import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isDocumentEngineEnabled, isDocumentWorkerEnabled } from "@/lib/documentExtraction/config";
import { createDocumentDownloadHandler } from "../../supabase/functions/document-worker-download/handler";

afterEach(() => vi.unstubAllEnvs());

describe("project-bound OCR rollout", () => {
  it("packages Linux libraries required by the Paddle/OpenCV worker", () => {
    const dockerfile = readFileSync(new URL("../../services/document-ocr/Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toMatch(/\blibgl1\b/);
    expect(dockerfile).toContain("USER worker");
    expect(dockerfile).toContain("warm_english_model");
  });

  it("keeps both switches off and rejects mismatched projects", () => {
    vi.stubEnv("VITE_DOCUMENT_ENGINE_ENABLED", "true");
    vi.stubEnv("VITE_DOCUMENT_WORKER_ENABLED", "true");
    vi.stubEnv("VITE_SUPABASE_URL", "https://rrhyglrnlveygyiandhs.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PROJECT_ID", "ifnfwssdtjuzdtshnrht");
    expect(isDocumentEngineEnabled()).toBe(false);
    expect(isDocumentWorkerEnabled()).toBe(false);
    vi.stubEnv("VITE_SUPABASE_URL", "https://ifnfwssdtjuzdtshnrht.supabase.co");
    expect(isDocumentWorkerEnabled()).toBe(true);
    vi.stubEnv("VITE_DOCUMENT_WORKER_ENABLED", "false");
    expect(isDocumentWorkerEnabled()).toBe(false);
  });

  it("serves only a matching active lease and scoped object", async () => {
    const tenant = "00000000-0000-4000-8000-000000005741";
    const extractionId = "00000000-0000-4000-8000-000000005742";
    const lease = "00000000-0000-4000-8000-000000005743";
    const fileId = "00000000-0000-4000-8000-000000005744";
    const sha256 = "a".repeat(64);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/document_extractions")) return Response.json([{ id: extractionId, tenant_id: tenant,
        file_id: fileId, status: "processing", lease_token: lease, engine_version: "1.0.1-worker" }]);
      if (url.pathname.endsWith("/document_files")) return Response.json([{ id: fileId, tenant_id: tenant,
        storage_bucket: "temo-documents", storage_path: `${tenant}/operational/${sha256}.pdf`, sha256,
        byte_size: 8, mime_type: "application/pdf" }]);
      return new Response("%PDF-1.7", { status: 200 });
    });
    const handler = createDocumentDownloadHandler({ url: "https://rrhyglrnlveygyiandhs.supabase.co",
      serviceKey: "server-only", workerSecret: "s".repeat(64), fetcher: fetcher as typeof fetch });
    const makeRequest = (token: string, leaseToken = lease) => new Request("https://example.invalid", { method: "POST",
      headers: { "X-Worker-Secret": token }, body: JSON.stringify({ extraction_id: extractionId, tenant_id: tenant, lease_token: leaseToken }) });
    expect((await handler(makeRequest("invalid"))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await handler(makeRequest("s".repeat(64)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("%PDF-1.7");
    expect(response.headers.get("cache-control")).toContain("no-store");
    fetcher.mockClear();
    expect((await handler(makeRequest("s".repeat(64), "00000000-0000-4000-8000-000000005745"))).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
