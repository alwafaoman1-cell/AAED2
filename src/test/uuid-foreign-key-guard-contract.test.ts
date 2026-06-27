import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isUuid } from "@/lib/uuid";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("uuid foreign key guard", () => {
  it("rejects temporary customer ids", () => {
    expect(isUuid("CUST-1782559252336-g8lgb")).toBe(false);
    expect(isUuid("VEH-1782559252336")).toBe(false);
    expect(isUuid("TEMP-1")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("creates customers with uuid ids before operational use", () => {
    const customersStore = read("src/lib/customersStore.ts");
    expect(customersStore).toContain("addAsync");
    expect(customersStore).toContain("ensureCloudCustomer");
    expect(read("src/components/customers/NewCustomerDialog.tsx")).not.toContain("id: `CUST-");
    expect(read("src/components/customers/CustomerFormDialog.tsx")).not.toContain("id: `CUST-");
  });

  it("guards work order and claim foreign keys before saving", () => {
    expect(read("src/components/workorders/WorkOrderForm.tsx")).toContain("ensureCloudCustomer");
    expect(read("src/components/workorders/WorkOrderForm.tsx")).toContain("!isUuid(resolvedVehicleId)");
    expect(read("src/lib/vehicleIdentity.ts")).toContain("customer_id must be a valid UUID");
    expect(read("src/pages/insurance/NewInsuranceClaim.tsx")).toContain("isUuid(draft.customerId)");
  });
});
