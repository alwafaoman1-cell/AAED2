import { roundMoney } from "@/lib/money";

export interface WorkOrderCostIdentity {
  id: string;
  order_number?: string | null;
}

export interface WorkOrderExpenseCostRow {
  id: string;
  work_order_id?: string | null;
  linked_work_order_id?: string | null;
  amount?: number | string | null;
  total?: number | string | null;
  status?: string | null;
}

const INELIGIBLE_EXPENSE_STATUSES = new Set(["cancelled", "canceled", "void", "invalid", "deleted"]);

/**
 * Returns actual cash spent per job_orders.id, including recorded VAT.
 * Each expense row is counted once even when both the UUID and display number
 * are present on the same row.
 */
export function buildWorkOrderActualCostMap(
  workOrders: WorkOrderCostIdentity[],
  expenseRows: WorkOrderExpenseCostRow[],
): Map<string, number> {
  const orderIdByReference = new Map<string, string>();
  for (const order of workOrders) {
    const id = String(order.id || "").trim();
    const number = String(order.order_number || "").trim();
    if (!id) continue;
    orderIdByReference.set(id, id);
    orderIdByReference.set(`WO-${id}`, id);
    if (number) orderIdByReference.set(number, id);
  }

  const totals = new Map<string, number>();
  const countedExpenseIds = new Set<string>();
  for (const expense of expenseRows) {
    if (!expense.id || countedExpenseIds.has(expense.id)) continue;
    const status = String(expense.status || "active").toLowerCase();
    if (INELIGIBLE_EXPENSE_STATUSES.has(status)) continue;

    const workOrderId = [expense.work_order_id, expense.linked_work_order_id]
      .map((value) => String(value || "").trim())
      .map((reference) => orderIdByReference.get(reference))
      .find(Boolean);
    if (!workOrderId) continue;

    const recordedTotal = Number(expense.total);
    const amount = Number(expense.amount || 0);
    const actualCost = Number.isFinite(recordedTotal) && Math.abs(recordedTotal) > 0.0001
      ? recordedTotal
      : amount;
    totals.set(workOrderId, roundMoney((totals.get(workOrderId) || 0) + actualCost, 3));
    countedExpenseIds.add(expense.id);
  }
  return totals;
}
