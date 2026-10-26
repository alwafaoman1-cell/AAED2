// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalNotesPending from "@/components/workorders/PortalNotesPending";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  limit: vi.fn(),
  from: vi.fn(),
  getTenant: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getTenant }));

beforeEach(() => {
  mocks.eq.mockReset();
  mocks.limit.mockReset();
  mocks.from.mockReset();
  mocks.getTenant.mockReset().mockResolvedValue("tenant-1");
  const query = { select: () => query, eq: mocks.eq, order: () => query, limit: mocks.limit };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});

describe("customer portal note read", () => {
  it("isolates notes to the active tenant and work order", async () => {
    mocks.limit.mockResolvedValue({ data: [{ id: "note-1", note: "Test note", status: "pending", customer_name: null, submitted_at: "2026-10-20" }], error: null });
    render(<PortalNotesPending jobOrderId="order-1" />);
    await waitFor(() => expect(screen.getByText("Test note")).toBeTruthy());
    expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(mocks.eq).toHaveBeenCalledWith("job_order_id", "order-1");
  });

  it("shows a read failure instead of hiding customer notes", async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { message: "RLS denied" } });
    render(<PortalNotesPending jobOrderId="order-2" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("RLS denied"));
  });
});
