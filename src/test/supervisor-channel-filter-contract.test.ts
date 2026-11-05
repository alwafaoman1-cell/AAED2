import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getVehicleVisitBillingKind } from "@/lib/vehicleEntryService";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// Static migration/projection contract only: this neither executes SQL nor proves live count parity.
const migration = readFileSync("supabase/migrations/20261105115513_supervisor_center_channel_filter.sql", "utf8");
const original = readFileSync("supabase/migrations/20261104142019_vehicle_center_bounded_read_projection.sql", "utf8");
const endpoint = original.slice(original.indexOf("create function public.vehicle_visit_center_page_v1"));
const anchor = migration.match(/anchor text := '((?:[^']|'')*)';/)?.[1].replace(/''/g, "'") || "";
const insertion = migration.match(/insertion text := \$filter\$([\s\S]*?)\$filter\$;/)?.[1] || "";
const projected = anchor ? endpoint.replace(anchor, insertion + anchor) : "";

describe("supervisor channel filter SQL contract", () => {
  it("patches the existing stable invoker endpoint, retaining its tenant/auth checks", () => {
    expect(endpoint).toMatch(/security invoker/i);
    expect(migration).toContain("not prosecdef and provolatile='s'");
    expect(migration).toContain("SUPERVISOR_CENTER_SECURITY_CONTRACT_CHANGED");
    expect(projected).toContain("p_tenant_id is distinct from public.get_user_tenant_id()");
    expect(projected).toContain("auth.uid() is null");
    expect(migration).not.toMatch(/security definer|\b(?:insert into|update public\.|delete from|alter table|grant)\b/i);
  });
  it("fails closed on anchor drift and remains idempotent only for identical filter text", () => {
    expect(anchor).not.toBe(""); expect(insertion).not.toBe(""); expect(endpoint.split(anchor)).toHaveLength(2);
    expect(migration).toContain("SUPERVISOR_CENTER_PROJECTION_DRIFT"); expect(migration).toContain("SUPERVISOR_CENTER_FILTER_DRIFT");
    expect(migration).toContain("if position(insertion in definition)=0");
    expect(migration).toContain("not in (''all'',''cash'',''insurance'')");
    expect(insertion).toContain("coalesce(p_filters->>'channel','all')='all'");
  });
  it("applies channel filtering before all stage/tab counts, totals, scope tokens and pagination", () => {
    const filter = projected.indexOf("supervisor_channel_filter_v1");
    expect(filter).toBeGreaterThan(projected.indexOf("filtered as materialized"));
    for (const marker of ["stage_filtered as materialized", "selected as materialized", "page_rows as ("]) expect(filter).toBeLessThan(projected.indexOf(marker));
    expect(projected).toContain("'total',(select count(*) from selected)");
    expect(projected).toContain("count(*) from stage_filtered where r->>'centerTab'=tab");
    expect(projected).toContain("count(*) from filtered where r->>'centerTab'=p_tab");
    expect(projected).toContain("'entryCount',(select count(*) from selected");
    expect(projected).toContain("'claimOnlyCount',(select count(*) from selected");
    expect(projected).toMatch(/'scopeToken',[\s\S]*?from selected\)/);
    expect(projected).toContain("limit p_page_size offset ((p_page::bigint-1)*p_page_size)");
    expect(projected).toContain("'items',coalesce((select jsonb_agg");
  });
  it.each([
    [{ insurance_claim_id: "claim" }, "insurance_claim_id"],
    [{ converted_claim_id: "claim" }, "converted_claim_id"],
    [{ insurance_company_id: "company" }, "insurance_company_id"],
    [{ insurance_snapshot: { is_insurance_related: true } }, "is_insurance_related"],
    [{ insurance_snapshot: { claim_number: "CL-1" } }, "claim_number"],
    [{ insurance_snapshot: { company_name: "Insurer" } }, "company_name"],
    [{ work_order: { work_order_type: "insurance" } }, "work_order_type"],
    [{ converted_work_order: { work_order_type: "insurance" } }, "converted_work_order"],
  ])("keeps canonical insurance evidence in SQL and the existing helper: %j", (entry, evidence) => {
    expect(getVehicleVisitBillingKind(entry)).toBe("insurance"); expect(insertion).toContain(evidence as string);
  });
  it.each([{}, { insurance_snapshot: { is_insurance_related: false, claim_number: " ", company_name: "" } }, { work_order: { work_order_type: "general_customer" } }])("retains cash classification without insurance evidence: %j", entry => {
    expect(getVehicleVisitBillingKind(entry)).toBe("cash"); expect(insertion).toContain("then 'insurance' else 'cash' end");
  });
});
