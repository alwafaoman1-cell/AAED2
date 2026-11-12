import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveClaimOnlyStage, getVehicleCenterTab, projectClaimWithoutEntry } from "@/lib/vehicleVisitLifecycle";

describe("historical cancellation does not invent a vehicle or receipt", () => {
  for (const status of ["cancelled", "rejected"]) {
    it(`keeps ${status} claims in Cancelled when identity is incomplete`, () => {
      const claim = { id: "old-claim", vehicle_id: null, status, created_at: "2026-05-01T08:00:00Z", vehicle_presence_status: "with_customer" };
      const card = projectClaimWithoutEntry(claim, null);
      expect(card.operationalStage).toBe("cancelled");
      expect(getVehicleCenterTab(card)).toBe("cancelled");
      expect(card.reviewReason).toBe("claim_without_entry");
      expect(card.entry.vehicle_id).toBeNull();
      expect(card.entry.entry_number).toBe("");
      expect(card.entry.vehicle_location).toBeNull();
      expect(card.hasFinalHandover).toBe(false);
    });
  }
  it("does not infer delivery from a paid claim with missing identity", () => {
    expect(deriveClaimOnlyStage({ id: "paid", status: "paid", vehicle_id: null, delivered_at: "2026-05-10" }, null)).toBe("needs_review");
  });
  it("retains active identity conflict guards", () => {
    expect(deriveClaimOnlyStage({ id: "active", status: "approved", vehicle_id: "v1" }, { claim_id: "active", vehicle_id: "v2", work_order_type: "insurance" })).toBe("needs_review");
  });
  it("does not cache projection-version reads as immutable constants", () => {
    const migration = readFileSync("supabase/migrations/20261109065854_vehicle_center_projection_stable_semantics.sql", "utf8");
    expect(migration).toMatch(/alter function public\.vehicle_visit_center_resolve_v1\(jsonb,jsonb,boolean,boolean,text\) stable/i);
    expect(migration).toContain("CENTER_PROJECTION_VOLATILITY_REVIEW_REQUIRED");
    expect(migration).not.toMatch(/\b(?:update|insert into|delete from)\s+public\./i);
  });
});
