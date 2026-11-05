import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
describe("Supervisor shared media realtime dependency",()=>{
  it("publishes only the existing RLS-protected tenant media table, without rewriting rows or permissions",()=>{
    const ddl=readFileSync("supabase/migrations/20261105155349_supervisor_media_realtime_dependency.sql","utf8");
    expect(ddl).toContain("relrowsecurity");expect(ddl).toContain("column_name='tenant_id'");
    expect(ddl).toContain("alter publication supabase_realtime add table public.vehicle_media");
    expect(ddl).not.toMatch(/\b(update|insert\s+into|delete\s+from|grant|disable\s+row\s+level)\b/i);
  });
  it("refreshes all active canonical media and visit readers instead of just a separate vehicle cache",()=>{
    const source=readFileSync("src/hooks/useRealtimeSync.ts","utf8");
    expect(source).toContain('vehicle_media: ["vehicle_media", "vehicle_entries", "vehicle_visit", "job_orders", "vehicles", "vehicle_360"]');
    expect(source).toContain('filter: `tenant_id=eq.${profile.tenant_id}`');
    expect(source).toContain('refetchType: "active"');
  });
});
