import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateWorkOrderExpenseParts } from "@/lib/expenses/validateWorkOrderExpenseParts";

const dialog = readFileSync(resolve(process.cwd(), "src/components/workorders/WorkOrderBulkExpenseDialog.tsx"), "utf8");

describe("work-order bulk expense save validation", () => {
  it("rejects an empty part list and a priced part without a name before saving", () => {
    expect(validateWorkOrderExpenseParts([])).toContain("قطعة غيار");
    expect(validateWorkOrderExpenseParts([{ name: "", quantity: "1", unitBuyPrice: "15.8" }])).toContain("اسم القطعة");
  });

  it("rejects invalid quantities and purchase prices without skipping a line", () => {
    const part = { name: "مصباح أمامي", quantity: "1", unitBuyPrice: "15.8" };
    expect(validateWorkOrderExpenseParts([{ ...part, quantity: "0" }])).toContain("كمية");
    expect(validateWorkOrderExpenseParts([{ ...part, quantity: "abc" }])).toContain("كمية");
    expect(validateWorkOrderExpenseParts([{ ...part, unitBuyPrice: "" }])).toContain("سعر شراء");
    expect(validateWorkOrderExpenseParts([{ ...part, unitBuyPrice: "-1" }])).toContain("سعر شراء");
    expect(validateWorkOrderExpenseParts([part, { ...part, name: " " }])).toContain("القطعة 2");
  });

  it("accepts valid Arabic and English part rows", () => {
    expect(validateWorkOrderExpenseParts([
      { name: "مصباح أمامي", quantity: "1", unitBuyPrice: "15.8" },
      { name: "Front bumper", quantity: "2", unitBuyPrice: "4.5" },
    ])).toBeNull();
  });

  it("never reports success for zero saved vouchers or an estimated total", () => {
    expect(dialog).toContain("validateWorkOrderExpenseParts(it.parts)");
    expect(dialog).toContain("if (savedCount === 0)");
    expect(dialog).toContain("savedTotal += saved.amount");
    expect(dialog).toContain("حُفظ ${savedCount} سند بإجمالي ${savedTotal.toLocaleString()}");
    expect(dialog).not.toContain("if (qty <= 0 || !p.name.trim()) continue");
  });
});
