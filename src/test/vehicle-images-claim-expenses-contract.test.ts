import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = () => process.cwd();
const read = (file: string) => readFileSync(resolve(root(), file), "utf8");

describe("vehicle images, claim detail, and expenses contract", () => {
  it("shows vehicle avatars in work orders and insurance claim pages", () => {
    expect(read("src/components/vehicles/VehicleAvatar.tsx")).toContain("loading=\"lazy\"");
    expect(read("src/pages/WorkOrders.tsx")).toContain("VehicleAvatar");
    expect(read("src/pages/WorkOrderDetail.tsx")).toContain("VehicleAvatar");
    expect(read("src/pages/insurance/InsuranceClaimsList.tsx")).toContain("VehicleAvatar");
    expect(read("src/pages/insurance/InsuranceClaimDetail.tsx")).toContain("Claim Management Center");
  });

  it("exposes the central expenses route and stores relational links", () => {
    expect(read("src/App.tsx")).toContain('path="/accounting/expenses"');
    const store = read("src/lib/expensesStore.ts");
    expect(store).toContain("customer_id");
    expect(store).toContain("vehicle_id");
    expect(store).toContain("claim_id");
    expect(store).toContain("invoice_id");
    expect(read("src/pages/accounting/ExpenseNew.tsx")).toContain("claim_id");
  });

  it("adds only non-destructive schema support", () => {
    const migration = read("supabase/migrations/20260627120000_vehicle_images_expense_links.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS vehicle_cover_image_url");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS claim_id");
    expect(migration.toLowerCase()).not.toContain("drop table");
    expect(migration.toLowerCase()).not.toContain("drop column");
  });
});
