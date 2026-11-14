// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehicleEntrySignPage from "@/pages/public/VehicleEntrySignPage";
import VehicleInspectionReleaseSignPage from "@/pages/public/VehicleInspectionReleaseSignPage";
import CustomerPortal from "@/pages/CustomerPortal";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
beforeEach(() => { rpc.mockReset(); }); afterEach(cleanup);
describe("legacy customer pages preserve links without bearer data access", () => {
  it.each([VehicleEntrySignPage, VehicleInspectionReleaseSignPage, CustomerPortal])("never renders legacy data if the resolver cannot confirm a portal", async Page => {
    rpc.mockResolvedValue({ data: { order_number: "PRIVATE-ORDER", customer: { name: "PRIVATE-CUSTOMER" }, invoices: [{ total: 987 }] }, error: null });
    render(<MemoryRouter initialEntries={["/legacy/old-key"]}><Routes><Route path="/legacy/:token" element={<Page/>}/></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/This link is unavailable/)).toBeTruthy());
    expect(screen.queryByText(/PRIVATE/)).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("customer_vehicle_portal_resolve", { p_key: "old-key" });
  });
});
