// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import WorkOrderPickerDialog from "@/components/workorders/WorkOrderPickerDialog";

const fetchPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/workOrdersStore", () => ({ fetchWorkOrderListPage: fetchPage }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { dir: () => "ltr" } }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

function result(page: number, totalRows = 51) {
  return {
    rows: [{ id: `WO-C-26-000${page}`, customer: `Customer ${page}`, status: "تحت الفحص", vehicleType: "Toyota", model: "Corolla", plate: "123" }],
    pagination: { page, pageSize: 50, totalRows, totalPages: 2 },
  };
}

function renderPicker(open: boolean, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <WorkOrderPickerDialog open={open} onOpenChange={vi.fn()} onPick={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("work order picker cloud reads", () => {
  let client: QueryClient;
  beforeEach(() => {
    fetchPage.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => { cleanup(); client.clear(); });

  it("does not fetch work orders while closed, then reads only one server page", async () => {
    fetchPage.mockResolvedValue(result(1));
    const view = renderPicker(false, client);
    expect(fetchPage).not.toHaveBeenCalled();
    view.rerender(<QueryClientProvider client={client}><WorkOrderPickerDialog open onOpenChange={vi.fn()} onPick={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText("WO-C-26-0001")).toBeTruthy();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", page: 1, pageSize: 50 }));
  });

  it("keeps older work orders reachable through server pagination", async () => {
    fetchPage.mockImplementation(({ page }: { page: number }) => Promise.resolve(result(page)));
    renderPicker(true, client);
    expect(await screen.findByText("WO-C-26-0001")).toBeTruthy();
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("WO-C-26-0002")).toBeTruthy();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50 })));
  });

  it("shows a real loading error, not an empty-result success", async () => {
    fetchPage.mockRejectedValue(new Error("network"));
    renderPicker(true, client);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load work orders");
    expect(screen.queryByText("No matching work orders")).toBeNull();
  });

  it("hides stale rows while a new search is settling", async () => {
    fetchPage.mockResolvedValue(result(1));
    renderPicker(true, client);
    expect(await screen.findByText("WO-C-26-0001")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Example: WO-C/), { target: { value: "different customer" } });
    expect(screen.getByText("Searching…")).toBeTruthy();
    expect(screen.queryByText("WO-C-26-0001")).toBeNull();
  });
});
