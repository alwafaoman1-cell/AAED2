import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("work order invoice and payment synchronization", () => {
  it("loads linked cash and insurance invoices with their real payments", () => {
    const source = read("src/lib/workOrderFinancials.ts");
    expect(source).toContain('from("sales_documents"');
    expect(source).toContain('from("insurance_invoices"');
    expect(source).toContain('from("sales_payments"');
    expect(source).toContain('from("claim_payments"');
    expect(source).toContain('.eq("tenant_id", tenantId)');
    expect(source).toContain("job_order_id.eq.");
    expect(source).toContain("auto_job_order_id.eq.");
  });

  it("uses the cloud financial snapshot in closing review and work order detail", () => {
    const closing = read("src/components/workorders/WorkOrderClosingReview.tsx");
    const detail = read("src/pages/WorkOrderDetail.tsx");
    const realtime = read("src/hooks/useRealtimeSync.ts");
    expect(closing).toContain("useWorkOrderFinancials(order)");
    expect(closing).toContain("الفواتير المرتبطة فعليًا");
    expect(closing).toContain("إضافة عملية دفع");
    expect(detail).toContain("useWorkOrderFinancials(order)");
    expect(detail).toContain("payableFinancialInvoice");
    expect(realtime).toContain('"work_order_financials"');
    expect(realtime).toContain('"insurance_invoices", "claim_payments", "sales_documents", "sales_payments"');
  });

  it("writes payments through the existing invoice-specific services", () => {
    const dialog = read("src/components/payments/UnifiedAddPaymentDialog.tsx");
    const sales = read("src/lib/salesStore.ts");
    expect(dialog).toContain("salesStore.refreshOne(selected.invoiceId)");
    expect(dialog).toContain("salesStore.addPayment(selected.invoiceId");
    expect(dialog).toContain("createClaimPayment.mutateAsync");
    expect(sales).toContain("refreshSalesDocumentFromCloud");
  });
});
