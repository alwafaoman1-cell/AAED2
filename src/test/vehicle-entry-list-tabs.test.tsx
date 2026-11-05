// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleEntryList from "@/pages/vehicle-entry/VehicleEntryList";
import i18n from "@/i18n";
import { getVehicleCenterTab, VEHICLE_CENTER_TABS, VISIT_STAGES } from "@/lib/vehicleVisitLifecycle";

const mocks = vi.hoisted(() => ({ list: vi.fn(), rearPhotos: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-test" }, user: { id: "user-test" }, hasRole: () => true }) }));
vi.mock("@/lib/vehicleRearThumbnails", () => ({ getEntryRearThumbnailUrls: mocks.rearPhotos }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>();
  return { ...real, listVehicleVisitCenterPage: mocks.list };
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
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  setVisits([
    { entry: { id: "inside", entry_number: "ENT-2026-0001", arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Draft", vehicle_condition: { visit_purpose: "inspection" } }, stage: "arrived", operationalStage: "arrived" },
    { entry: { id: "outside", entry_number: "ENT-2026-0002", arrival_date: "2026-10-20", vehicle_location: "مع العميل", status: "Issued" }, stage: "arrived", operationalStage: "arrived", hasSignedTemporaryRelease: true },
    { entry: { id: "review", entry_number: "ENT-2026-0003", arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Received", claim: { vehicle_presence_status: "with_customer" } }, stage: "needs_review", operationalStage: "needs_review", reviewReason: "custody_conflict" },
  ]);
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
});

function setVisits(visits: any[]) {
  mocks.list.mockImplementation(async ({ tab, page, pageSize, filters }: any) => {
    const matches = visits.filter((v) => (!filters.search || v.entry.entry_number?.includes(filters.search))
      && (filters.stage === "all" || v.operationalStage === filters.stage || (filters.stage === "needs_review" && v.reviewReason)));
    const selected = matches.filter((v) => getVehicleCenterTab(v) === tab);
    return {
      items: selected.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: selected.length,
      tabs: Object.fromEntries(VEHICLE_CENTER_TABS.map((key) => [key, matches.filter((v) => getVehicleCenterTab(v) === key).length])),
      stages: Object.fromEntries(VISIT_STAGES.map((key) => [key, visits.filter((v) => getVehicleCenterTab(v) === tab && v.operationalStage === key).length])),
      technicians: [], entryCount: selected.filter((v) => !v.entry._claimOnly).length,
      claimOnlyCount: selected.filter((v) => v.entry._claimOnly).length,
    };
  });
}

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
    expect(await screen.findByText("ENT-2026-0003")).toBeTruthy();
  });

  it("keeps a selected milestone inside the active custody tab", async () => {
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /المركبات الواصلة\s*1/ }));
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0002")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    await screen.findByText("ENT-2026-0002");
    fireEvent.click(screen.getByRole("button", { name: /المركبات الواصلة\s*1/ }));
    expect(await screen.findByText("ENT-2026-0002")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0001")).toBeNull();
  });

  it("asks for the visit purpose before opening the creation page", async () => {
    renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "تسجيل دخول مركبة" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(i18n.t("vehicleIntakeWizard.inspection")) })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("vehicleIntakeWizard.cash") }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("vehicleIntakeWizard.inspection")) }));
    expect(screen.getByTestId("new-entry-url").textContent).toBe("?channel=cash&purpose=inspection");
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

  it("requests one bounded page and only loads later records after paging", async () => {
    setVisits(Array.from({ length: 31 }, (_, index) => ({
      entry: { id: `entry-${index}`, entry_number: index === 30 ? "ENT-OLDER" : `ENT-${index}`, arrival_date: "2026-10-20", vehicle_location: "داخل الورشة", status: "Draft" },
      stage: "arrived", operationalStage: "arrived",
    })));
    renderList();
    await screen.findByText("ENT-0");
    expect(screen.queryByText("ENT-OLDER")).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /التالي/ }));
    expect(await screen.findByText("ENT-OLDER")).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 30, tab: "in_workshop" }));
    fireEvent.change(screen.getByRole("textbox", { name: i18n.t("vehicleVisit.search") }), { target: { value: "ENT-OLDER" } });
    expect(await screen.findByText("ENT-OLDER")).toBeTruthy();
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, filters: expect.objectContaining({ search: "ENT-OLDER" }) })));
  });

  it("shows Register entry only for actual signed temporary exits, never terminal tabs", async () => {
    renderList();
    await screen.findByText("ENT-2026-0001");
    expect(screen.queryByRole("button", { name: "تسجيل الدخول · ENT-2026-0001" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    expect(await screen.findByRole("button", { name: "تسجيل الدخول · ENT-2026-0002" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /تم التسليم/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "delivered", page: 1 })));
    expect(screen.queryByRole("button", { name: "تسجيل الدخول · ENT-2026-0002" })).toBeNull();
  });

  it("keeps claim-only cards in Review without inventing an inspected arrival", async () => {
    setVisits([{
      entry: {
        id: "claim:claim-1", _claimOnly: true, entry_number: "", status: "pending",
        vehicle_id: "vehicle-1", insurance_claim_id: "claim-1", vehicle_location: "مع العميل",
        claim: { id: "claim-1", claim_number: "C/2026/1", status: "pending", vehicle_presence_status: "with_customer" },
      },
      stage: "arrived", operationalStage: "arrived", reviewReason: "claim_without_entry",
    }]);
    renderList();
    fireEvent.click(screen.getByRole("tab", { name: /تحتاج مراجعة/ }));
    expect(await screen.findByText("C/2026/1")).toBeTruthy();
    expect(screen.getByText("مطالبة بلا كرت دخول")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "الموقع والمراحل · C/2026/1" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/ليست سند استلام/)).toBeTruthy();
  });

  it("retrieves reviewed terminal details only when the matching closed tab opens", async () => {
    setVisits([{
      entry: { id: "delivered", entry_number: "ENT-2026-0099", arrival_date: "2026-07-01",
        vehicle_location: "داخل الورشة", status: "Received", claim: { vehicle_presence_status: "with_customer" } },
      stage: "needs_review", operationalStage: "delivered", reviewReason: "delivery_without_signed_handover",
    }]);
    renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(await screen.findByRole("tab", { name: /تم التسليم.*1/ })).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0099")).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: /تم التسليم/ }));
    expect(await screen.findByText("ENT-2026-0099")).toBeTruthy();
    expect(screen.getByText("حالة تسليم دون محضر تسليم موقّع ومعتمد")).toBeTruthy();
  });

  it("uses compact cards on a phone while keeping record links and quick actions", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "ENT-2026-0001" })).toHaveAttribute("href", "/vehicle-entry/inside");
    expect(screen.getByRole("button", { name: "الموقع والمراحل · ENT-2026-0001" })).toBeTruthy();
  });

  it.each(["en", "ar"])("names filters and connects keyboard tabs to the live custody panel in %s", async (language) => {
    await i18n.changeLanguage(language);
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    for (const key of ["vehicleEntry.statusFilter", "vehicleVisit.technician", "vehicleVisit.location"]) {
      expect(screen.getByRole("combobox", { name: i18n.t(key) })).toBeTruthy();
    }
    expect(screen.getByRole("textbox", { name: i18n.t("vehicleVisit.search") })).toBeTruthy();
    const inside = screen.getByRole("tab", { selected: true });
    const panel = screen.getByRole("tabpanel");
    expect(inside).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", inside.id);
    fireEvent.keyDown(inside, { key: language === "ar" ? "ArrowLeft" : "ArrowRight" });
    expect(await screen.findByText("ENT-2026-0002")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0001")).toBeNull();
    const outside = screen.getByRole("tab", { selected: true });
    expect(outside).toHaveFocus();
    expect(panel).toHaveAttribute("aria-labelledby", outside.id);
    fireEvent.keyDown(outside, { key: "Home" });
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(inside).toHaveFocus();
  });
});
