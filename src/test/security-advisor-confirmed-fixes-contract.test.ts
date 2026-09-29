import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923150000_security_advisor_confirmed_fixes.sql"),
  "utf8",
).toLowerCase();
const executableSql = migration.replace(/^--.*$/gm, "");

const vercel = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
) as { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };

describe("confirmed Security Advisor fixes", () => {
  it("pins the search path for every function reported as mutable", () => {
    const signatures = [
      "find_vehicle_by_vin(text)",
      "accounting_dashboard_summary_rpc(date, date, text, uuid)",
      "accounting_reports_summary_rpc(date, date)",
      "touch_unified_operational_updated_at()",
      "touch_vehicle_media_updated_at()",
      "touch_vehicle_entries_updated_at()",
    ];

    for (const signature of signatures) {
      expect(migration).toContain(`public.${signature.split(", ").join(",")}`);
    }
    expect(migration).toContain("to_regprocedure(function_signature)");
    expect(migration).toContain("alter function %s set search_path = pg_catalog, public");
  });

  it("blocks direct browser execution of trigger-only functions", () => {
    const signatures = [
      "audit_expense_duplicate_override()",
      "guard_expense_duplicate_document()",
      "sync_expense_financial_totals()",
      "sync_profile_role_to_user_roles()",
    ];

    for (const signature of signatures) {
      expect(migration).toContain(`public.${signature}`);
    }
    expect(migration).toContain(
      "revoke execute on function %s from public, anon, authenticated",
    );
  });

  it("keeps only the token-validated vehicle-entry signature wrappers public", () => {
    expect(migration).toContain(
      "public.get_vehicle_entry_for_customer_signature(text)",
    );
    expect(migration).toContain(
      "public.submit_vehicle_entry_customer_signature(text,text,text,text)",
    );
    expect(migration).toContain(
      "grant execute on function %s to anon, authenticated, service_role",
    );
  });

  it("does not mutate operational rows", () => {
    expect(executableSql).not.toMatch(/\b(insert|update|delete|truncate)\b/);
    expect(executableSql).not.toMatch(/create\s+(or\s+replace\s+)?function/);
  });

  it("adds baseline browser security headers without restricting app APIs", () => {
    const globalHeaders = vercel.headers?.find((entry) => entry.source === "/(.*)")?.headers ?? [];
    const values = Object.fromEntries(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

    expect(values["x-content-type-options"]).toBe("nosniff");
    expect(values["x-frame-options"]).toBe("SAMEORIGIN");
    expect(values["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(values["permissions-policy"]).toContain("geolocation=()");
  });
});
