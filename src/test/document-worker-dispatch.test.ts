import { describe, expect, it, vi } from "vitest";
import { createDocumentDispatchHandler } from "../../supabase/functions/document-worker-dispatch/handler";

const extraction = "00000000-0000-4000-8000-000000005741";
const tenant = "00000000-0000-4000-8000-000000005742";
const user = "00000000-0000-4000-8000-000000005743";
const token = "user-jwt";
const secret = "s".repeat(64);
const target = "https://aaed-2-candidate-alwafaoman1-cells-projects.vercel.app/api/internal/document-ocr/run";
const request = (body: unknown = { extraction_id: extraction }, headers: Record<string, string> = {}) =>
  new Request("https://rrhyglrnlveygyiandhs.supabase.co/functions/v1/document-worker-dispatch", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost:5173", ...headers },
  });

function setup(options: { rows?: unknown; authStatus?: number; restStatus?: number; dispatchStatus?: number; status?: string } = {}) {
  const row = { id: extraction, tenant_id: tenant, engine_version: "1.0.8-en-worker", status: options.status ?? "queued" };
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const address = new URL(String(url));
    if (address.pathname === "/auth/v1/user") return Response.json({ id: user }, { status: options.authStatus ?? 200 });
    if (address.pathname === "/rest/v1/document_extractions") return Response.json(options.rows ?? [row], { status: options.restStatus ?? 200 });
    expect(String(url)).toBe(target);
    expect(init?.redirect).toBe("manual");
    return Response.json({ code: "ACCEPTED" }, { status: options.dispatchStatus ?? 202 });
  });
  return { fetcher, handler: createDocumentDispatchHandler({ url: "https://rrhyglrnlveygyiandhs.supabase.co",
    anonKey: "anon-not-service-role", dispatchUrl: target, dispatchSecret: secret, fetcher: fetcher as typeof fetch }) };
}

describe("OCR wakeup authenticates the caller and enforces its RLS before dispatch", () => {
  it("dispatches only a scoped UUID, without forwarding the customer JWT or tenant", async () => {
    const { handler, fetcher } = setup();
    const response = await handler(request());
    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result).toEqual({ code: "DOCUMENT_DISPATCH_ACCEPTED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls.slice(0, 2)) {
      expect(init?.headers).toEqual({ apikey: "anon-not-service-role", Authorization: `Bearer ${token}` });
    }
    const lookup = new URL(String(fetcher.mock.calls[1][0]));
    expect(lookup.searchParams.get("id")).toBe(`eq.${extraction}`);
    expect(lookup.searchParams.get("select")).toBe("id,tenant_id,status,engine_version");
    expect(fetcher.mock.calls[2][1]?.body).toBe(JSON.stringify({ extraction_id: extraction }));
    expect(fetcher.mock.calls[2][1]?.headers).toEqual({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });
    expect(JSON.stringify(result).includes(tenant)).toBe(false);
  });

  it("rejects an invalid/expired user token before reading any extraction", async () => {
    const { handler, fetcher } = setup({ authStatus: 401 });
    expect((await handler(request())).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{ rows: [] }, { rows: [{ id: user, tenant_id: tenant, status: "queued", engine_version: "1.0.8-en-worker" }] }])(
    "does not wake an inaccessible tenant, disabled membership or mismatched extraction", async ({ rows }) => {
      const { handler, fetcher } = setup({ rows });
      expect((await handler(request())).status).toBe(404);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

  it("rejects RLS request failures instead of using a service role", async () => {
    const { handler, fetcher } = setup({ restStatus: 403 });
    expect((await handler(request())).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["extracted", "needs_review", "verified", "failed", "processing"])("does not redispatch %s evidence", async status => {
    const { handler, fetcher } = setup({ status });
    expect((await handler(request())).status).toBe(status === "processing" ? 202 : 200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { extraction_id: "not-a-uuid" }, { extraction_id: extraction, tenant_id: tenant },
    { extraction_id: extraction, url: "http://attacker.invalid" }, "x".repeat(513)])("rejects malformed or expanded inputs before any upstream call", async body => {
    const { handler, fetcher } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not trust a browser's Origin or absent bearer", async () => {
    const { handler, fetcher } = setup();
    expect((await handler(request(undefined, { Origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await handler(request(undefined, { Authorization: "" }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([200, 401, 302, 500])("reports unavailable for dispatch HTTP %s without pretending extraction succeeded", async dispatchStatus => {
    const { handler } = setup({ dispatchStatus });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "DOCUMENT_DISPATCH_UNAVAILABLE" });
  });

  it("fails closed on a Production/Preview mismatch or arbitrary target", () => {
    const env = { url: "https://ifnfwssdtjuzdtshnrht.supabase.co", anonKey: "anon", dispatchUrl: target, dispatchSecret: secret };
    expect(() => createDocumentDispatchHandler(env)).toThrow("DOCUMENT_DISPATCH_CONFIGURATION_INVALID");
    expect(() => createDocumentDispatchHandler({ ...env, dispatchUrl: "https://aaed-2.vercel.app/api/internal/document-ocr/run" })).not.toThrow();
    expect(() => createDocumentDispatchHandler({ ...env, dispatchUrl: "https://attacker.invalid/api/internal/document-ocr/run" })).toThrow();
  });

  it("supports browser preflight without bypassing authentication on POST", async () => {
    const { handler, fetcher } = setup();
    const response = await handler(new Request("https://example.invalid", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
