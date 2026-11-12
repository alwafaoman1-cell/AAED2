import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const page = readFileSync("src/pages/WorkOrderDetail.tsx", "utf8");
describe("work-order detail resource boundaries", () => {
  it("uses one canonical record reader, not an independent partial adapter or full-table startup", () => {
    const hook = readFileSync("src/hooks/useWorkOrderDetailRecord.ts", "utf8");
    expect(page).toContain("useWorkOrderDetailRecord(id, profile?.tenant_id)");
    expect(hook).toContain("fetchWorkOrderFromCloudByIdentifier(id)"); expect(hook).toContain("{ loadAll: false }");
    expect(page).not.toContain("const adapted: WorkOrder"); expect(page).not.toContain("expensesStore.refresh()");
    expect(page).toContain("const expensesReady = orderExpensesQuery.isSuccess");
    expect(page).toContain('"work_order", profile?.tenant_id');
  });
  it.each([
    ["WorkOrderStatusDialog", "statusOpen"], ["StagePhotosDialog", "photosOpen"],
    ["WorkOrderBulkExpenseDialog", "expenseOpen"], ["WorkOrderExpenseDialog", "convertPart"],
    ["WorkOrderExpenseDialog", "editingExpense"], ["WhatsAppCenter", "waOpen"],
    ["ExpensePreviewDialog", "previewExpense"], ["QrLabel", "qrOpen"],
    ["PdfPreviewDialog", "previewOpen"], ["UnifiedAddPaymentDialog", "paymentInvoice"],
  ])("keeps %s available, importing and mounting it only for its explicit %s action", (component, state) => {
    expect(page).toMatch(new RegExp(`const ${component} = lazy\\(`));
    expect(page).toContain(`{${state} && <${component}`);
  });
  it("passes the confirmed scoped vouchers into the edit form without depending on a hydrated global expense archive", () => {
    expect(page).toContain("linkedExpenseVouchers={linkedVouchers}");
    const form = readFileSync("src/components/workorders/WorkOrderForm.tsx", "utf8");
    expect(form).toContain("linkedExpenseVouchers ?? getExpensesForWorkOrder(initial)");
    expect(form).toContain("receivedAt: form.receivedAt || (isEdit ? undefined : new Date().toISOString())");
    const store = readFileSync("src/lib/workOrdersStore.ts", "utf8");
    expect(store).toContain("vehicle_received_at: saved.receivedAt || undefined");
  });
  it("preserves every existing action and keeps printing on demand", () => {
    for (const action of ["handlePrintWorkOrder", "handlePrintNeededParts", "handleDownloadPhotosPdf", "saveLaborCharges", "restoreWorkOrderFromTrash(order)", "archiveWorkOrder(order", "paymentTargetFromWorkOrderInvoice", "updateNeededPartInOrder", "VehicleVisitBadge", "ApprovalHistoryTab", "SupplementsSection", "CustomerPortalLink", "SmartCustomerSendBar"]) expect(page).toContain(action);
    expect(page).not.toMatch(/^import .*from "@\/lib\/pdfGenerator"/m);
    expect(page).toContain("getWorkOrderHtml"); expect(page).toContain("generator.getNeededPartsRequestHtml");
    expect(page).toContain("onClick={retryLoad}");
  });
});
