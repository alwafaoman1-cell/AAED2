import { describe, expect, it } from "vitest";
import {
  expenseBelongsToWorkOrder,
  type ExpenseRecord,
} from "@/lib/expensesStore";

const canonicalId = "6d1a9472-4cf0-4dd4-b0f2-32193754654c";

describe("work-order expense identity", () => {
  it("accepts a persisted expense by the canonical Supabase work-order id", () => {
    const expense = {
      canonicalWorkOrderId: canonicalId,
      linkedWorkOrderId: "WO-C-26-0126",
    } as ExpenseRecord;

    expect(expenseBelongsToWorkOrder(expense, {
      id: "WO-00126",
      cloudId: canonicalId,
      displayNumber: "WO-C-26-0126",
    })).toBe(true);
  });

  it("accepts the database-normalized visible number when the screen has no cloud id", () => {
    const expense = {
      linkedWorkOrderId: "WO-C-26-0126",
      sourceWorkOrderId: canonicalId,
    } as ExpenseRecord;

    expect(expenseBelongsToWorkOrder(expense, {
      id: "WO-C-26-0126",
      displayNumber: "WO-C-26-0126",
    })).toBe(true);
  });

  it("does not accept an expense linked to another work order", () => {
    const expense = {
      canonicalWorkOrderId: "1cc28930-6922-4cec-898a-9610734ec1c7",
      linkedWorkOrderId: "WO-C-26-0999",
    } as ExpenseRecord;

    expect(expenseBelongsToWorkOrder(expense, {
      id: "WO-C-26-0126",
      cloudId: canonicalId,
    })).toBe(false);
  });
});
