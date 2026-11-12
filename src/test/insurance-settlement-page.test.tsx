// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import type { SettlementReportRow } from "@/lib/insuranceSettlementReport";
const state = vi.hoisted(() => ({ data: [] as SettlementReportRow[], error: false, fetching: false, exportExcel: vi.fn(), refresh: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "t1", user_id: "u1", role: "admin" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data, isError: state.error, isFetching: state.fetching, refetch: state.refresh }) }));
vi.mock("@/lib/insuranceSettlementService", () => ({ fetchSettlementReport: vi.fn() }));
vi.mock("@/lib/insuranceSettlementExport", async importOriginal => ({ ...await importOriginal<object>(), exportSettlementXlsx: state.exportExcel }));
import InsuranceSettlementReport from "@/pages/insurance/InsuranceSettlementReport";
const draw = () => render(<MemoryRouter><InsuranceSettlementReport /></MemoryRouter>);
beforeEach(async () => {
  await i18n.changeLanguage("en"); state.error = false; state.fetching = false; state.exportExcel.mockClear();
  state.data = Array.from({ length: 27 }, (_, n) => ({ invoiceId: `i${n}`, claimId: `c${n}`, invoiceNumber: `INV-${n}`, invoiceDate: "2026-07-01", claimNumber: `C-${n}`, company: "Insurer",
    plate: String(n), vehicle: "Car", total: 105, paid: 95, recordedDiscount: 10, verifiedDiscount: 10, difference: 0, remaining: 0, discountPercent: 9.524,
    settlementDates: ["2026-07-20"], paymentNumbers: `IP-${n}`, reasons: "Early settlement", approvers: "manager", issues: [] }));
});
afterEach(cleanup);
describe("settlement report interface", () => {
  it("paginates the screen but exports every filtered row, never only the page", async () => {
    draw();
    expect(screen.getAllByRole("link", { name: /^INV-/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(state.exportExcel).toHaveBeenCalledTimes(1));
    expect(state.exportExcel.mock.calls[0][0]).toHaveLength(27);
    fireEvent.change(screen.getByRole("textbox", { name: /Search invoice/ }), { target: { value: "INV-26" } });
    expect(screen.getAllByRole("link", { name: /^INV-/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(state.exportExcel).toHaveBeenCalledTimes(2));
    expect(state.exportExcel.mock.calls[1][0]).toHaveLength(1);
  });
  it.each(["error", "fetching"])("withholds stale totals and exports while %s", kind => {
    if (kind === "error") state.error = true; else state.fetching = true;
    draw();
    expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
    expect(screen.queryByText("270.000 OMR")).toBeNull();
    expect(screen.getByRole(kind === "error" ? "alert" : "status")).toBeTruthy();
  });
  it("withholds exports for an inverted period and clears filters", () => {
    draw();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("start date");
    expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeEnabled();
  });
});
