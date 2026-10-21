// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke } } }));
vi.mock("@/lib/vehicleEntryService", () => ({
  VEHICLE_ENTRY_DECLARATION_AR: "إقرار الاختبار",
  VEHICLE_ENTRY_DECLARATION_EN: "Test declaration",
  buildVehicleEntryHtml: () => "<!doctype html><html><head></head><body>Printable entry</body></html>",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import VehicleEntrySignPage from "@/pages/public/VehicleEntrySignPage";

const unsignedEntry = {
  entry_number: "ENT-2026-0001",
  arrival_date: "2026-10-21",
  customer: { name: "Test Customer" },
  vehicle: { plate_number: "1234", plate_letters: "AB" },
  signed: false,
};

function renderSignaturePage() {
  return render(
    <MemoryRouter initialEntries={["/vehicle-entry/sign/test-token"]}>
      <Routes>
        <Route path="/vehicle-entry/sign/:token" element={<VehicleEntrySignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("vehicle entry one-time signed preview flow", () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { media: [] }, error: null });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,dGVzdA==");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the print template only after the first saved signature and returns to the signed page after ten seconds", async () => {
    rpc.mockImplementation(async (name: string) => name === "get_vehicle_entry_for_customer_signature"
      ? { data: unsignedEntry, error: null }
      : { data: {
        ok: true,
        signed_at: "2026-10-21T06:00:00Z",
        preview_entry: { entry_number: "ENT-2026-0001" },
      }, error: null });
    renderSignaturePage();
    const submit = await screen.findByRole("button", { name: "اعتماد التوقيع الإلكتروني" });
    fireEvent.click(screen.getByRole("checkbox"));
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    fireEvent.pointerDown(canvas!);
    fireEvent.pointerMove(canvas!, { clientX: 20, clientY: 20 });

    vi.useFakeTimers();
    await act(async () => { fireEvent.click(submit); await Promise.resolve(); });
    expect(screen.getByText("معاينة مؤقتة لنموذج دخول المركبة")).toBeTruthy();
    expect(screen.getByText(/تنتهي المعاينة خلال 10 ثوانٍ/)).toBeTruthy();
    const previewFrame = document.querySelector('iframe[sandbox="allow-same-origin"]');
    expect(previewFrame).not.toBeNull();
    expect(screen.queryByRole("button", { name: /تنزيل|طباعة|حفظ/ })).toBeNull();

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText("معاينة مؤقتة لنموذج دخول المركبة")).toBeTruthy();
    act(() => { fireEvent.load(previewFrame!); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByText("معاينة مؤقتة لنموذج دخول المركبة")).toBeNull();
    expect(screen.getByText("تم اعتماد التوقيع")).toBeTruthy();
    expect(screen.getByText(/تاريخ ووقت التوقيع:/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not reopen the preview when the signed link is revisited", async () => {
    rpc.mockResolvedValue({ data: {
      ...unsignedEntry,
      signed: true,
      signer_name: "Test Customer",
      signed_at: "2026-10-21T06:00:00Z",
    }, error: null });
    renderSignaturePage();
    expect(await screen.findByText("تم اعتماد التوقيع")).toBeTruthy();
    expect(screen.queryByText("معاينة مؤقتة لنموذج دخول المركبة")).toBeNull();
    expect(screen.getByText(/تاريخ ووقت التوقيع:/)).toBeTruthy();
  });
});
