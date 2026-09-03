import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const store = readFileSync(resolve(root, "src/lib/salesStore.ts"), "utf8");
const detail = readFileSync(resolve(root, "src/components/sales/SalesDocDetailPage.tsx"), "utf8");

describe("sales payment deletion persistence contract", () => {
  it("deletes the tenant-scoped cloud row and requires returned-row confirmation", () => {
    expect(store).toContain('supabase.from("sales_payments")');
    expect(store).toContain('.eq("sales_document_id", docId)');
    expect(store).toContain('.eq("id", paymentId)');
    expect(store).toContain('.select("id")');
    expect(store).toContain('if (!data?.id)');
  });

  it("keeps Supabase authoritative and refreshes invoice totals after deletion", () => {
    const start = store.indexOf("async removePayment(docId: string, paymentId: string)");
    const removePaymentBody = store.slice(start, store.indexOf("  addNote(", start));
    expect(store).toContain("await deleteSalesPaymentCloud(docId, paymentId)");
    expect(store).toContain("await refreshSalesDocumentFromCloud(docId)");
    expect(removePaymentBody).not.toContain("salesStore.upsert");
    expect(removePaymentBody).not.toContain("write(");
  });

  it("shows success only after the asynchronous delete succeeds", () => {
    expect(detail).toContain("await salesStore.removePayment(doc.id, paymentId)");
    expect(detail).toContain("تم حذف الدفعة فعليًا");
    expect(detail).toContain("تعذر حذف الدفعة");
  });
});
