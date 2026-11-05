import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("private document account status enforcement", () => {
  it("requires the active auth-linked profile without granting new roles or definer privileges", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261104072551_document_access_active_profile_guard.sql", import.meta.url), "utf8");
    expect(sql).toContain("DOCUMENT_ACCESS_FUNCTION_DRIFT");
    expect(sql).toContain("p.user_id=(select auth.uid())");
    expect(sql).toContain("p.account_status='active'");
    expect(sql).toContain("p.disabled_at is null");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/\bgrant\s|security definer|\bupdate public|\bdelete from|\binsert into/i);
    expect(sql).toContain("when 'operational'");
    expect(sql).toContain("when 'finance'");
    expect(sql).toContain("when 'restricted'");
  });
});

