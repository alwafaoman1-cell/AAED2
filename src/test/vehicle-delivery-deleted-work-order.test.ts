import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, auth: { getUser: mocks.getUser } },
}));

import { saveVehicleDeliveryReceiptDraft } from "@/lib/vehicleDeliveryReceipt";

const orderId = "1cccf6d3-5190-4c20-85a8-791ef574c5ef";

function jobOrderQuery(row: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(),
    limit: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  query.select.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("vehicle handover for a deleted work order", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getUser.mockReset();
  });

  it("rejects a soft-deleted order before any handover or metadata write", async () => {
    const query = jobOrderQuery({ id: orderId, deleted_at: "2026-10-10T04:31:26Z" });
    mocks.from.mockReturnValue(query);

    await expect(saveVehicleDeliveryReceiptDraft(
      { id: orderId, orderNumber: "WO-I-26-0057" },
      { receiverName: "Test recipient" },
    )).rejects.toThrow("أمر العمل محذوف في Supabase");

    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("deleted_at"));
    expect(query.eq).toHaveBeenCalledWith("id", orderId);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not call a missing order deleted", async () => {
    mocks.from.mockReturnValue(jobOrderQuery(null));

    await expect(saveVehicleDeliveryReceiptDraft(
      { id: orderId, orderNumber: "WO-I-26-0057" },
      { receiverName: "Test recipient" },
    )).rejects.toThrow("أمر العمل غير موجود في Supabase");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("prevents the delivery page and claim entry point from opening a deleted order", () => {
    const root = process.cwd();
    const page = fs.readFileSync(path.join(root, "src/pages/WorkOrderDeliveryPage.tsx"), "utf8");
    const claim = fs.readFileSync(path.join(root, "src/components/insurance/ClaimDeliverySection.tsx"), "utf8");

    expect(page).toContain("result?.deletedAt");
    expect(page).toContain("أمر العمل محذوف في Supabase");
    expect(claim).toContain("fetchWorkOrderFromCloudByIdentifier(workOrderId)");
    expect(claim).toContain("if (order.deletedAt)");
  });
});
