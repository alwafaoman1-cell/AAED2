import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("unified claim/work-order operational file contract", () => {
  it("creates one shared operational state and media source in a non-destructive migration", () => {
    const migration = read("supabase/migrations/20260715143000_unified_claim_work_order_operational_file.sql");

    expect(migration).toContain("create table if not exists public.claim_work_order_operations");
    expect(migration).toContain("create table if not exists public.vehicle_media");
    expect(migration).toContain("claim_id uuid");
    expect(migration).toContain("work_order_id uuid");
    expect(migration).toContain("vehicle_id uuid");
    expect(migration).toContain("storage_path text not null");
    expect(migration).toContain("on conflict (tenant_id, storage_bucket, storage_path) do nothing");
    expect(migration.toLowerCase()).not.toContain("drop table");
    expect(migration.toLowerCase()).not.toContain("truncate");
  });

  it("routes claim and work-order writes through the shared operational helpers", () => {
    const claimDetail = read("src/pages/insurance/InsuranceClaimDetailRedesigned.tsx");
    const workOrderStore = read("src/lib/workOrdersStore.ts");
    const workOrderDetail = read("src/pages/WorkOrderDetail.tsx");

    expect(claimDetail).toContain("upsertUnifiedOperationalState");
    expect(claimDetail).toContain("addUnifiedVehicleMedia");
    expect(claimDetail).toContain("listUnifiedVehicleMedia");
    expect(workOrderStore).toContain("upsertUnifiedOperationalState");
    expect(workOrderStore).toContain("addUnifiedVehicleMedia");
    expect(workOrderDetail).toContain("listUnifiedVehicleMedia");
  });
});
