import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("confirmed save and page loading feedback", () => {
  it("shows a circular route loader and a React Query mutation indicator", () => {
    const app = read("src/App.tsx");
    const status = read("src/components/GlobalMutationStatus.tsx");
    expect(app).toContain("<Suspense fallback={<RouteFallback />}>");
    expect(app).toContain("<Loader2");
    expect(app).toContain("<GlobalMutationStatus />");
    expect(status).toContain("useIsMutating()");
    expect(status).not.toContain("toast.success");
  });

  it("blocks repeated work-order expense saves while the first save is pending", () => {
    for (const path of [
      "src/components/workorders/WorkOrderBulkExpenseDialog.tsx",
      "src/components/workorders/WorkOrderExpenseDialog.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("if (savingRef.current) return;");
      expect(source).toContain("aria-busy={saving}");
      expect(source).toContain("<Loader2");
    }
  });

  it("verifies persisted expense linkage and reports partial attachment saves", () => {
    expect(read("src/lib/expenses/expenseClassificationService.ts"))
      .toContain('data.work_order_id !== input.work_order_id');
    const form = read("src/pages/accounting/expenses/ExpenseFormPage.tsx");
    expect(form).toContain("لا تُعد إدخال المصروف؛ افتح السند وأضف المرفق");
    expect(form).toContain("aria-busy={save.isPending}");
  });
});
