// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const mocks = vi.hoisted(() => ({ mode: "allFailed", refetch: vi.fn(), export: vi.fn(), error: vi.fn(), permission: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "offline-tenant", role: "admin" } }) }));
vi.mock("react-i18next", async (importOriginal) => ({ ...await importOriginal<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/lib/accounting/monthlyVehicleProfitability", () => ({ fetchAllMonthlyVehicleProfitabilityRows: mocks.export, fetchMonthlyVehicleProfitability: vi.fn(), monthlyVehicleProfitabilityKeys: { report: () => ["vehicles"] } }));
vi.mock("@/lib/accounting/monthlyWorkshopReport", () => ({ fetchMonthlyWorkshopOverheads: vi.fn(), monthlyWorkshopReportKeys: { overheads: () => ["overheads"] } }));
vi.mock("@/lib/reports-center/reportExportService", () => ({ exportReportRowsToPdf: mocks.export, exportReportRowsToXlsx: mocks.export, printReportRows: mocks.export }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => {
  const success = mocks.mode === "mixed" && queryKey[0] === "vehicles";
  return { isSuccess: success, isError: !success, isLoading: false, error: success ? null : new Error("offline source"), refetch: mocks.refetch,
    data: success ? { rows: [], aggregates: { gross_profit: 20 }, pagination: { totalRows: 0, totalPages: 0 } } : undefined };
} }));
vi.mock("@/lib/accounting/accountingAdministrationService", () => ({ hasAccountingPermission: mocks.permission }));
import MonthlyVehicleProfitabilityPage from "@/pages/accounting/reports/MonthlyVehicleProfitabilityPage";
beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.mode = "allFailed"; });
describe("monthly report confirmed-source rendering", () => {
  it.each(["allFailed", "mixed"])("shows a recoverable error instead of substitute balances when %s", (mode) => {
    mocks.mode = mode;
    render(<MemoryRouter><MonthlyVehicleProfitabilityPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("reportSafety.monthlyFailure");
    expect(screen.getByRole("button", { name: "reportSafety.monthlyRetry" })).toBeVisible();
    expect(screen.queryByText("صافي ربح/خسارة الشهر")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/0\.000/)).toHaveLength(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("blocks an export while overheads are unconfirmed and retries all sources", async () => {
    mocks.mode = "mixed";
    render(<MemoryRouter><MonthlyVehicleProfitabilityPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("reportSafety.monthlyFailure"));
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "reportSafety.monthlyRetry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(3);
  });
});
