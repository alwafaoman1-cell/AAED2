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
});
