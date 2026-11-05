import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261104123558_profiles_rls_update_identity_without_self_recursion.sql", "utf8");
const executable = sql.replace(/^--.*$/gm, "");
describe("profile identity policy recursion repair", () => {
  it("keeps the old-row lookup private, stable, scoped and non-user-editable", () => {
    expect(sql).toContain("create function app_private.profile_update_identity");
    expect(sql).toContain("language sql stable security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("p.id = p_profile_id");
    expect(sql).toContain("p.tenant_id = public.get_user_tenant_id()");
    expect(sql).toContain("p.user_id = (select auth.uid())");
    expect(sql).not.toContain("user_metadata");
    expect(sql).toContain("from public, anon");
    expect(executable).not.toMatch(/grant\s+(?:all|create)/i);
  });
  it("removes direct recursive profiles lookups from all three UPDATE checks", () => {
    const policies = sql.slice(sql.indexOf('alter policy "Users update own profile own fields"'));
    expect(policies).not.toMatch(/from\s+(?:public\.)?profiles\b/i);
    expect(policies.match(/app_private\.profile_update_identity\(id\)/g)).toHaveLength(4);
    expect(policies).toContain("user_id = (select auth.uid())");
    expect(policies).toContain("and tenant_id = (select i.previous_tenant");
  });
  it("retains restrictive SELECT ownership and drift checks without data writes", () => {
    expect(sql).toContain("'SELECT', 'RESTRICTIVE'");
    expect(sql).toContain("PROFILE_POLICY_DRIFT");
    expect(sql).toContain("actual.roles::text <> '{authenticated}'");
    expect(sql).toContain("using (public.get_user_role() <> 'customer'::public.app_role or user_id = (select auth.uid()))");
    expect(executable).not.toMatch(/\b(?:insert into|update public|delete from|truncate)\b/i);
  });
});

