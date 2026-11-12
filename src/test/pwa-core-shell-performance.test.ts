import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock("vite", () => ({ defineConfig: (config: unknown) => config }));
vi.mock("@vitejs/plugin-react-swc", () => ({ default: () => ({ name: "react-stub" }) }));
vi.mock("lovable-tagger", () => ({ componentTagger: () => ({ name: "tagger-stub" }) }));
vi.mock("vite-plugin-pwa", () => ({ VitePWA: (options: Record<string, unknown>) => { runtime.options = options; return []; } }));
import configFactory from "../../vite.config";

type Entry = { url: string; revision: string; size: number };
type Match = (context: { url: URL; request: { mode: string }; sameOrigin: boolean }) => boolean;
type Rule = { urlPattern: Match | RegExp; handler: string; options?: {
  cacheName?: string; expiration?: { maxEntries: number }; networkTimeoutSeconds?: number;
  plugins?: Array<{ cacheKeyWillBeUsed: (context: { request: { url: string } }) => Promise<string> }>;
} };
type Workbox = { manifestTransforms: Array<(entries: Entry[]) => Promise<{ manifest: Entry[] }>>; runtimeCaching: Rule[]; navigateFallback?: string; clientsClaim: boolean; skipWaiting: boolean };

describe("core-only PWA precache", () => {
  let workbox: Workbox;
  let collect: (options: unknown, bundle: Record<string, unknown>) => void;
  beforeEach(() => {
    const config = (configFactory as unknown as (context: { mode: string }) => { plugins: Array<{ name?: string; generateBundle?: typeof collect }> })({ mode: "production" });
    collect = config.plugins.find((plugin) => plugin.name === "core-app-shell-precache")!.generateBundle!;
    workbox = runtime.options!.workbox as Workbox;
  });

  it("keeps static transitive imports/CSS/assets, excluding every lazy page and its workers", async () => {
    const chunk = (fileName: string, imports: string[] = [], isEntry = false, css: string[] = [], assets: string[] = []) => ({
      type: "chunk", fileName, imports, dynamicImports: ["assets/LazyPage-hash.js"], isEntry,
      viteMetadata: { importedCss: new Set(css), importedAssets: new Set(assets) },
    });
    collect({}, {
      "assets/index-hash.js": chunk("assets/index-hash.js", ["assets/vendor-hash.js"], true, ["assets/index-hash.css"], ["assets/logo-hash.svg"]),
      "assets/vendor-hash.js": chunk("assets/vendor-hash.js", ["assets/shared-hash.js"]),
      "assets/shared-hash.js": chunk("assets/shared-hash.js"),
      "assets/index-hash.css": { type: "asset" }, "assets/logo-hash.svg": { type: "asset" },
      "assets/LazyPage-hash.js": chunk("assets/LazyPage-hash.js", ["assets/pdf-worker-hash.js"]),
      "assets/pdf-worker-hash.js": chunk("assets/pdf-worker-hash.js"),
      "assets/pwa-register-hash.js": { ...chunk("assets/pwa-register-hash.js", ["assets/workbox-window-hash.js"]), moduleIds: ["\0virtual:pwa-register"] },
      "assets/workbox-window-hash.js": chunk("assets/workbox-window-hash.js"),
    });
    const urls = ["assets/index-hash.js", "assets/vendor-hash.js", "assets/shared-hash.js", "assets/index-hash.css", "assets/logo-hash.svg",
      "assets/LazyPage-hash.js", "assets/pdf-worker-hash.js", "assets/pwa-register-hash.js", "assets/workbox-window-hash.js", "index.html", "icon-192.png", "icon-512.png", "manifest.json"];
    const entries = urls.map((url) => ({ url, revision: "rev", size: 10 }));
    const { manifest } = await workbox.manifestTransforms[0](entries);
    expect(manifest.map((entry) => entry.url)).toEqual(urls.filter((url) => !/LazyPage|pdf-worker|index\.html/.test(url)));
    expect(manifest.every((entry) => entry.revision === "rev")).toBe(true);
  });

  it("retains prompt/manual registration and does not install a shadowing precache NavigationRoute", () => {
    expect(runtime.options!.registerType).toBe("prompt");
    expect(runtime.options!.injectRegister).toBeNull();
    expect(workbox.clientsClaim).toBe(false);
    expect(workbox.skipWaiting).toBe(false);
    expect(workbox.navigateFallback).toBeUndefined();
  });

  it("fails safely if startup metadata is missing rather than silently shipping an empty offline shell", async () => {
    await expect(workbox.manifestTransforms[0]([])).rejects.toThrow("startup bundle metadata");
  });

  it("uses a canonical network-first offline shell, not a timed fallback to old HTML", async () => {
    const rule = workbox.runtimeCaching.find((entry) => entry.options?.cacheName === "html-shell")!;
    const matches = rule.urlPattern as Match;
    const context = (path: string, sameOrigin = true) => ({ url: new URL(path, "https://erp.example"), request: { mode: "navigate" }, sameOrigin });
    expect(matches(context("/insurance/claims"))).toBe(true);
    for (const path of ["/api", "/api/read", "/auth/callback", "/~oauth", "/functions/send"]) expect(matches(context(path))).toBe(false);
    expect(matches(context("https://other.example/work-orders", false))).toBe(false);
    expect(rule.handler).toBe("NetworkFirst");
    expect(rule.options!.networkTimeoutSeconds).toBeUndefined();
    expect(await rule.options!.plugins![0].cacheKeyWillBeUsed({ request: { url: "https://erp.example/new-route" } })).toBe("https://erp.example/index.html");
  });

  it("caches lazy hashed assets only on demand, bounded and same-origin", () => {
    const rule = workbox.runtimeCaching.find((entry) => entry.options?.cacheName === "temo-runtime-assets")!;
    const matches = rule.urlPattern as Match;
    const context = (path: string, sameOrigin = true) => ({ url: new URL(path, "https://erp.example"), request: { mode: "cors" }, sameOrigin });
    expect(rule.handler).toBe("CacheFirst");
    expect(rule.options!.expiration!.maxEntries).toBe(160);
    for (const path of ["/assets/LazyPage-abc123.js", "/assets/page-def456.css", "/assets/font-abc.woff2"]) expect(matches(context(path))).toBe(true);
    for (const path of ["/rest/v1/claims", "/assets/page.html", "/assets/page.js", "/storage/v1/object/sign/a", "/api/export.js"]) expect(matches(context(path))).toBe(false);
    expect(matches(context("https://other.example/assets/page-abc.js", false))).toBe(false);
  });

  it("keeps operational REST/auth/functions/realtime network-only and signed storage outside caching", () => {
    for (const suffix of ["rest/v1/insurance_claims", "auth/v1/token", "functions/v1/send", "realtime/v1/websocket"]) {
      const url = `https://tenant.supabase.co/${suffix}`;
      const rule = workbox.runtimeCaching.find((entry) => entry.urlPattern instanceof RegExp && entry.urlPattern.test(url));
      expect(rule?.handler).toBe("NetworkOnly");
    }
    expect(workbox.runtimeCaching.some((entry) => entry.urlPattern instanceof RegExp && entry.urlPattern.test("https://tenant.supabase.co/storage/v1/object/sign/private/a"))).toBe(false);
  });
});
