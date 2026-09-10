import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/vehiclesStore.ts", "utf8");

describe("vehicle archive safety contract", () => {
  it("archives only the vehicle record and never mutates linked history", () => {
    const archiveStart = source.indexOf("export async function deleteVehicleFromCloud");
    const archiveEnd = source.indexOf("async function fetchVehiclesFromCloud", archiveStart);
    const implementation = source.slice(archiveStart, archiveEnd);

    expect(implementation).toContain('.from("vehicles")');
    expect(implementation).toContain("archived: true");
    for (const table of [
      "job_orders",
      "insurance_claims",
      "expenses",
      "sales_documents",
      "sales_payments",
      "claim_payments",
    ]) {
      expect(implementation).not.toContain(`from("${table}`);
    }
  });

  it("does not keep a cascading operational archive helper", () => {
    expect(source).not.toContain("archiveVehicleOperationalLinks");
    expect(source).not.toContain("[vehicle operational archive]");
  });
});
