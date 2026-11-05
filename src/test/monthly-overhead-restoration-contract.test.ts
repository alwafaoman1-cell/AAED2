import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("supabase/migrations/20261105085159_restore_monthly_workshop_overheads_readmodel.sql", "utf8");
describe("missing Development overhead read-model restoration", () => {
  it("restores the existing Production definition only when absent and checks its exact hash", () => {
    expect(source).toContain("to_regprocedure('public.monthly_workshop_overheads_rpc(date,date)') is not null");
    expect(source).toContain("MONTHLY_OVERHEAD_READMODEL_SOURCE_DRIFT");
    expect(source).toContain("MONTHLY_OVERHEAD_READMODEL_RESTORE_MISMATCH");
    expect(source).toContain("d2bb3c5a1d057ce984ed6c75af4a9a62");
    expect(source).toContain("return;");
  });
  it("preserves read-only, tenant and permission guards without source updates or auto allocation", () => {
    expect(source).toContain("stable\nsecurity definer");
    expect(source).toContain("auth.uid() is null or v_tenant is null");
    expect(source).toContain("accounting_reports.vehicle_profit_loss");
    expect(source).toContain("revoke all on function");
    expect(source).not.toMatch(/\b(insert into|update public|delete from|nextval|setval|create index)\b/i);
  });
});
