import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("performance and data-sync regression", () => {
  it("does not treat auth verification timeout as permission to sign out", () => {
    const helper = read("src/lib/authProfileCache.ts");
    const context = read("src/contexts/AuthContext.tsx");
    expect(helper).not.toContain('supabase.auth.signOut as any');
    expect(helper).toContain("if (verificationError) throw verificationError");
    expect(context).toContain('onAuthStateChange((event, sess) => handleAuthState(event, sess))');
    expect(context).toContain("if (!active || initialSessionReceived) return");
    expect(context).toContain("const bootFallback = setTimeout");
  });

  it("bounds sales sync and never replaces paid state after a failed payments read", () => {
    const store = read("src/lib/salesStore.ts");
    const app = read("src/App.tsx");
    expect(store).toContain("SALES_SYNC_PAGE_SIZE = 100");
    expect(store).toContain(".range(offset, offset + SALES_SYNC_PAGE_SIZE - 1)");
    expect(store).toContain("if (paymentsError) throw paymentsError");
    expect(store).toContain("if (generation !== salesSessionGeneration) return");
    expect(store).toContain("if (writeGeneration !== salesCacheWriteGeneration)");
    expect(store).not.toContain("scheduleSalesRefresh(0)");
    expect(app).toContain('const Dashboard = lazy(() => import("./pages/Dashboard"))');
    expect(app).not.toContain('import Dashboard from "./pages/Dashboard"');
  });

  it("uses a tenant-scoped paged receipt read and one central realtime channel", () => {
    const page = read("src/pages/accounting/Receipts.tsx");
    const sql = read("supabase/migrations/20261006090000_receipts_paged_read.sql");
    const realtime = read("src/hooks/useRealtimeSync.ts");
    expect(page).toContain('"list_accounting_receipts_page_rpc"');
    expect(page).not.toContain('channel("receipts_cloud_sync")');
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(sql).toContain("limit least(greatest(coalesce(p_page_size, 50), 1), 100)");
    expect(sql).toContain("ar.deleted_at is null and ar.archived_at is null");
    expect(realtime).toContain('accounting_receipts: ["accounting_receipts_page"]');
  });

  it("caps oversized PDF raster work and copies only candidate slice rows", () => {
    const pdf = read("src/lib/htmlToPdf.ts");
    expect(pdf).toContain("pdfCaptureScale(captureWidth, captureHeight)");
    expect(pdf).toContain("ctx.getImageData(0, lower, canvas.width, maxY - lower + 1)");
  });

  it("ignores legacy store refresh results after tenant switch or a pending save", () => {
    const store = read("src/lib/createStore.ts");
    expect(store).toContain("if (epoch === storeEpoch && pendingMutations === 0) setCache(rows)");
    expect(store).not.toContain(".then(setCache)");
  });
});
