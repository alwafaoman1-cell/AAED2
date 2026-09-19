import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("dashboard server summary contract", () => {
  it("uses tenant-bound bounded dashboard functions", () => {
    const sql = read("supabase/migrations/20260915143000_dashboard_operational_summary.sql");
    expect(sql).toContain("dashboard_operational_summary_rpc");
    expect(sql).toContain("dashboard_global_search_rpc");
    expect(sql).toContain("p_tenant_id = public.get_user_tenant_id()");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("limit 30");
    expect(sql).toContain("length(trim(coalesce(p_search, ''))) >= 2");
    expect(sql).not.toContain("archived_at is null\n+  from public.insurance_claims");
  });

  it("uses React Query and only activates legacy cloud refresh as fallback", () => {
    const page = read("src/pages/Dashboard.tsx");
    expect(page).toContain("queryKeys.dashboard.operational");
    expect(page).toContain("dashboardQuery.isError");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).toContain("queryKeys.dashboard.search");
  });
});
