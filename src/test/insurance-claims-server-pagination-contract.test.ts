import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
});
