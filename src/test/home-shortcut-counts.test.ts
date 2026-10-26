import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchHomeShortcutCounts } from "@/lib/homeShortcutCounts";

const counts = {
  openWorkOrders: 3, todayWorkOrders: 1, vehicles: 5,
  pendingClaims: 2, lowStock: 4, unpaidInvoices: 6, pendingInspections: 1,
};

describe("cloud-only home shortcut counters", () => {
  beforeEach(() => rpc.mockReset());

  it("uses one tenant-scoped RPC and accepts all validated counts", async () => {
    rpc.mockResolvedValue({ data: counts, error: null });
    await expect(fetchHomeShortcutCounts("tenant-a")).resolves.toEqual(counts);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("home_shortcut_counts_rpc", { p_tenant_id: "tenant-a" });
  });

  it("rejects a denied or partial payload rather than showing false zeroes", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { ...counts, unpaidInvoices: -1 }, error: null })
      .mockResolvedValueOnce({ data: { ...counts, lowStock: null }, error: null });
    await expect(fetchHomeShortcutCounts("tenant-b")).rejects.toThrow("HOME_SHORTCUT_COUNTS_UNAVAILABLE");
    await expect(fetchHomeShortcutCounts("tenant-b")).rejects.toThrow("HOME_SHORTCUT_COUNTS_UNAVAILABLE");
    await expect(fetchHomeShortcutCounts("tenant-b")).rejects.toThrow("HOME_SHORTCUT_COUNTS_UNAVAILABLE");
  });

  it("does not use obsolete tables or local cached records", () => {
    const page = readFileSync("src/pages/HomeShortcuts.tsx", "utf8");
    const migration = readFileSync("supabase/migrations/20261025175200_home_shortcut_counts.sql", "utf8");
    expect(page).not.toContain("inventory_items");
    expect(page).not.toContain("sales_invoices");
    expect(page).not.toContain("getWorkOrders()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("from public.inventory");
    expect(migration).toContain("from public.sales_documents");
  });
});
