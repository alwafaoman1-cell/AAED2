import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("app performance architecture contract", () => {
  it("handles stale chunks centrally without deleting auth/session storage", () => {
    const recovery = read("src/lib/chunkRecovery.ts");
    const main = read("src/main.tsx");

    expect(recovery).toContain("recoverFromChunkLoadError");
    expect(recovery).toContain("hasUnsavedWork");
    expect(recovery).toContain("blocked_dirty_form");
    expect(recovery).toContain("sessionStorage");
    expect(recovery).toContain("clearApplicationShellCaches");
    expect(recovery).not.toContain("localStorage.clear");
    expect(recovery).not.toContain("sessionStorage.clear");

    expect(main).toContain("installChunkLoadErrorRecovery");
    expect(recovery).toContain('"vite:preloadError"');
    expect(recovery).toContain("recoveryInFlight");
    expect(main).toContain("تنظيف Cache وإعادة التحميل");
    expect(main).toContain("CURRENT_APP_VERSION");
    expect(main).not.toContain("Please use the built-in language switcher");
  });

  it("keeps PWA updates prompt-based rather than silently claiming old tabs", () => {
    const vite = read("vite.config.ts");
    const register = read("src/lib/registerPwa.ts");
    const updateStore = read("src/lib/updateStore.ts");

    expect(vite).toContain('registerType: "prompt"');
    expect(vite).toContain("clientsClaim: false");
    expect(vite).toContain("skipWaiting: false");
    expect(register).toContain("Do not call updateSW(true)");
    expect(register).toContain("publishPwaUpdate(updateSW)");
    expect(register).toContain("applyPendingPwaUpdate");
    expect(updateStore).toContain("clearApplicationShellCaches");
  });

  it("does not rewrite missing hashed assets to the SPA HTML shell", () => {
    const vercel = JSON.parse(read("vercel.json")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const spaRewrite = vercel.rewrites.find((rewrite) => rewrite.destination === "/index.html");
    expect(spaRewrite).toBeDefined();

    const matchesSpaRewrite = (path: string) => new RegExp(`^${spaRewrite!.source}$`).test(path);
    expect(matchesSpaRewrite("/accounting/reports/monthly-vehicle-profitability")).toBe(true);
    expect(matchesSpaRewrite("/assets/missing-hash.js")).toBe(false);
    expect(matchesSpaRewrite("/sw.js")).toBe(false);
    expect(matchesSpaRewrite("/workbox-deadbeef.js")).toBe(false);
    expect(matchesSpaRewrite("/manifest.json")).toBe(false);
    expect(matchesSpaRewrite("/icon-192.png")).toBe(false);
  });

  it("does not globally refetch operational data on tab focus or broad realtime scopes", () => {
    const app = read("src/App.tsx");
    const realtime = read("src/hooks/useRealtimeSync.ts");

    expect(app).toContain("refetchOnWindowFocus: false");
    expect(app).toContain("staleTime: 3 * 60_000");
    expect(realtime).toContain('scope: "claims_list"');
    expect(realtime).toContain('scope: "claim_detail"');
    expect(realtime).toContain('scope: "work_order_detail"');
    expect(realtime).toContain('scope: "dashboard"');
    expect(realtime).toContain("tables: []");
    expect(realtime).not.toContain('tables: ["job_orders", "insurance_claims", "insurance_invoices", "claim_payments", "expenses", "sales_documents"]');
  });
});
