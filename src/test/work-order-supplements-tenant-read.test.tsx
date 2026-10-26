// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SupplementsSection from "@/components/workorders/SupplementsSection";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  order: vi.fn(),
  from: vi.fn(),
  getTenant: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
vi.mock("@/lib/cloud/createCloudStore", () => ({
  getCurrentTenantId: mocks.getTenant,
}));
vi.mock("@/lib/partsWhatsApp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/vehicleMediaUrls", () => ({
  canonicalMediaReference: (ref: string) => ref,
  resolveImageReferences: vi.fn().mockResolvedValue([]),
}));

const orderId = "52c890fa-2f6d-47fa-b194-3d57492135ad";

beforeEach(() => {
  mocks.eq.mockReset();
  mocks.order.mockReset();
  mocks.from.mockReset();
  mocks.getTenant.mockReset().mockResolvedValue("tenant-1");
  const query = { select: () => query, eq: mocks.eq, order: mocks.order };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});

describe("work-order supplements tenant read", () => {
  it("reads supplements for the current tenant and work order only", async () => {
    mocks.order.mockResolvedValue({ data: [], error: null });
    render(<SupplementsSection jobOrderId={orderId} />);
    await waitFor(() => expect(screen.getByText(/لا توجد أعمال إضافية بعد/)).toBeTruthy());
    expect(mocks.from).toHaveBeenCalledWith("work_order_supplements");
    expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(mocks.eq).toHaveBeenCalledWith("job_order_id", orderId);
  });

  it("does not turn a cloud read failure into a false empty list", async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: "RLS denied" } });
    render(<SupplementsSection jobOrderId={orderId} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("RLS denied"));
    expect(screen.queryByText(/لا توجد أعمال إضافية بعد/)).toBeNull();
  });
});
