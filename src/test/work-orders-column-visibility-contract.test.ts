import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/WorkOrders.tsx"), "utf8");

describe("work orders column visibility", () => {
  it("offers every work-order data column in a persisted selector", () => {
    expect(source).toContain("WORK_ORDER_COLUMNS");
    expect(source).toContain("work_orders_visible_columns_v2");
    expect(source).toContain("DropdownMenuCheckboxItem");
    expect(source).toContain('key: "orderType"');
    expect(source).toContain('key: "orderNumber"');
    expect(source).toContain('key: "customer"');
    expect(source).toContain('key: "vehicle"');
    expect(source).toContain('key: "plate"');
    expect(source).toContain('key: "service"');
    expect(source).toContain('key: "technician"');
    expect(source).toContain('key: "entryDate"');
    expect(source).toContain('key: "daysInWorkshop"');
    expect(source).toContain('key: "phone"');
    expect(source).toContain('key: "insuranceCompany"');
    expect(source).toContain('key: "claimNumber"');
    expect(source).toContain('key: "vin"');
    expect(source).toContain('key: "neededParts"');
    expect(source).toContain('key: "status"');
    expect(source).toContain('key: "cost"');
  });

  it("applies the same visibility preference to desktop rows and mobile cards", () => {
    expect(source).toContain('isColumnVisible("orderNumber")');
    expect(source).toContain('isColumnVisible("vehicle")');
    expect(source).toContain('isColumnVisible("technician")');
    expect(source).toContain('isColumnVisible("cost")');
    expect(source).toContain("WORK_ORDER_COLUMNS.map((column) => isColumnVisible(column.key)");
  });

  it("keeps selection and actions outside the optional columns", () => {
    expect(source).toContain("selectedIds.has(order.id)");
    expect(source).toContain("إجراءات الأمر");
    expect(source).not.toContain('key: "actions"');
    expect(source).not.toContain('key: "selection"');
  });

  it("distinguishes cash work orders without changing the insurance marker", () => {
    expect(source).toContain("data-work-order-kind");
    expect(source).toContain('isInsurance ? "insurance" : "cash"');
    expect(source).toContain("border-r-emerald-500/70");
    expect(source).toContain("<Banknote");
    expect(source).toContain('isArabic ? "كاش" : "CASH"');
    expect(source).toContain("{isInsurance && (");
  });
});
