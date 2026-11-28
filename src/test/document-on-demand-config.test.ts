import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = { source: string; destination: string | { service: string } };
type FunctionOptions = { maxDuration?: number; maxConcurrency?: number; regions?: string[]; memory?: number };
type Service = {
  root: string;
  framework?: string;
  runtime?: string;
  entrypoint?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rewrites?: Rewrite[];
  functions?: Record<string, FunctionOptions>;
  bindings?: Array<{ type: string; service: string; env: string; format: string }>;
};

const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  services: Record<string, Service>;
  rewrites: Rewrite[];
  crons: Array<{ path: string; schedule: string }>;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  git: { deploymentEnabled: Record<string, boolean> };
  build: { env: Record<string, string> };
  daemons?: unknown;
  functions?: unknown;
};

function matches(rule: Rewrite, path: string): boolean {
  return new RegExp(`^${rule.source}$`).test(path);
}

function serviceFor(path: string): string | undefined {
  const destination = config.rewrites.find((rule) => matches(rule, path))?.destination;
  return typeof destination === "object" ? destination.service : undefined;
}

describe("on-demand OCR deployment contract", () => {
  it("routes internal OCR requests before the SPA and keeps the original handler prefix", () => {
    expect(serviceFor("/api/internal/document-ocr/run")).toBe("ocr-dispatch");
    expect(serviceFor("/api/internal/document-ocr/sweep")).toBe("ocr-dispatch");
    expect(serviceFor("/api/internal/document-ocr/not-a-handler")).toBe("ocr-dispatch");
    expect(config.rewrites[0].destination).toEqual({ service: "ocr-dispatch" });
    expect(config.rewrites[0].destination).not.toHaveProperty("path");
    expect(config.services.ocr.rewrites).toBeUndefined();
    expect(config.rewrites.some((rule) => typeof rule.destination === "object" && rule.destination.service === "ocr")).toBe(false);
    expect(serviceFor("/customer/vehicle")).toBe("frontend");
    expect(serviceFor("/vehicle-entry/visits/example")).toBe("frontend");
  });

  it("preserves SPA deep links without rewriting static assets to HTML", () => {
    const frontend = config.services.frontend;
    expect(frontend).toMatchObject({ root: ".", framework: "vite", buildCommand: "npm run build", outputDirectory: "dist" });
    const rewrites = frontend.rewrites ?? [];
    for (const path of ["/", "/customer/vehicle", "/insurance/claims/example"]) {
      expect(rewrites.find((rule) => matches(rule, path))?.destination).toBe("/index.html");
    }
    for (const path of ["/assets/app.js", "/assets/missing.js", "/sw.js", "/workbox-runtime.js", "/manifest.json", "/icon-192.png"]) {
      expect(serviceFor(path)).toBe("frontend");
      expect(rewrites.some((rule) => matches(rule, path))).toBe(false);
    }
  });

  it("bounds one container instance and pins its region without a Fluid memory override", () => {
    const ocr = config.services.ocr;
    expect(ocr).toMatchObject({ root: "services/document-ocr", runtime: "container", entrypoint: "Dockerfile.http" });
    expect(ocr.functions?.["**"]).toMatchObject({ maxDuration: 360, maxConcurrency: 1, regions: ["syd1"] });
    expect(ocr.functions?.["**"]).not.toHaveProperty("memory");
    expect(config.functions).toBeUndefined();
    expect(config.daemons).toBeUndefined();
  });

  it("uses a native Node dispatcher with an authenticated private OCR service binding", () => {
    const dispatcher = config.services["ocr-dispatch"];
    expect(dispatcher).toMatchObject({ root: "services/document-ocr-dispatch", framework: "hono", runtime: "nodejs24.x", entrypoint: "index.ts" });
    expect(dispatcher.bindings).toEqual([{ type: "service", service: "ocr", env: "OCR_INTERNAL_URL", format: "url" }]);
    expect(dispatcher.functions?.["**"]).toEqual({ maxDuration: 360, maxConcurrency: 1, regions: ["syd1"] });
    expect(dispatcher.functions?.["**"]).not.toHaveProperty("memory");
    const servicePackage = JSON.parse(readFileSync(new URL("../../services/document-ocr-dispatch/package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../../services/document-ocr-dispatch/package-lock.json", import.meta.url), "utf8"));
    expect(servicePackage.dependencies).toEqual({ "@vercel/functions": "3.12.0", hono: "4.13.23" });
    expect(lock.packages[""].dependencies).toEqual(servicePackage.dependencies);
    expect(lock.packages["node_modules/@vercel/functions"].version).toBe("3.12.0");
    expect(lock.packages["node_modules/hono"].version).toBe("4.13.23");
  });

  it("schedules the authenticated recovery handler and keeps branch auto-deployment disabled", () => {
    expect(config.crons).toEqual([{ path: "/api/internal/document-ocr/sweep", schedule: "* * * * *" }]);
    expect(serviceFor(config.crons[0].path)).toBe("ocr-dispatch");
    expect(config.git.deploymentEnabled["codex/finance-security-development"]).toBe(false);
    expect(config.build.env).toMatchObject({ VITE_ACCOUNTING_SETUP_ENABLED: "true", VITE_ACCOUNTING_REPORTS_ENABLED: "true" });
  });

  it("retains browser security headers and no-cache behavior for the app shell and service worker", () => {
    const globalHeaders = config.headers.find((rule) => rule.source === "/(.*)")?.headers ?? [];
    expect(globalHeaders).toEqual(expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
    ]));
    for (const path of ["/", "/index.html", "/sw.js", "/workbox-:path*", "/manifest.json"]) {
      const headers = config.headers.find((rule) => rule.source === path)?.headers ?? [];
      expect(headers.some((header) => header.key === "Cache-Control" && header.value.includes("no-cache"))).toBe(true);
    }
    expect(config.headers.find((rule) => rule.source === "/sw.js")?.headers).toContainEqual({ key: "Service-Worker-Allowed", value: "/" });
  });
});
