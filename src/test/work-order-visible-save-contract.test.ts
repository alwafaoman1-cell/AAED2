import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = () => resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root(), path), "utf8");

describe("work order visible save contract", () => {
  it("does not update a deleted order when creating a new work order number", () => {
    const store = read("src/lib/workOrdersStore.ts");
    expect(store).not.toContain("allocateVisibleOrderNumber");
    expect(store).toContain("database BEFORE INSERT trigger atomically allocates");
    expect(store).toContain("deleted_at,archived_at");
    expect(store).toContain("Work order is deleted in Supabase");
    expect(store).toContain(".is(\"deleted_at\", null)");
    expect(store).toContain(".is(\"archived_at\", null)");
    expect(store).not.toContain("if ((existing as any).deleted_at || (existing as any).archived_at)");
  });

  it("keeps the Supabase customer relation when loading work orders for editing", () => {
    const store = read("src/lib/workOrdersStore.ts");
    expect(store).toContain("customerId: r.customer_id || undefined");
    expect(store).toContain("vehicleId: r.vehicle_id || undefined");
  });

  it("does not reset the edit form just because the same initial order object was refetched", () => {
    const form = read("src/components/workorders/WorkOrderForm.tsx");
    expect(form).toContain("const initialFormKey =");
    expect(form).toContain("initial?.cloudId || initial?.id || \"new\"");
    expect(form).toContain("}, [initialFormKey]);");
    expect(form).not.toContain("}, [initial, prefillCustomer, prefillPhone, prefillPlate, prefillVehicle, prefillVisit]);");
  });

  it("flushes needed-parts edits immediately so refetch does not erase the new part", () => {
    const store = read("src/lib/workOrdersStore.ts");
    expect(store).toContain("neededPartsWriteQueue");
    expect(store).toContain("await queueNeededPartsCloudSave(list[idx], partsNeeded)");
    expect(store).toContain("discardPendingNeededPartsPatch(order.id)");
    expect(store).toContain("const pendingPatch = _pendingPatches.get(mapped.id)");
    expect(store).toContain("return pendingPatch ? { ...mapped, ...pendingPatch } : mapped");
    expect(store).toContain("patch: { parts_required: partsNeeded }");
  });

  it("never converts cache replacement or auth cache clearing into cloud deletion", () => {
    const store = read("src/lib/workOrdersStore.ts");
    const insuranceList = read("src/pages/insurance/InsuranceWorkOrders.tsx");
    expect(store).not.toContain("function pushDeleteToCloud");
    expect(store).not.toContain("_afterDelete");
    expect(store).not.toContain("for (const id of _lastSnapshot.keys())");
    expect(store).not.toContain("deleted_by: null } as any");
    expect(store).toContain("Every destructive UI path must first call the explicit delete/archive policy");
    expect(insuranceList).toContain("await archiveWorkOrder(order");
  });

  it("does not require vehicle model when creating or linking a vehicle", () => {
    const identity = read("src/lib/vehicleIdentity.ts");
    const form = read("src/components/workorders/WorkOrderForm.tsx");
    expect(identity).toContain("if (!make) throw new Error(\"أدخل ماركة المركبة قبل الحفظ\")");
    expect(identity).not.toContain("أدخل ماركة وموديل المركبة قبل الحفظ");
    expect(form).toContain("أدخل ماركة المركبة قبل المتابعة");
    expect(form).toContain("أدخل ماركة المركبة قبل حفظ أمر العمل");
    expect(form).not.toContain("أدخل ماركة وموديل المركبة قبل المتابعة");
    expect(form).not.toContain("أدخل ماركة وموديل المركبة قبل حفظ أمر العمل");
  });

  it("uses immutable five-digit global work-order numbers and a safe audit migration", () => {
    const numbering = read("src/lib/numberingSettings.ts");
    const helper = read("src/lib/numbering.ts");
    const migration = read("supabase/migrations/20260901100000_work_order_global_five_digit_numbering.sql");
    expect(numbering).toContain('WO:        { label: "أوامر العمل",            prefix: "WO",      startFrom: 1, padding: 5 }');
    expect(helper).toContain("WO-NNNNN");
    expect(migration).toContain("work_order_number_renumber_audit");
    expect(migration).toContain("where jo.deleted_at is null");
    expect(migration).toContain("lpad(sequence_number::text, 5, '0')");
    expect(migration).toContain("allocate_work_order_number");
    expect(migration).toContain("before insert on public.job_orders");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("keeps the desktop work-order workspace compact without changing the mobile flow", () => {
    const detail = read("src/pages/WorkOrderDetail.tsx");
    expect(detail).toContain('grid grid-cols-1 items-start gap-4 lg:grid-cols-2');
    expect(detail).toContain("<NeededPartsManager");
    expect(detail).toContain("<CustomerPortalLink");
    expect(detail).toContain("<SmartCustomerSendBar");
    expect(detail.indexOf("<NeededPartsManager")).toBeLessThan(detail.indexOf("<CustomerPortalLink"));
  });
});
