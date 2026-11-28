import { timingSafeEqual } from "node:crypto";

export const RUN_PATH = "/api/internal/document-ocr/run";
export const SWEEP_PATH = "/api/internal/document-ocr/sweep";
export const MAX_BODY_BYTES = 512;
export const FORWARD_TIMEOUT_MS = 350_000;

export type DispatchEnv = {
  OCR_INTERNAL_URL?: string;
  TEMO_OCR_DISPATCH_SECRET?: string;
  TEMO_DOCUMENT_DOWNLOAD_SECRET?: string;
  CRON_SECRET?: string;
};

export type DispatchEvent = {
  event: "ocr_dispatch_background_failed";
  action: "run" | "sweep";
  reason: "timeout" | "network" | "upstream_http";
  status?: number;
};

type Dependencies = {
  env: DispatchEnv | (() => DispatchEnv);
  fetcher: typeof fetch;
  schedule: (promise: Promise<void>) => void;
  log?: (event: DispatchEvent) => void;
};

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// A single literal field also rejects duplicate keys, escaped keys and extra metadata.
const RUN_BODY = new RegExp(`^[\\x20\\t\\r\\n]*\\{[\\x20\\t\\r\\n]*"extraction_id"[\\x20\\t\\r\\n]*:[\\x20\\t\\r\\n]*"(${UUID})"[\\x20\\t\\r\\n]*\\}[\\x20\\t\\r\\n]*$`);

function json(status: number, body: Record<string, string | boolean>, allow?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(allow ? { allow } : {}),
    },
  });
}

function headerSecret(value: string | undefined, minimumLength = 1): value is string {
  return typeof value === "string" && value.length >= minimumLength && /^[\x21-\x7e]+$/.test(value);
}

function authorized(request: Request, secret: string): boolean {
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function internalBase(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

async function extractionBody(request: Request): Promise<string | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    if (length !== null && Number(length) !== bytes) return null;
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const match = RUN_BODY.exec(new TextDecoder("utf-8", { fatal: true }).decode(combined));
    return match ? JSON.stringify({ extraction_id: match[1].toLowerCase() }) : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function createDispatchHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const log = (event: DispatchEvent) => {
    // Diagnostics must never affect dispatch or contain a job, tenant, lease or credential.
    try { dependencies.log?.(event); } catch { /* Logging is best effort. */ }
  };

  return async (request) => {
    const path = new URL(request.url).pathname;
    const action = path === RUN_PATH ? "run" : path === SWEEP_PATH ? "sweep" : null;
    if (!action) return json(404, { error: "not_found" });
    const method = action === "run" ? "POST" : "GET";
    if (request.method !== method) return json(405, { error: "method_not_allowed" }, method);

    const env = typeof dependencies.env === "function" ? dependencies.env() : dependencies.env;
    const base = internalBase(env.OCR_INTERNAL_URL);
    const dispatchSecret = env.TEMO_OCR_DISPATCH_SECRET;
    const secret = action === "run" ? dispatchSecret : env.CRON_SECRET;
    if (!base || !headerSecret(dispatchSecret, 48) || !headerSecret(secret)
      || dispatchSecret === env.TEMO_DOCUMENT_DOWNLOAD_SECRET) {
      return json(503, { error: "unavailable" });
    }
    if (!authorized(request, secret)) return json(401, { error: "unauthorized" });

    const body = action === "run" ? await extractionBody(request) : undefined;
    if (action === "run" && body === null) return json(400, { error: "invalid_request" });
    if (action === "sweep" && (request.body !== null || request.headers.has("transfer-encoding")
      || (request.headers.has("content-length") && request.headers.get("content-length") !== "0"))) {
      return json(400, { error: "invalid_request" });
    }

    // Do not inherit the caller's abort signal: the Edge caller may finish immediately.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FORWARD_TIMEOUT_MS);
    const background = (async () => {
      try {
        const bindingBase = new URL(base);
        bindingBase.pathname = `${bindingBase.pathname.replace(/\/$/, "")}/`;
        const response = await dependencies.fetcher(new URL(path.slice(1), bindingBase), {
          method,
          headers: {
            authorization: `Bearer ${secret}`,
            ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}),
          },
          ...(body ? { body } : {}),
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) log({ event: "ocr_dispatch_background_failed", action, reason: "upstream_http", status: response.status });
        await response.body?.cancel();
      } catch {
        log({ event: "ocr_dispatch_background_failed", action, reason: timedOut ? "timeout" : "network" });
      } finally {
        clearTimeout(timer);
      }
    })();

    try {
      dependencies.schedule(background);
    } catch {
      controller.abort();
      clearTimeout(timer);
      return json(503, { error: "unavailable" });
    }
    // Acceptance is not extraction, lease acquisition or persistence. Cron/DB retry recover failures.
    return json(202, { accepted: true });
  };
}
