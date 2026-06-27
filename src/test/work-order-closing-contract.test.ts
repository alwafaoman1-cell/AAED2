import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("work order closing review contract", () => {
  it("blocks final status changes behind the financial closing review", () => {
    const dialog = read("src/components/workorders/WorkOrderStatusDialog.tsx");
    const review = read("src/components/workorders/WorkOrderClosingReview.tsx");

    expect(dialog).toContain("isClosingStatus");
    expect(dialog).toContain("requiresClosingReview");
    expect(dialog).toContain("if (!closingReview)");
    expect(dialog).toContain("patch.closingReview");
    expect(review).toContain("Work Order Closing Review");
    expect(review).toContain("finalCostSource");
  });

  it("enforces invoice creation or approved skip before closure", () => {
    const review = read("src/components/workorders/WorkOrderClosingReview.tsx");

    expect(review).toContain("Create Invoice Now");
    expect(review).toContain("Skip Invoice with Manager Approval");
    expect(review).toContain("skipInvoiceReason");
    expect(review).toContain("canApproveSkip");
    expect(review).toContain("logActivity");
    expect(review).toContain("work_order_closing_audit");
    expect(review).toContain("snapshot");
    expect(review).toContain("manualReason");
    expect(review).toContain("skipInvoiceReason");
    expect(read("src/lib/workOrdersStore.ts")).toContain("closingReview: r.metadata?.closingReview");
  });
});

describe("invoice reminder reporting contract", () => {
  it("adds overdue invoice and completed-without-invoice reports", () => {
    const app = read("src/App.tsx");
    const reports = read("src/pages/Reports.tsx");
    const migration = read("supabase/migrations/20260626112000_work_order_closing_and_reminders.sql");

    expect(app).toContain("/reports/completed-without-invoice");
    expect(app).toContain("/reports/overdue-invoices");
    expect(reports).toContain("completed-without-invoice");
    expect(reports).toContain("overdue-invoices");
    expect(migration).toContain("completed_work_orders_without_invoice_view");
    expect(migration).toContain("overdue_invoices_view");
    expect(migration).toContain("message_logs");
  });

  it("prevents duplicate payment reminders within the configured frequency window", () => {
    const reminders = read("src/lib/accounting/reminders.ts");
    const messages = read("src/pages/MessagesCenter.tsx");

    expect(reminders).toContain("frequencyHours");
    expect(reminders).toContain("payment_reminder");
    expect(reminders).toContain("message_logs");
    expect(messages).toContain("composeType === \"payment_reminder\"");
  });
});
