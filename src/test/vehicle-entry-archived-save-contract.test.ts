import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intake visit customer selection", () => {
  it("does not replace the visit customer or contact with an existing vehicle's historical owner", () => {
    const source = readFileSync("src/pages/vehicle-entry/VehicleEntryForm.tsx", "utf8");
    const start = source.indexOf("function selectVehicle(vehicle:");
    const body = source.slice(start, source.indexOf("function addDamageMark", start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("vehicle_id: vehicle.id");
    expect(body).not.toContain("customer_id:");
    expect(body).not.toContain("customer_phone_before_edit:");
    expect(body).not.toContain("vehicle.customers");
    expect(body).not.toContain("delivered_by:");
  });
});
