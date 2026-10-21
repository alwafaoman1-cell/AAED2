import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  ClaimWorkOrderConflictError,
  resolvePrimaryClaimWorkOrder,
  type PrimaryClaimWorkOrder,
} from "@/lib/claimWorkOrderGuard";

const order = (id: string, changes: Partial<PrimaryClaimWorkOrder> = {}): PrimaryClaimWorkOrder => ({
  id,
  order_number: `WO-I-26-${id}`,
  vehicle_id: "vehicle-1",
  status: "received",
  ...changes,
});

describe("one primary work order per insurance claim", () => {
  it("reuses one primary order even when both claim links point to it", () => {
    const existing = order("0112");
    expect(resolvePrimaryClaimWorkOrder([existing, existing])).toEqual(existing);
  });

  it("refuses to choose silently when a claim has two active primary orders", () => {
    expect(() => resolvePrimaryClaimWorkOrder([order("0112"), order("0113")]))
      .toThrow(ClaimWorkOrderConflictError);
  });

  it("does not treat a deleted order or an explicit repeat visit as a second primary order", () => {
    const primary = order("0112");
    expect(resolvePrimaryClaimWorkOrder([
      primary,
      order("0113", { deleted_at: "2026-10-21T00:00:00Z" }),
      order("0114", { parent_work_order_id: primary.id }),
    ])).toEqual(primary);
  });

  it("guards both the shared save path and the claim conversion path before an insert", () => {
    const store = readFileSync("src/lib/workOrdersStore.ts", "utf8");
    const claim = readFileSync("src/pages/insurance/InsuranceClaimDetail.tsx", "utf8");
    const entry = readFileSync("src/lib/vehicleEntryService.ts", "utf8");
    expect(store.indexOf("findPrimaryClaimWorkOrder(ctx.tenantId, order.claimId)"))
      .toBeLessThan(store.indexOf(".insert(payload).select"));
    expect(claim.indexOf("findPrimaryClaimWorkOrder(tenantId, id)"))
      .toBeLessThan(claim.indexOf("savedOrder = await saveWorkOrderToCloud(order)"));
    expect(entry.indexOf("findPrimaryClaimWorkOrder(tenantId, linkedClaimId)"))
      .toBeLessThan(entry.indexOf(".insert(payload as any)"));
  });

  it("guards concurrent inserts in the database without modifying existing rows", () => {
    const sql = readFileSync("supabase/migrations/20261021100000_guard_primary_claim_work_order_creation.sql", "utf8");
    const uniqueIndex = readFileSync("supabase/migrations/20261021103000_unique_primary_claim_work_order.sql", "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("jo.tenant_id = new.tenant_id");
    expect(sql).toContain("jo.claim_id = new.claim_id");
    expect(sql).toContain("jo.parent_work_order_id is null");
    expect(sql).toContain("trg_00_reuse_primary_claim_order");
    expect(sql).not.toMatch(/\b(update|delete)\s+public\.job_orders\b/i);
    expect(uniqueIndex).toContain("on public.job_orders (tenant_id, claim_id)");
    expect(uniqueIndex).toContain("parent_work_order_id is null");
    expect(uniqueIndex).toContain("having count(*) > 1");
  });

  it("guards claim links inferred by another trigger on any order update", () => {
    const sql = readFileSync("supabase/migrations/20261021104000_guard_claim_order_on_all_updates.sql", "utf8");
    expect(sql).toMatch(/before insert or update on public\.job_orders/i);
    expect(sql).not.toMatch(/update of tenant_id/i);
    expect(sql).toContain("app_private.guard_one_primary_work_order_per_claim()");
  });
});
