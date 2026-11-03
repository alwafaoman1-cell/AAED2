import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getClaimVehicleLocation } from "@/lib/claimVehicleLocation";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("insurance claims server pagination contract", () => {
  it("defines a tenant-bound bounded read-only RPC without archived_at", () => {
    const sql = read("supabase/migrations/20260915142000_insurance_claims_list_pagination.sql");
    expect(sql).toContain("insurance_claims_list_rpc");
    expect(sql).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("limit least(greatest(coalesce(p_page_size, 20), 1), 100)");
    expect(sql).toContain("where c.deleted_at is null");
    expect(sql).not.toContain("archived_at");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });

  it("keeps cancellation and vehicle location rules in server filters", () => {
    const sql = read("supabase/migrations/20260915142000_insurance_claims_list_pagination.sql");
    expect(sql).toContain("when c.status::text in ('cancelled', 'rejected') then 'cancelled'");
    expect(sql).toContain("b.list_vehicle_location not in ('paid_archive', 'cancelled')");
    expect(sql).toContain("when c.delivered_at is not null then 'delivered'");
  });

  it("uses the paginated query while retaining legacy loading only as fallback", () => {
    const page = read("src/pages/insurance/InsuranceClaimsList.tsx");
    const hook = read("src/hooks/useInsuranceClaims.ts");
    expect(hook).toContain('"insurance_claims_list_rpc"');
    expect(hook).toContain("fetchAllInsuranceClaimListRows");
    expect(page).toContain("queryKeys.insuranceClaims.operationalList");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).toContain("claimsPageQuery.isError");
  });

  it("projects physical custody from the exact visit without treating paid as a location", () => {
    const sql = read("supabase/migrations/20261103091538_insurance_claim_list_visit_custody.sql");
    expect(sql).toContain("e.id = c.vehicle_entry_id or e.insurance_claim_id = c.id or e.converted_claim_id = c.id");
    expect(sql).toContain("visit.linked_count > 1 or visit.vehicle_conflict");
    expect(sql).toContain("when visit.entry_location = 'داخل الورشة'");
    expect(sql).toContain("and c.vehicle_presence_status = 'in_workshop'");
    expect(sql).toContain("p_delivery = 'paid_archive' and b.status::text = 'paid'");
    expect(sql).toContain("or b.list_vehicle_location = p_delivery");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/update public\.(insurance_claims|vehicle_entries|job_orders)/i);
    const paid = { status: "paid", list_vehicle_location: "in_workshop" } as InsuranceClaim;
    expect(getClaimVehicleLocation(paid)).toBe("in_workshop");
    expect(getClaimVehicleLocation({ ...paid, list_vehicle_location: "needs_review" })).toBe("needs_review");
  });
});
