import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isDocumentEngineEnabled, isDocumentWorkerEnabled } from "@/lib/documentExtraction/config";
import { DOCUMENT_ENGINE_VERSION } from "@/lib/documentExtraction/types";
import { createDocumentDownloadHandler } from "../../supabase/functions/document-worker-download/handler";

afterEach(() => vi.unstubAllEnvs());

describe("project-bound OCR rollout", () => {
  it("keeps the OCR revision scoped to an immutable version across queue and RLS", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261018110000_document_worker_ocr_coverage_revision.sql", import.meta.url), "utf8");
    expect(DOCUMENT_ENGINE_VERSION).toBe("1.0.2");
    expect(sql).toContain("document_worker_file_read");
    expect(sql).toContain("document_worker_extraction_update");
    expect(sql).toContain("document_worker_page_insert");
    expect(sql).toContain("document_worker_write_guard()");
    expect(sql).toContain("document_enqueue_processing(p_file_id uuid, p_engine_version text)");
    expect(sql.match(/'1\.0\.2-worker'/g)?.length).toBeGreaterThanOrEqual(7);
    expect(sql).not.toMatch(/\b(create|drop|truncate)\s+table\b/i);
  });

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
    let engineVersion = `${DOCUMENT_ENGINE_VERSION}-worker`;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/document_extractions")) return Response.json([{ id: extractionId, tenant_id: tenant,
        file_id: fileId, status: "processing", lease_token: lease, engine_version: engineVersion }]);
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
    engineVersion = "1.0.0-worker";
    expect((await handler(makeRequest("s".repeat(64)))).status).toBe(200);
    engineVersion = "1.0.3-worker";
    expect((await handler(makeRequest("s".repeat(64)))).status).toBe(403);
    fetcher.mockClear();
    expect((await handler(makeRequest("s".repeat(64), "00000000-0000-4000-8000-000000005745"))).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
