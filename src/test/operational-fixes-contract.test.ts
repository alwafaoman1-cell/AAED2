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
    expect(read("src/lib/functionErrors.ts")).toContain("Server function is not deployed or is unreachable");
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

  it("persists customer archive and links repeat vehicle visits", () => {
    const policy = read("src/lib/deletePolicy/index.ts");
    const customers = read("src/pages/Customers.tsx");
    const vehicle = read("src/pages/VehicleDetail.tsx");
    const workOrderForm = read("src/components/workorders/WorkOrderForm.tsx");
    const migration = read("supabase/migrations/20260630123000_work_order_repeat_visits.sql");

    expect(policy).toContain("Customer archive was not persisted in Supabase");
    expect(customers).toContain("refreshCustomersFromCloud");
    expect(vehicle).toContain("زيارات الورشة");
    expect(vehicle).toContain("زيارات رابط التتبع");
    expect(vehicle).toContain("prefillVisit");
    expect(workOrderForm).toContain("parentWorkOrderId");
    expect(workOrderForm).toContain("visitNumber");
    expect(migration).toContain("parent_work_order_id");
    expect(migration).toContain("visit_number");
  });

  it("keeps archived work orders out of active lists and allows safe reset dry runs", () => {
    const store = read("src/lib/workOrdersStore.ts");
    const workOrders = read("src/pages/WorkOrders.tsx");
    const detail = read("src/pages/WorkOrderDetail.tsx");
    const dangerZone = read("src/components/settings/SecurityDangerZone.tsx");
    const resetFunction = read("supabase/functions/execute-cloud-reset/index.ts");
    const trashStore = read("src/lib/trashStore.ts");
    const restoreHandlers = read("src/hooks/useTrashRestoreHandlers.ts");

    expect(store).toContain("!order.deletedAt && !order.archivedAt");
    expect(store).toContain(".is(\"deleted_at\", null)");
    expect(store).toContain(".is(\"archived_at\", null)");
    expect(workOrders.match(/refreshWorkOrdersFromCloud/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(detail).toContain("refreshWorkOrdersFromCloud");
    expect(dangerZone).toContain("if (!dryRun && !bypassOtp && !otp.trim())");
    expect(resetFunction).toContain("const dryRun = body.dryRun !== false");
    expect(resetFunction).toContain("const skipOtp = body.skipOtp === true || dryRun");
    expect(resetFunction).toContain("if (!dryRun && body.confirmPhrase !== \"DELETE CLOUD DATA\")");
    expect(trashStore).toContain("handler(item.payload, item)");
    expect(restoreHandlers).toContain("isUuid(item.entityId)");
    expect(workOrders).toContain("payload: { ...removed, cloudId: cloudEntityId }");
    expect(detail).toContain("payload: { ...removed, cloudId: cloudEntityId }");
  });
});
