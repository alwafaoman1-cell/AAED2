// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkOrderSignPage from "@/pages/public/WorkOrderSignPage";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
function RouteSwitch() { const navigate = useNavigate(); return <button onClick={() => navigate("/sign/second-token")}>Next link</button>; }
function renderPage() {
  return render(<MemoryRouter initialEntries={["/sign/first-token"]}><Routes>
    <Route path="/sign/:token" element={<><RouteSwitch/><WorkOrderSignPage/></>}/>
    <Route path="/customer/vehicle/:token" element={<p>Plate credentials required</p>}/>
  </Routes></MemoryRouter>);
}
beforeEach(() => { mocks.rpc.mockReset(); }); afterEach(cleanup);
describe("legacy work-order links resolve only to the protected portal", () => {
  it("ignores an old link resolution after switching to a different link", async () => {
    let first!: (value: unknown) => void; let second!: (value: unknown) => void;
    mocks.rpc.mockImplementation((_name, args) => new Promise(resolve => { if (args.p_key === "first-token") first = resolve; else second = resolve; }));
    renderPage(); fireEvent.click(screen.getByRole("button", { name: "Next link" }));
    await act(async () => second({ data: null, error: null }));
    await waitFor(() => expect(screen.getByText(/This link is unavailable/)).toBeTruthy());
    await act(async () => first({ data: { token: "obsolete-portal" }, error: null }));
    expect(screen.queryByText("Plate credentials required")).toBeNull();
    expect(mocks.rpc.mock.calls.every(([name]) => name === "customer_vehicle_portal_resolve")).toBe(true);
  });
  it("redirects only after canonical server resolution", async () => {
    mocks.rpc.mockResolvedValue({ data: { token: "new-portal" }, error: null }); renderPage();
    await waitFor(() => expect(screen.getByText("Plate credentials required")).toBeTruthy());
    expect(mocks.rpc).toHaveBeenCalledWith("customer_vehicle_portal_resolve", { p_key: "first-token" });
  });
  it("fails closed after a network rejection", async () => {
    mocks.rpc.mockRejectedValue(new Error("network unavailable")); renderPage();
    await waitFor(() => expect(screen.getByText(/This link is unavailable/)).toBeTruthy());
    expect(screen.queryByText("Plate credentials required")).toBeNull();
  });
});
