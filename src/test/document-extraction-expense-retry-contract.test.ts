import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("expense document partial-save recovery", () => {
  it("reuses the confirmed voucher ID when retrying a failed attachment", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/accounting/expenses/ExpenseFormPage.tsx"), "utf8");
    expect(source).toContain("savedExpenseIdRef.current=saved.id");
    expect(source).toContain("expenseId||savedExpenseIdRef.current||undefined");
    expect(source).toContain("لا تُعد إدخال المصروف؛ افتح السند وأضف المرفق");
    expect(source).toContain("if(!attachments.some((item:any)=>item.path===uploaded.path&&item.bucket===uploaded.bucket))");
    expect(source).toContain("if(Object.keys(data).length===0)");
  });
});
