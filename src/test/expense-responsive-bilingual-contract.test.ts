import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("expense pages responsive bilingual layout", () => {
  for (const path of [
    "src/pages/accounting/expenses/ExpenseCategoriesPage.tsx",
    "src/pages/accounting/expenses/ExpensesManagementPage.tsx",
  ]) {
    it(`${path} follows RTL/LTR and mobile/desktop layout contracts`, () => {
      const source = read(path);
      expect(source).toContain('dir={isAr ? "rtl" : "ltr"}');
      expect(source).toMatch(/md:grid-cols-/);
      expect(source).toContain("overflow-x-auto");
      expect(source).toContain("flex-wrap");
    });
  }

  for (const path of [
    "src/pages/accounting/expenses/ExpenseFormPage.tsx",
    "src/pages/accounting/expenses/ExpenseCategoryFormPage.tsx",
  ]) {
    it(`${path} switches form direction and collapses to one mobile column`, () => {
      const source = read(path);
      expect(source).toMatch(/dir=\{isAr\s*\?\s*['\"]rtl['\"]\s*:\s*['\"]ltr['\"]\}/);
      expect(source).toMatch(/md:grid-cols-/);
      expect(source).toContain("p-4 md:p-6");
    });
  }
});
