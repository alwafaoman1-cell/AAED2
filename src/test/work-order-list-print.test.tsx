// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(), all: vi.fn(), selected: vi.fn(), one: vi.fn(),
  ensure: vi.fn(), qr: vi.fn(), error: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-a" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ar" } }) }));
vi.mock("sonner", () => ({ toast: { error: api.error, success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/workOrdersStore", () => ({
  getWorkOrders: () => [], fetchWorkOrderListPage: api.list, fetchAllWorkOrderListRows: api.all,
  deleteWorkOrder: vi.fn(), refreshWorkOrdersFromCloud: vi.fn(), subscribeWorkOrders: () => () => {},
  updateWorkOrderInCloud: vi.fn(), WORK_ORDER_STATUSES: ["تحت الفحص", "تحت الإصلاح", "تم التسليم"],
  normalizeWorkOrderStatus: (status: string) => status, isPartStillNeeded: () => false,
}));
vi.mock("@/lib/workOrderListActions", () => ({
  resolveSelectedWorkOrderActions: api.selected, resolveWorkOrderListAction: api.one,
  resolveSelectedWorkOrderExport: vi.fn(),
}));
vi.mock("@/lib/customerPortalTokens", () => ({ ensureCustomerPortalToken: api.ensure }));
vi.mock("qrcode", () => ({ default: { toDataURL: api.qr } }));
vi.mock("@/lib/cloudSettings", () => ({
  readCloudSetting: async (_key: string, fallback: unknown) => fallback,
  subscribeCloudSetting: () => () => {}, writeCloudSetting: vi.fn(),
}));
vi.mock("@/lib/printTemplates/resolver", () => ({ renderWithCustomTemplate: () => null }));
vi.mock("@/lib/publicAccessSettingsStore", () => ({ buildPublicUrl: (url: string) => `https://example.test${url}` }));
vi.mock("@/lib/safePdfWindow", () => ({ openSanitizedPdfWindow: vi.fn() }));
vi.mock("@/lib/staffStore", () => ({ staffStore: { getAll: () => [] } }));
vi.mock("@/lib/partsWhatsApp", () => ({ buildPartsRequestMessage: vi.fn(), sendWhatsAppAndLog: vi.fn() }));
vi.mock("@/lib/inspectionsStore", () => ({ fetchInspectionCountsForOrders: async () => ({}) }));
vi.mock("@/lib/trashStore", () => ({ moveToTrash: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canDelete: () => false, canEdit: () => false }));
vi.mock("@/lib/auditLogStore", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/deletePolicy", () => ({
  archiveWorkOrder: vi.fn(), deleteWorkOrderKeepFinancial: vi.fn(),
  deleteWorkOrderWithRelated: vi.fn(), getWorkOrderImpact: vi.fn(),
}));
vi.mock("@/lib/expensesStore", () => ({ fetchExpensesForWorkOrder: async () => [] }));
vi.mock("@/lib/workOrderInvoiceIndicators", () => ({ fetchWorkOrderInvoiceIndicators: async () => ({}) }));
vi.mock("@/components/vehicles/VehicleAvatar", () => ({ default: () => null }));
vi.mock("@/components/workorders/WorkOrderInvoiceBadge", () => ({ default: () => null }));
vi.mock("@/components/ConfirmDeleteDialog", () => ({ default: () => null }));
vi.mock("@/components/workorders/WorkOrderForm", () => ({ default: () => null }));
vi.mock("@/components/PdfPreviewDialog", () => ({
  default: ({ htmlContent, title }: { htmlContent: string; title: string }) => (
    <section role="dialog" aria-label={title}><div data-testid="printed-orders" dangerouslySetInnerHTML={{ __html: htmlContent }} /></section>
  ),
}));

import WorkOrders from "@/pages/WorkOrders";

// First record deliberately has no linked vehicle/visit. Printing remains valid.
const full = [
  {
    id: "WO-C-26-0001", cloudId: "11111111-1111-4111-8111-111111111111", vehicleId: null,
    customer: "Full legacy customer", phone: "90000001", plate: "AA 1001", vehicleType: "Toyota", model: "Camry", year: "2022",
    entryDate: "2026-11-22", status: "تحت الفحص", serviceType: "Body repair", technician: "Demo technician", totalCost: 20,
    workOrderType: "general_customer", laborCost: 20, partsCost: 0, depositApplied: 0, trackingToken: "legacy-token",
    workItems: [{ title: "Legacy bumper repair", note: "Full record note A" }], partsNeeded: [{ name: "Legacy bumper", quantity: 1 }],
  },
  {
    id: "WO-I-26-0002", cloudId: "22222222-2222-4222-8222-222222222222", vehicleId: "vehicle-b",
    customer: "Full insured customer", phone: "90000002", plate: "BB 1002", vehicleType: "Nissan", model: "Altima", year: "2021",
    entryDate: "2026-11-22", status: "تحت الإصلاح", serviceType: "Body repair", technician: "Demo technician", totalCost: 200,
    workOrderType: "insurance", claimId: "claim-b", insurance: "Demo insurer", claimNumber: "CLAIM-B", trackingToken: "old-token-b",
    workItems: [{ title: "Insured door repair", note: "Full record note B" }], partsNeeded: [{ name: "Insured door", quantity: 2 }],
  },
];
const summaries = full.map((order, index) => ({ ...order, customer: `Summary customer ${index + 1}`, summaryOnly: true, workItems: [], partsNeeded: [] }));
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  api.ensure.mockRejectedValue(new Error("PORTAL_VEHICLE_REQUIRED"));
  api.list.mockResolvedValue({
    rows: summaries, pagination: { page: 1, pageSize: 20, totalRows: 2, totalPages: 1 },
    summary: { total: 2, cash: 1, insurance: 1, needingParts: 0 },
    filterOptions: { technicians: [], services: [], insuranceCompanies: [] },
  });
  api.all.mockResolvedValue(full);
  api.selected.mockImplementation(async (ids: string[]) => ids.map(id => full.find(order => order.id === id)));
  api.one.mockImplementation(async (row: { id: string }) => full.find(order => order.id === row.id));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

async function openList() {
  render(<MemoryRouter><QueryClientProvider client={client}><WorkOrders /></QueryClientProvider></MemoryRouter>);
  await waitFor(() => expect(within(screen.getByRole("table")).getByText("Summary customer 1")).toBeVisible());
  return within(screen.getByRole("table"));
}

function expectCompleteBatch() {
  const output = screen.getByTestId("printed-orders");
  expect(output.querySelectorAll(".wo-document")).toHaveLength(2);
  expect(output).toHaveTextContent("Full legacy customer");
  expect(output).toHaveTextContent("Full insured customer");
  expect(output).toHaveTextContent("Legacy bumper repair");
  expect(output).toHaveTextContent("Insured door repair");
  expect(output).toHaveTextContent("Full record note A");
  expect(output).toHaveTextContent("Full record note B");
  expect(output).not.toHaveTextContent("Summary customer");
  expect(api.ensure).not.toHaveBeenCalled();
  expect(api.qr).not.toHaveBeenCalled();
  expect(api.error).not.toHaveBeenCalled();
}

describe("work-order printing does not require creating a customer portal", () => {
  it("prints multiple selected full orders even when one cannot have a portal", async () => {
    const table = await openList();
    const rows = table.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[0]).getByRole("checkbox"));
    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "طباعة" }));
    await screen.findByRole("dialog", { name: "طباعة 2 أمر عمل" });
    expect(api.selected).toHaveBeenCalledExactlyOnceWith([full[0].id, full[1].id], "tenant-a");
    expectCompleteBatch();
  });

  it("prints all matching orders without generating portal links or mutating a record", async () => {
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "طباعة الكل (2)" }));
    await screen.findByRole("dialog", { name: "طباعة 2 أمر عمل" });
    expect(api.all).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", search: "" }));
    expect(api.selected).not.toHaveBeenCalled();
    expectCompleteBatch();
    expect(full[0]).toMatchObject({ vehicleId: null, trackingToken: "legacy-token" });
  });

  it("previews one full order from its list action without a portal prerequisite", async () => {
    const table = await openList();
    const firstRow = table.getAllByRole("row")[1];
    fireEvent.pointerDown(within(firstRow).getByRole("button", { name: "المزيد" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "طباعة / PDF" }));
    await screen.findByRole("dialog", { name: "أمر عمل WO-C-26-0001" });
    expect(api.one).toHaveBeenCalledExactlyOnceWith(summaries[0], "tenant-a");
    expect(screen.getByTestId("printed-orders")).toHaveTextContent("Legacy bumper repair");
    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.qr).not.toHaveBeenCalled();
    expect(api.error).not.toHaveBeenCalled();
  });

  it("shows an empty-result message when matching orders disappear before Print All", async () => {
    api.all.mockResolvedValueOnce([]);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "طباعة الكل (2)" }));
    await waitFor(() => expect(api.error).toHaveBeenCalledExactlyOnceWith("لا توجد أوامر للطباعة"));
    expect(api.all).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("printed-orders")).not.toBeInTheDocument();
    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.qr).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable selected record and refuses a partial print preview", async () => {
    api.selected.mockRejectedValueOnce(new Error("WORK_ORDER_UNAVAILABLE_REOPEN_LIST"));
    const table = await openList();
    const rows = table.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[0]).getByRole("checkbox"));
    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "طباعة" }));
    await waitFor(() => expect(api.error).toHaveBeenCalledExactlyOnceWith("WORK_ORDER_UNAVAILABLE_REOPEN_LIST"));
    expect(api.selected).toHaveBeenCalledExactlyOnceWith([full[0].id, full[1].id], "tenant-a");
    expect(screen.queryByTestId("printed-orders")).not.toBeInTheDocument();
    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.qr).not.toHaveBeenCalled();
  });
});
