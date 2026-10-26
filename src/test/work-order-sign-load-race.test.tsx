// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkOrderSignPage from "@/pages/public/WorkOrderSignPage";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

function RouteSwitch() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/sign/second-token")}>Next link</button>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sign/first-token"]}>
      <Routes>
        <Route path="/sign/:token" element={<><RouteSwitch /><WorkOrderSignPage /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signedOrder(orderNumber: string) {
  return {
    data: {
      order_number: orderNumber,
      entry_date: "2026-10-22",
      work_items: [],
      vehicle: {},
      customer: {},
      signed: true,
    },
    error: null,
  };
}

beforeEach(() => mocks.rpc.mockReset());

describe("public work order signature load", () => {
  it("does not show the previous token's work order after switching links", async () => {
    let finishFirst!: (value: ReturnType<typeof signedOrder>) => void;
    let finishSecond!: (value: ReturnType<typeof signedOrder>) => void;
    const first = new Promise<ReturnType<typeof signedOrder>>((resolve) => { finishFirst = resolve; });
    const second = new Promise<ReturnType<typeof signedOrder>>((resolve) => { finishSecond = resolve; });
    mocks.rpc.mockImplementation((name: string, args?: { p_token: string }) =>
      name === "get_work_order_for_sign"
        ? (args?.p_token === "first-token" ? first : second)
        : Promise.resolve({ data: null, error: null }),
    );

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next link" }));
    await act(async () => finishSecond(signedOrder("WO-I-26-0002")));
    await waitFor(() => expect(screen.getByText("WO-I-26-0002")).toBeTruthy());
    await act(async () => finishFirst(signedOrder("WO-I-26-0001")));
    expect(screen.queryByText("WO-I-26-0001")).toBeNull();
    expect(screen.getByText("WO-I-26-0002")).toBeTruthy();
  });

  it("ends loading when the server request rejects", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      name === "get_work_order_for_sign"
        ? Promise.reject(new Error("network unavailable"))
        : Promise.resolve({ data: null, error: null }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("رابط غير صالح")).toBeTruthy());
    expect(screen.queryByText("WO-I-26-0001")).toBeNull();
  });
});
