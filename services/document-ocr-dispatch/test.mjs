import assert from "node:assert/strict";
import test from "node:test";

test("native Hono entrypoint registers the real Vercel waitUntil lifecycle", async () => {
  const contextKey = Symbol.for("@vercel/request-context");
  const previousContext = globalThis[contextKey];
  const previousFetch = globalThis.fetch;
  const names = ["OCR_INTERNAL_URL", "TEMO_OCR_DISPATCH_SECRET", "TEMO_DOCUMENT_DOWNLOAD_SECRET", "CRON_SECRET"];
  const previousEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const tracked = [];
  const forwarded = [];
  let complete;
  try {
    process.env.OCR_INTERNAL_URL = "https://private.example/service-root/";
    process.env.TEMO_OCR_DISPATCH_SECRET = "dispatch-" + "d".repeat(56);
    process.env.TEMO_DOCUMENT_DOWNLOAD_SECRET = "download-" + "x".repeat(56);
    process.env.CRON_SECRET = "cron-" + "c".repeat(56);
    globalThis[contextKey] = { get: () => ({ waitUntil: (promise) => { tracked.push(promise); } }) };
    globalThis.fetch = (url, init) => {
      forwarded.push({ url: String(url), init });
      return new Promise((resolve) => { complete = resolve; });
    };
    const { default: app } = await import("./index.ts");
    const response = await app.request("https://public.example/api/internal/document-ocr/run", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.TEMO_OCR_DISPATCH_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ extraction_id: "12345678-1234-4abc-8def-123456789abc" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(tracked.length, 1);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].url, "https://private.example/service-root/api/internal/document-ocr/run");
    assert.equal(forwarded[0].init.redirect, "error");
    complete(new Response(null, { status: 204 }));
    await Promise.all(tracked);
    assert.equal((await app.request("https://public.example/healthz")).status, 404);
  } finally {
    complete?.(new Response(null, { status: 204 }));
    await Promise.all(tracked);
    globalThis.fetch = previousFetch;
    if (previousContext === undefined) delete globalThis[contextKey];
    else globalThis[contextKey] = previousContext;
    for (const name of names) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
});
