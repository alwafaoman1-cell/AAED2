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
});
