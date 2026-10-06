import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "src/pages/accounting/Receipts.tsx"), "utf8");
const sales = readFileSync(resolve(process.cwd(), "src/lib/salesStore.ts"), "utf8");
const auth = readFileSync(resolve(process.cwd(), "src/contexts/AuthContext.tsx"), "utf8");

describe("receipt confirmation and session-safe refresh", () => {
  it("requires a database-returned row before success for receipt changes", () => {
    expect(page).toContain('if (!updated?.id) return toast.error("لم يتم تحديث السند');
    expect(page).toContain('if (!archived?.id) return toast.error("لم يتم أرشفة السند');
    expect(page).toContain("if (!inserted?.id || inserted.receipt_number !== number)");
    expect(page).toContain("(archived || []).length !== ids.length");
    expect(page).toContain("if (savingRef.current) return");
    expect(page).toContain('disabled={saving}');
  });

  it("does not apply a targeted sales refresh from a former session", () => {
    const start = sales.indexOf("async function refreshSalesDocumentFromCloud(");
    const end = sales.indexOf("function scheduleSalesRefresh(", start);
    const body = sales.slice(start, end);
    expect(body).toContain("const generation = salesSessionGeneration");
    expect(body).toContain("generation !== salesSessionGeneration");
    expect(body.indexOf("if (generation !== salesSessionGeneration) return null;"))
      .toBeLessThan(body.indexOf("const next = read()"));
  });

  it("does not claim a cash-invoice draft was saved when tenant or cloud confirmation is missing", () => {
    expect(sales).toContain('if (!tenantId) throw new Error("تعذّر تحديد المؤسسة؛ لم تُحفظ الفاتورة في السحابة")');
    expect(sales).toContain('if (!data) throw new Error("لم تؤكد قاعدة البيانات حفظ الفاتورة")');
    expect(sales).toContain("const saved = await upsertSalesCloud(draft)");
    expect(sales).not.toContain("const saved = cloud || draft");
  });

  it("clears prior tenant query data on logout or user switch", () => {
    expect(auth).toContain("if (previousUserId && previousUserId !== nextUserId) {");
    expect(auth).toContain("queryClient.clear()");
  });
});
