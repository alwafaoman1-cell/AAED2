// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleEntryList from "@/pages/vehicle-entry/VehicleEntryList";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ list: vi.fn(), rearPhotos: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-test" } }) }));
vi.mock("@/lib/vehicleRearThumbnails", () => ({ getEntryRearThumbnailUrls: mocks.rearPhotos }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>();
  return { ...real, listVehicleVisitCenter: mocks.list };
});

function NewEntryLocation() {
  const location = useLocation();
  return <div data-testid="new-entry-url">{location.search}</div>;
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/vehicle-entry"]}>
        <Routes>
          <Route path="/vehicle-entry" element={<VehicleEntryList />} />
          <Route path="/vehicle-entry/new" element={<NewEntryLocation />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  mocks.list.mockReset();
  mocks.rearPhotos.mockReset();
  mocks.rearPhotos.mockResolvedValue({});
  mocks.list.mockResolvedValue([
    { entry: { id: "inside", entry_number: "ENT-2026-0001", arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Draft", vehicle_condition: { visit_purpose: "inspection" } }, stage: "arrived" },
    { entry: { id: "outside", entry_number: "ENT-2026-0002", arrival_date: "2026-10-20", vehicle_location: "مع العميل", status: "Issued" }, stage: "arrived" },
    { entry: { id: "review", entry_number: "ENT-2026-0003", arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Received", claim: { vehicle_presence_status: "with_customer" } }, stage: "needs_review", reviewReason: "custody_conflict" },
  ]);
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

describe("vehicle entry list visit workflow", () => {
  it("shows the same saved rear-view thumbnail beside the vehicle in list and stage views", async () => {
    mocks.rearPhotos.mockResolvedValue({ inside: "https://example.test/rear.webp" });
    renderList();
    expect(await screen.findByAltText(/صورة الواجهة الخلفية للمركبة/)).toHaveAttribute("src", "https://example.test/rear.webp");
    expect(mocks.rearPhotos).toHaveBeenCalledWith("tenant-test", ["inside"]);
    fireEvent.click(screen.getByRole("button", { name: "مراحل" }));
    expect(await screen.findByAltText(/صورة الواجهة الخلفية للمركبة/)).toHaveAttribute("src", "https://example.test/rear.webp");
  });

  it("separates custody tabs, translates statuses, and exposes contradictory records", async () => {
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(screen.getByText("مسودة")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0002")).toBeNull();
    expect(screen.getByText(/تحتاج مراجعة الموقع \(1\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    expect(await screen.findByText("ENT-2026-0002")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0001")).toBeNull();
    expect(screen.getByText("صادرة")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "عرض السجلات" }));
    expect(screen.getByText("ENT-2026-0003")).toBeTruthy();
  });

  it("asks for the visit purpose before opening the creation page", async () => {
    renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "تسجيل دخول مركبة" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /فحص ومعاينة/ }));
    expect(screen.getByTestId("new-entry-url").textContent).toBe("?purpose=inspection");
  });

  it("shows the new workflow labels in English when the application language changes", async () => {
    await i18n.changeLanguage("en");
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /In workshop/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /With customer/ })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record vehicle arrival" })).toBeTruthy();
  });

  it("loads the complete center result instead of silently stopping after a page", async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
      entry: { id: `entry-${index}`, entry_number: index === 100 ? "ENT-OLDER" : `ENT-${index}`, arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Draft" },
      stage: "arrived",
    })));
    renderList();
    expect(await screen.findByText("ENT-OLDER")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
