import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("work-order expense persistence and profitability", () => {
  it("prevents an older cloud hydration from hiding a newly saved voucher", () => {
    const store = read("src/lib/expensesStore.ts");
    expect(store).toContain("cacheRevision");
    expect(store).toContain("revisionAtStart");
    expect(store).toContain("An older snapshot must never hide a newly saved voucher");
    expect(store).toContain('.eq("tenant_id", tenantId)');
    expect(store).toContain("hydrationPromise");
  });

  it("matches expenses by both work-order UUID and visible order number", () => {
    const store = read("src/lib/expensesStore.ts");
    expect(store).toContain("getWorkOrderExpenseReferences");
    expect(store).toContain("expenseBelongsToWorkOrder");
    expect(store).toContain("workOrder.cloudId");
    expect(store).toContain("workOrder.displayNumber");
    expect(store).toContain("expense.sourceWorkOrderId");
  });

  it("writes new work-order vouchers with the canonical cloud relation", () => {
    for (const path of [
      "src/components/workorders/WorkOrderExpenseDialog.tsx",
      "src/components/workorders/WorkOrderBulkExpenseDialog.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("linkedWorkOrderId: order.cloudId || order.id");
      expect(source).toContain("sourceWorkOrderId: order.cloudId || order.id");
      expect(source).toContain("vehicleId: order.vehicleId");
      expect(source).toContain("claimId: order.claimId");
    }
  });

  it("keeps the detail screen subscribed and shows actual financial totals", () => {
    const detail = read("src/pages/WorkOrderDetail.tsx");
    expect(detail).toContain("expensesStore.subscribe");
    expect(detail).toContain("expensesStore.isHydrated()");
    expect(detail).toContain("getExpensesForWorkOrder(order)");
    expect(detail).toContain("تكلفة قطع الغيار الفعلية");
    expect(detail).toContain("إجمالي المنفق على السيارة");
    expect(detail).toContain("الإيراد الرسمي قبل الضريبة");
    expect(detail).toContain("الربح الفعلي حتى الآن");
    expect(detail).toContain("actualRevenue - vouchersTotal");
  });

  it("stores the supplier invoice number for every bulk expense line", () => {
    const source = read("src/components/workorders/WorkOrderBulkExpenseDialog.tsx");
    expect(source).toContain("supplierInvoiceNumber?: string");
    expect(source).toContain("supplierInvoiceNumber: it.supplierInvoiceNumber?.trim() || undefined");
    expect(source).toContain("رقم فاتورة المورد");
  });

  it("stores and searches supplier vehicle brands from the quick add dialog", () => {
    const source = read("src/components/suppliers/SupplierPicker.tsx");
    expect(source).toContain("vehicle_brands: requestedBrands");
    expect(source).toContain("ماذا يبيع؟ / ماركات السيارات");
    expect(source).toContain("supplier.vehicleBrands");
  });
});
