import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isActiveAccountingRecord } from "@/lib/accounting/accountingEligibility";
import { buildInsuranceCollectionRows } from "@/lib/insuranceCollectionReport";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("insurance claims archived_at production hotfix", () => {
  it("uses the production claim lifecycle columns and never queries archived_at", () => {
    const hook = source("src/hooks/useInsuranceClaims.ts");
    const payload = source("src/lib/insurance/claimPayloadService.ts");

    expect(hook).toContain('.is("deleted_at", null)');
    expect(hook).not.toContain('.is("archived_at", null)');
    expect(hook).toContain('select("id,tenant_id,status,approved_amount,rejection_reason,deleted_at")');
    expect(hook).not.toContain("rejection_reason,archived_at");
    expect(payload).toContain('select("id,claim_number,status,deleted_at")');
    expect(payload).not.toContain("claim_number,deleted_at,archived_at");
  });

  it("archives claim links through status and deleted_at instead of a missing column", () => {
    const vehiclesStore = source("src/lib/vehiclesStore.ts");
    const claimUpdate = vehiclesStore.match(
      /safeUpdate\("insurance_claims"[\s\S]*?\.eq\("vehicle_id", cloudId\)\);/,
    )?.[0];

    expect(claimUpdate).toBeTruthy();
    expect(claimUpdate).toContain('status: "cancelled", deleted_at: archivedAt');
    expect(claimUpdate).not.toContain("archived_at");
  });

  it("keeps cancelled and deleted claims out of insurance collection reports", () => {
    const baseClaim = {
      id: "claim-active",
      tenant_id: "tenant-a",
      claim_number: "CLAIM-ACTIVE",
      insurance_company: "Insurer",
      status: "approved",
      created_at: "2026-08-01T00:00:00Z",
      approved_amount: 100,
    } as any;

    const rows = buildInsuranceCollectionRows({
      claims: [
        baseClaim,
        { ...baseClaim, id: "claim-cancelled", claim_number: "CLAIM-CANCELLED", status: "cancelled" },
        { ...baseClaim, id: "claim-deleted", claim_number: "CLAIM-DELETED", deleted_at: "2026-08-02T00:00:00Z" },
      ],
      invoices: [],
      payments: [],
      pendingCollectionOnly: false,
    });

    expect(rows.map((row) => row.claimId)).toEqual(["claim-active"]);
  });

  it("keeps accounting cancellation and tenant isolation rules unchanged", () => {
    const active = { id: "claim", tenant_id: "tenant-a", status: "approved" };
    expect(isActiveAccountingRecord(active, "tenant-a")).toBe(true);
    expect(isActiveAccountingRecord({ ...active, status: "cancelled" }, "tenant-a")).toBe(false);
    expect(isActiveAccountingRecord({ ...active, status: "void" }, "tenant-a")).toBe(false);
    expect(isActiveAccountingRecord({ ...active, deleted_at: "2026-08-02" }, "tenant-a")).toBe(false);
    expect(isActiveAccountingRecord(active, "tenant-b")).toBe(false);
  });

  it("matches the generated production claim type", () => {
    const generated = source("src/integrations/supabase/types.ts");
    const start = generated.indexOf("      insurance_claims: {");
    const end = generated.indexOf("      insurance_companies: {", start);
    const claimType = generated.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(claimType).toContain("deleted_at: string | null");
    expect(claimType).toContain('status: Database["public"]["Enums"]["claim_status"]');
    expect(claimType).not.toContain("archived_at:");
  });
});
