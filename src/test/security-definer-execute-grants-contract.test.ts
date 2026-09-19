import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915130000_security_definer_execute_grants.sql"),
  "utf8",
).toLowerCase();

describe("security definer execute grants", () => {
  it("prevents implicit PUBLIC execution on future functions", () => {
    expect(migration).toContain(
      "alter default privileges for role postgres in schema public\n  revoke execute on functions from public",
    );
  });

  it("keeps only token-validated customer entry points public", () => {
    const publicFunctions = [
      "get_public_invoice(text)",
      "get_public_tracking(text)",
      "get_public_work_order(text, text)",
      "get_work_order_for_sign(text)",
      "resolve_tenant_by_hostname(text)",
      "submit_customer_feedback(text, integer, text, text)",
      "submit_portal_note(text, text, text, text, text)",
      "submit_work_order_signature(text, text, text, text, text)",
    ];

    for (const signature of publicFunctions) {
      expect(migration).toContain(
        `grant execute on function public.${signature} to anon, authenticated, service_role`,
      );
    }
  });

  it("blocks browser roles from provider and backing functions", () => {
    const internalFunctions = [
      "reserve_message_idempotency(uuid, text, text, text, text)",
      "get_supplement_request_by_token(text)",
      "submit_supplement_decision(text, jsonb, text, text, text, text)",
      "get_public_tracking_base_20260721(text)",
      "get_work_order_for_sign_base_20260721(text)",
      "submit_work_order_signature_base_20260721(text, text, text, text, text)",
    ];

    for (const signature of internalFunctions) {
      expect(migration).toContain(
        `revoke execute on function public.${signature} from public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant execute on function public.${signature} to service_role`,
      );
    }
  });

  it("removes direct browser execution from trigger-only functions", () => {
    expect(migration).toContain(
      "revoke execute on function public.sync_claim_from_job_order() from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke execute on function public.derive_expense_work_order_context() from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke execute on function public.prevent_self_role_escalation() from public, anon, authenticated",
    );
  });

  it("does not replace functions or modify operational rows", () => {
    expect(migration).not.toMatch(/create\s+(or\s+replace\s+)?function/);
    expect(migration).not.toMatch(/\b(insert|update|delete|truncate)\b/);
  });
});
