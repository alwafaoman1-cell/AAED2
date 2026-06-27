import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("operational fixes contract", () => {
  it("returns clear JSON function errors instead of opaque non-2xx failures", () => {
    for (const file of [
      "supabase/functions/request-security-otp/index.ts",
      "supabase/functions/verify-security-otp/index.ts",
      "supabase/functions/execute-cloud-reset/index.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("ok: false");
      expect(src).toContain("status: 200");
    }
    expect(read("src/lib/functionErrors.ts")).toContain("Email provider is not configured");
    expect(read("src/lib/functionErrors.ts")).toContain("Too many attempts");
  });

  it("converts required spare parts into linked expenses once", () => {
    const manager = read("src/components/workorders/NeededPartsManager.tsx");
    const dialog = read("src/components/workorders/WorkOrderExpenseDialog.tsx");
    const order = read("src/pages/WorkOrderDetail.tsx");
    expect(manager).toContain("Convert to Expense");
    expect(manager).toContain("Converted to Expense");
    expect(dialog).toContain("requiredPartId");
    expect(dialog).toContain("convertedFromRequiredPart");
    expect(dialog).toContain("spare_part_converted_to_expense");
    expect(order).toContain("updateNeededPartInOrder");
    expect(order).toContain("convertedExpenseId");
  });

  it("adds a unified non-destructive delete policy and cloud audit", () => {
    const policy = read("src/lib/deletePolicy/index.ts");
    const migration = read("supabase/migrations/20260627102000_operational_delete_policy_and_required_parts.sql");
    const store = read("src/lib/workOrdersStore.ts");
    expect(policy).toContain("getWorkOrderImpact");
    expect(policy).toContain("archiveWorkOrder");
    expect(policy).toContain("deleteWorkOrderWithRelated");
    expect(policy).toContain("archiveCustomer");
    expect(migration).toContain("operational_audit_log");
    expect(migration).toContain("deleted_at");
    expect(store).toContain("archived_at");
    expect(store).not.toContain(".delete().eq(\"tenant_id\", ctx.tenantId).eq(\"order_number\"");
  });
});
