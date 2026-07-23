import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("data sync performance contract", () => {
  it("does not keep duplicate vehicles realtime in the legacy store", () => {
    const vehicles = read("src/lib/vehiclesStore.ts");
    const realtime = read("src/hooks/useRealtimeSync.ts");

    expect(realtime).toContain('tables: ["vehicles", "vehicle_media"]');
    expect(vehicles).not.toContain("vehicles_cloud_");
    expect(vehicles).not.toContain('table: "vehicles" }, () => scheduleVehiclesFetch');
  });

  it("does not use 5000-row legacy compatibility loads for active stores", () => {
    const vehicles = read("src/lib/vehiclesStore.ts");
    const workOrders = read("src/lib/workOrdersStore.ts");

    expect(vehicles).not.toContain(".limit(5000)");
    expect(workOrders).not.toContain(".limit(5000)");
    expect(vehicles).toContain(".limit(500)");
    expect(workOrders).toContain(".limit(500)");
  });

  it("does not start cloud sync as a side effect of importing active legacy stores", () => {
    const customers = read("src/lib/customersStore.ts");
    const vehicles = read("src/lib/vehiclesStore.ts");
    const workOrders = read("src/lib/workOrdersStore.ts");

    expect(customers).not.toContain("scheduleCustomersRefresh(0)");
    expect(customers).not.toContain("scheduleCustomersRefresh(500)");
    expect(vehicles).not.toContain("setTimeout(() => ensureVehiclesCloudSync(), 800)");
    expect(vehicles).not.toContain("scheduleVehiclesFetch(100)");
    expect(workOrders).not.toContain("setTimeout(() => ensureCloudSync(), 800)");
    expect(workOrders).not.toContain("scheduleCloudFetch(50)");
  });

  it("keeps explicit page-level refreshes for legacy compatibility lists", () => {
    const customersPage = read("src/pages/Customers.tsx");
    const vehiclesPage = read("src/pages/Vehicles.tsx");
    const workOrdersPage = read("src/pages/WorkOrders.tsx");

    expect(customersPage).toContain("refreshCustomersFromCloud");
    expect(vehiclesPage).toContain("refreshVehiclesFromCloud");
    expect(workOrdersPage).toContain("refreshWorkOrdersFromCloud");
  });
});
