import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(path:string)=>readFileSync(path,"utf8");
describe("performance refactor preserves cloud boundaries",()=>{
  it("joins detail references in one tenant-scoped read and never persists the read projection",()=>{
    const source=read("src/lib/workOrdersStore.ts");
    for(const fk of ["customers!job_orders_customer_id_fkey","vehicles!job_orders_vehicle_id_fkey","insurance_claims!job_orders_claim_id_fkey"])expect(source).toContain(fk);
    const metadata=source.slice(source.indexOf("function jobOrderMetadata("),source.indexOf("function isPlainObject(",source.indexOf("function jobOrderMetadata(")));
    expect(metadata).not.toContain("resolvedClaim");expect(source).toContain('Object.prototype.hasOwnProperty.call(row,key)');
  });
  it("does not hydrate full operational archives for dashboard counters",()=>{
    const account=read("src/pages/Accounting.tsx"),hub=read("src/pages/insurance/InsuranceHub.tsx");
    expect(account).not.toContain("expensesStore.refresh");expect(account).toContain("fetchExpenseDashboardSummary");
    for(const old of ["useInsuranceClaims","useInsuranceInvoices","useClaimPayments","useInsuranceAlerts"])expect(hub).not.toContain(old);
    expect(hub).toContain("fetchInsuranceHubSummary");expect(hub).toContain("query.isError");
  });
  it("uses read-only authenticated projections without bypassing source RLS",()=>{
    const sql=read("supabase/migrations/20261107184519_bounded_dashboard_read_summaries.sql");
    expect(sql.match(/stable security invoker/gi)?.length).toBe(2);
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|alter table)\b/i);
    expect(sql.match(/from public,anon/g)?.length).toBe(2);expect(sql).toContain("p.disabled_at is null");
    expect(sql).toContain("settlement_discount_amount");
  });
  it("batches center evidence without making private resolvers public or rewriting stages",()=>{
    const sql=read("supabase/migrations/20261107185013_vehicle_center_set_based_evidence.sql");
    expect(sql).toContain("vehicle_visit_center_projection_batch_v1");
    expect(sql).not.toMatch(/grant execute on function public\.vehicle_visit_center_resolve_v1/i);
    expect(sql).not.toMatch(/\b(update|delete from|insert into) public\.(vehicle_entries|insurance_claims|job_orders|vehicle_visit_workflows)\b/i);
    expect(sql).toContain("disabled_at is null");expect(sql).toContain("VEHICLE_CENTER");
  });
});
