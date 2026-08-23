import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("expense supplier picker", () => {
  it("uses the shared supplier picker on the classified expense form", () => {
    const form = read("src/pages/accounting/expenses/ExpenseFormPage.tsx");
    expect(form).toContain('import SupplierPicker from "@/components/suppliers/SupplierPicker"');
    expect(form).toContain("<SupplierPicker");
    expect(form).toContain("supplier_id:supplier.id");
    expect(form).not.toContain("searchSuppliers(tenantId");
  });

  it("searches suppliers server-side and always exposes quick add", () => {
    const picker = read("src/components/suppliers/SupplierPicker.tsx");
    expect(picker).toContain("loadTableSuppliers(debouncedQuery, supplierId)");
    expect(picker).toContain("term.length >= 2");
    expect(picker).toContain("tax_number.ilike");
    expect(picker).toContain("category.ilike");
    expect(picker).toContain("+ إضافة مورد جديد");
    expect(picker).toContain("ensureTableSupplier");
    expect(picker).toContain("المورد موجود مسبقًا وتم اختياره");
  });
});
