import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("insurance work-order expense derivation", () => {
  const migration = read("supabase/migrations/20260813130000_expense_management_classification_refactor.sql");
  const runtime = read("supabase/tests/expense_management_classification_runtime_validation.sql");

  it("derives insurance context from the linked work order and claim", () => {
    expect(migration).toContain("new.work_order_channel:=case when v_claim is not null");
    expect(migration).toContain("new.claim_id:=v_claim");
    expect(migration).toContain("new.vehicle_id:=v_work.vehicle_id");
    expect(migration).toContain("new.customer_id:=v_work.customer_id");
    expect(runtime).toContain("insurance_work_order_derived");
  });

  it("does not accept a manually conflicting operating context", () => {
    expect(migration).toContain("OPERATING_EXPENSE_WORK_ORDER_NOT_ALLOWED");
    expect(runtime).toContain("operating_rejects_work_order");
  });
});
