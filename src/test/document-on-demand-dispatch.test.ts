import { afterEach, describe, expect, it, vi } from "vitest";
import { createDispatchHandler, FORWARD_TIMEOUT_MS, RUN_PATH, SWEEP_PATH, type DispatchEnv } from "../../services/document-ocr-dispatch/handler";

const dispatchSecret = "dispatch-" + "d".repeat(56);
const cronSecret = "cron-" + "c".repeat(56);
const id = "12345678-1234-4ABC-8DEF-123456789ABC";
const validEnv: DispatchEnv = {
  OCR_INTERNAL_URL: "https://private-ocr.internal/",
  TEMO_OCR_DISPATCH_SECRET: dispatchSecret,
  TEMO_DOCUMENT_DOWNLOAD_SECRET: "download-" + "x".repeat(56),
  CRON_SECRET: cronSecret,
};

function runRequest(body = JSON.stringify({ extraction_id: id }), headers: Record<string, string> = {}): Request {
  return new Request(`https://public.example${RUN_PATH}`, {
    method: "POST", body,
    headers: { authorization: `Bearer ${dispatchSecret}`, "content-type": "application/json", ...headers },
  });
}

function fixture(options: { env?: DispatchEnv; fetcher?: typeof fetch; schedule?: (promise: Promise<void>) => void } = {}) {
  const pending: Promise<void>[] = [];
  const fetcher = vi.fn<typeof fetch>(options.fetcher ?? (async () => new Response(null, { status: 204 })));
  const log = vi.fn();
  const schedule = vi.fn(options.schedule ?? ((promise: Promise<void>) => { pending.push(promise); }));
  const handler = createDispatchHandler({ env: options.env ?? validEnv, fetcher, schedule, log });
  return { handler, fetcher, schedule, log, pending };
}

afterEach(() => vi.useRealTimers());

describe("on-demand OCR dispatch transport", () => {
  it("accepts before OCR finishes and tracks the private request independently of the caller", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const { handler, schedule, pending } = fixture({ fetcher });
    const caller = new AbortController();
    const request = new Request(runRequest(), { signal: caller.signal });
    const response = await handler(request);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(schedule).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://private-ocr.internal${RUN_PATH}`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ extraction_id: id.toLowerCase() }) });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${dispatchSecret}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(Number(headers.get("content-length"))).toBe(Buffer.byteLength(String(init?.body)));
    caller.abort();
    expect(init?.signal?.aborted).toBe(false);
    finish(new Response(null, { status: 204 }));
    await Promise.all(pending);
  });

  it("tracks an authenticated cron sweep without a document payload", async () => {
    const { handler, fetcher, pending } = fixture();
    const response = await handler(new Request(`https://public.example${SWEEP_PATH}`, { headers: { authorization: `Bearer ${cronSecret}` } }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(fetcher).toHaveBeenCalledWith(new URL(`https://private-ocr.internal${SWEEP_PATH}`), expect.objectContaining({
      method: "GET", headers: { authorization: `Bearer ${cronSecret}` }, redirect: "error",
    }));
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
    await Promise.all(pending);
  });

  it("preserves the generated service binding's base path", async () => {
    const { handler, fetcher, pending } = fixture({ env: { ...validEnv, OCR_INTERNAL_URL: "https://private-ocr.internal/private-service/" } });
    expect((await handler(runRequest())).status).toBe(202);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://private-ocr.internal/private-service${RUN_PATH}`);
    await Promise.all(pending);
  });

  it.each([undefined, "Bearer wrong", `bearer ${dispatchSecret}`, `Bearer ${dispatchSecret}, Bearer ${dispatchSecret}`])("rejects incorrect authorization before scheduling (%s)", async (authorization) => {
    const { handler, fetcher, schedule } = fixture();
    const request = runRequest();
    if (authorization === undefined) request.headers.delete("authorization");
    else request.headers.set("authorization", authorization);
    expect((await handler(request)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it.each([
    { OCR_INTERNAL_URL: undefined },
    { OCR_INTERNAL_URL: "file:///private" },
    { OCR_INTERNAL_URL: "https://user:password@private.example" },
    { TEMO_OCR_DISPATCH_SECRET: "short" },
    { TEMO_DOCUMENT_DOWNLOAD_SECRET: dispatchSecret },
  ])("fails closed when service configuration is invalid (%j)", async (override) => {
    const { handler, fetcher, schedule } = fixture({ env: { ...validEnv, ...override } });
    expect((await handler(runRequest())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("requires the cron credential and valid dispatcher configuration for sweeps", async () => {
    const { handler, fetcher } = fixture();
    expect((await handler(new Request(`https://public.example${SWEEP_PATH}`, { headers: { authorization: `Bearer ${dispatchSecret}` } }))).status).toBe(401);
    const missingCron = fixture({ env: { ...validEnv, CRON_SECRET: undefined } });
    expect((await missingCron.handler(new Request(`https://public.example${SWEEP_PATH}`))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(missingCron.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "{}", "[]", "null", `{"extraction_id":"${id}","tenant_id":"tenant"}`,
    `{"extraction_id":"${id}","extraction_id":"${id}"}`,
    `{"extraction_id":"${id}","url":"https://attacker.example"}`,
    '{"extraction_id":"not-a-uuid"}', `{"extraction_id":"${id}"}garbage`,
    `{"extraction_id":"${id}","lease_token":"private"}`,
  ])("rejects malformed or extra job metadata (%s)", async (body) => {
    const { handler, fetcher, schedule } = fixture();
    expect((await handler(runRequest(body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("enforces JSON MIME, framing and the byte limit even without Content-Length", async () => {
    const { handler, fetcher } = fixture();
    for (const request of [
      runRequest(undefined, { "content-type": "text/plain" }),
      runRequest(undefined, { "content-length": "513" }),
      runRequest(undefined, { "content-length": "1" }),
      runRequest(undefined, { "content-length": "5, 5" }),
      runRequest(" ".repeat(513)),
      runRequest("é".repeat(257)),
    ]) expect((await handler(request)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a whitespace-formatted single UUID and forwards no caller query or headers", async () => {
    const { handler, fetcher, pending } = fixture();
    const source = runRequest(` \n { "extraction_id" : "${id}" }\t`, { "x-tenant-id": "private", "x-forwarded-host": "attacker.example" });
    const request = new Request(`https://public.example${RUN_PATH}?url=https://attacker.example`, source);
    expect((await handler(request)).status).toBe(202);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://private-ocr.internal${RUN_PATH}`);
    expect(new Headers(init?.headers).has("x-tenant-id")).toBe(false);
    expect(new Headers(init?.headers).has("x-forwarded-host")).toBe(false);
    await Promise.all(pending);
  });

  it("rejects unsupported methods, unknown paths and a framed cron body", async () => {
    const { handler, fetcher } = fixture();
    const wrongMethod = await handler(new Request(`https://public.example${RUN_PATH}`));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect((await handler(new Request("https://public.example/healthz"))).status).toBe(404);
    expect((await handler(new Request(`https://public.example${SWEEP_PATH}`, { headers: { authorization: `Bearer ${cronSecret}`, "content-length": "1" } }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["http", "network"])("settles tracked upstream failures without exposing response or error data (%s)", async (kind) => {
    const sensitive = `tenant job lease ${dispatchSecret}`;
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (kind === "network") throw new Error(sensitive);
      return new Response(sensitive, { status: 500 });
    });
    const { handler, pending, log } = fixture({ fetcher });
    const response = await handler(runRequest());
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('{"accepted":true}');
    await Promise.all(pending);
    expect(log).toHaveBeenCalledWith({ event: "ocr_dispatch_background_failed", action: "run", reason: kind === "http" ? "upstream_http" : "network", ...(kind === "http" ? { status: 500 } : {}) });
    expect(JSON.stringify(log.mock.calls)).not.toContain(sensitive);
  });

  it("aborts a tracked call before the parent function deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("sensitive abort detail")), { once: true });
    }));
    const { handler, pending, log } = fixture({ fetcher });
    expect((await handler(runRequest())).status).toBe(202);
    await vi.advanceTimersByTimeAsync(FORWARD_TIMEOUT_MS);
    await Promise.all(pending);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith({ event: "ocr_dispatch_background_failed", action: "run", reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not acknowledge a dispatch when the platform lifecycle cannot be registered", async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const { handler } = fixture({ fetcher, schedule: () => { throw new Error("unavailable"); } });
    expect((await handler(runRequest())).status).toBe(503);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
