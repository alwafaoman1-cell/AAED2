import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public tracking log abuse guard", () => {
  const sql = readFileSync("supabase/migrations/20261025175300_public_tracking_log_abuse_guard.sql", "utf8");

  it("requires a real active portal or legacy link before privileged insert", () => {
    expect(sql).toContain("cpt.token::text = v_token and cpt.revoked_at is null");
    expect(sql).toContain("jo.tracking_token::text = v_token and jo.deleted_at is null");
    expect(sql.indexOf("if v_order.id is null then\n    return")).toBeLessThan(sql.indexOf("insert into public.public_tracking_logs"));
  });

  it("throttles repeated opens and never exposes SQL errors to anonymous callers", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("l.opened_at >= now() - interval '1 minute'");
    expect(sql).toContain("'log_unavailable'");
    expect(sql).not.toContain("'error', SQLERRM");
  });
});
