import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = () => resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root(), path), "utf8");

describe("work order visible save contract", () => {
  it("does not update a hidden archived/deleted order when creating a new work order number", () => {
    const store = read("src/lib/workOrdersStore.ts");
    expect(store).toContain("allocateVisibleOrderNumber");
    expect(store).toContain("deleted_at,archived_at");
    expect(store).toContain("Work order is archived/deleted");
    expect(store).toContain(".is(\"deleted_at\", null)");
    expect(store).toContain(".is(\"archived_at\", null)");
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
    expect(store).toContain("pushPatchToCloudNow(list[idx].id, { partsNeeded })");
    expect(store).toContain("const pendingPatch = _pendingPatches.get(mapped.id)");
    expect(store).toContain("return pendingPatch ? { ...mapped, ...pendingPatch } : mapped");
    expect(store).toContain("patch: { parts_required: patch.partsNeeded }");
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

  it("uses four-digit work-order numbers and keeps a safe renumber audit migration", () => {
    const numbering = read("src/lib/numberingSettings.ts");
    const helper = read("src/lib/numbering.ts");
    const migration = read("supabase/migrations/20260718090000_renumber_work_orders_four_digits.sql");
    expect(numbering).toContain('WO:        { label: "أوامر العمل",            prefix: "WO",      startFrom: 1, padding: 4 }');
    expect(helper).toContain("WO-YYYY-NNNN");
    expect(migration).toContain("work_order_number_renumber_audit");
    expect(migration).toContain("lpad(rn::text, 4, '0')");
    expect(migration).toContain("setval('public.job_order_seq'");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
  });
});
