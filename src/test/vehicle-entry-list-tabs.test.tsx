// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleEntryList from "@/pages/vehicle-entry/VehicleEntryList";
import i18n from "@/i18n";
import { getVehicleCenterTab, VEHICLE_CENTER_TABS, VISIT_STAGES } from "@/lib/vehicleVisitLifecycle";

const mocks = vi.hoisted(() => ({ list: vi.fn(), rearPhotos: vi.fn(), role: "manager" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-test", role: mocks.role }, user: { id: "user-test" }, hasRole: (...roles: string[]) => roles.includes(mocks.role) }) }));
vi.mock("@/lib/vehicleRearThumbnails", () => ({ getEntryRearThumbnailUrls: mocks.rearPhotos }));
vi.mock("@/lib/vehicleVisitLifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vehicleVisitLifecycle")>();
  return { ...real, listVehicleVisitCenterPage: mocks.list };
});

function NewEntryLocation() {
  const location = useLocation();
  return <div data-testid="new-entry-url">{location.search}</div>;
}
async function openRecords() {
  fireEvent.keyDown(screen.getByRole("button", { name: new RegExp(`^${i18n.t("vehicleCenterMobile.records")}`) }), { key: "Enter" });
  return screen.findAllByRole("menuitemradio");
}
async function chooseRecord(name: RegExp) {
  await openRecords(); fireEvent.click(screen.getByRole("menuitemradio", { name }));
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
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
  await i18n.changeLanguage("ar");
  mocks.list.mockReset();
  mocks.role = "manager";
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
      scopeToken: "a".repeat(32),
    };
  });
}

describe("vehicle entry list visit workflow", () => {
  it.each([
    [1024, false, "manager"], [390, false, "manager"], [1024, true, "manager"],
    [1024, false, "technician"], [390, false, "technician"], [1024, true, "technician"],
  ] as const)("guards the inspection menu by visit eligibility and role at width %i, board %s, role %s", async (width, board, role) => {
    window.innerWidth = width;
    mocks.role = role;
    setVisits([
      { entry: { id: "eligible", entry_number: "ENT-INSPECT", vehicle_id: "vehicle-1", insurance_claim_id: "claim-1", claim: { status: "approved" }, status: "Issued", vehicle_location: "داخل الورشة" }, stage: "approved", operationalStage: "approved" },
      { entry: { id: "cash", entry_number: "ENT-CASH", vehicle_id: "vehicle-2", status: "Issued", vehicle_location: "داخل الورشة" }, stage: "approved", operationalStage: "approved" },
    ]);
    renderList();
    await screen.findByText("ENT-INSPECT");
    if (board) fireEvent.click(screen.getByRole("button", { name: "مراحل" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "إجراءات إضافية · ENT-INSPECT" }), { key: "Enter" });
    const inspection = screen.queryByRole("menuitem", { name: i18n.t("vehicleEntryInspection:actionFor", { number: "ENT-INSPECT" }) });
    if (role === "manager") expect(inspection).toHaveAttribute("href", "/inspection/insurance/new?entry=eligible");
    else expect(inspection).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(screen.getByRole("button", { name: "إجراءات إضافية · ENT-CASH" }), { key: "Enter" });
    expect(screen.queryByRole("menuitem", { name: i18n.t("vehicleEntryInspection:actionFor", { number: "ENT-CASH" }) })).toBeNull();
  });

  it.each(["ar", "en"])("retains the selected work stage until explicitly cleared and resets it outside the workshop in %s", async language => {
    await i18n.changeLanguage(language);
    renderList();
    await screen.findByText("ENT-2026-0001");
    const stageGroup = screen.getByRole("group", { name: i18n.t("vehicleCenterMobile.stages") });
    const stage = within(stageGroup).getAllByRole("button")[0];
    fireEvent.click(stage);
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "in_workshop", filters: expect.objectContaining({ stage: "arrived" }),
    })));
    expect(stage).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(stage);
    expect(stage).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("vehicleVisitWorkspace.allStages") }));
    await waitFor(() => expect(screen.queryByRole("button", { name: i18n.t("vehicleVisitWorkspace.allStages") })).toBeNull());
    expect(stage).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(stage);
    expect(stage).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({
      tab: "with_customer", filters: expect.objectContaining({ stage: "all" }),
    })));
    expect(screen.queryByRole("group", { name: i18n.t("vehicleCenterMobile.stages") })).toBeNull();
    fireEvent.click(screen.getAllByRole("tab")[0]);
    await screen.findByText("ENT-2026-0001");
    const returnedStages = screen.getByRole("group", { name: i18n.t("vehicleCenterMobile.stages") });
    expect(within(returnedStages).getAllByRole("button").every(button => button.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("uses one primary action and keeps the prior card fields in the visit details menu", async () => {
    window.innerWidth = 390;
    setVisits([{ entry: { id: "entry-compact", entry_number: "ENT-COMPACT", vehicle_location: "داخل الورشة", status: "Issued", arrival_date: "2026-10-20", insurance_claim_id: "claim-compact", claim: { status: "approved" },
      vehicle_snapshot: { make: "Toyota", model: "Corolla", plate_number: "8335", plate_letters: "RR" },
      insurance_snapshot: { company_name: "Example Insurer" }, customer_snapshot: { name: "Example Customer", phone: "99999999" },
      delivered_by: { full_name: "Example Receiver" }, work_order: { order_number: "WO-I-26-0113", status: "received", technician_name: "Example Technician" },
    }, stage: "approved", operationalStage: "approved" }]);
    renderList(); await screen.findByText("ENT-COMPACT");
    const card = screen.getByRole("article");
    expect(within(card).getAllByRole("button")).toHaveLength(2);
    expect(within(card).getByRole("button", { name: "بدء العمل · ENT-COMPACT" })).toBeTruthy();
    fireEvent.keyDown(within(card).getByRole("button", { name: "إجراءات إضافية · ENT-COMPACT" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "بيانات الزيارة" }));
    const details = await screen.findByRole("dialog");
    for (const value of ["Example Insurer", "Example Receiver", "Example Technician", "99999999", "2026-10-20"]) expect(within(details).getByText(value, { exact: false })).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("collapses mobile filters without clearing values or fetching another page just for disclosure", async () => {
    window.innerWidth = 390;
    renderList();
    await screen.findByText("ENT-2026-0001");
    const filters = screen.getByRole("button", { name: /^الفلاتر/ });
    expect(filters).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(i18n.t("unifiedInvoices.from"))).toBeNull();
    fireEvent.click(filters);
    expect(filters).toHaveAttribute("aria-expanded", "true");
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(i18n.t("unifiedInvoices.from")), { target: { value: "2026-07-01" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ from: "2026-07-01" }) })));
    fireEvent.click(filters);
    expect(screen.queryByLabelText(i18n.t("unifiedInvoices.from"))).toBeNull();
    expect(filters).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "مسح الفلاتر" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "مسح الفلاتر" })).toBeNull());
    fireEvent.click(filters);
    expect(screen.getByLabelText(i18n.t("unifiedInvoices.from"))).toHaveValue("");
    expect(filters).not.toHaveTextContent("1");
    // Returning to the fresh, cached default filter need not issue another read.
    expect(screen.getByRole("tab", { name: /داخل الورشة/ })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps printing, Excel and label tools available in the compact mobile actions menu", async () => {
    window.innerWidth = 390;
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderList(); await screen.findByText("ENT-2026-0001");
    fireEvent.keyDown(screen.getByRole("button", { name: "إجراءات إضافية" }), { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: i18n.t("vehicleEntry.export") })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "كرت المركبة الداخلي" })).toBeTruthy();
    expect(screen.getByRole("menu")).toHaveClass("print:hidden");
    fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("vehicleEntry.printLoaded") }));
    expect(print).toHaveBeenCalledOnce(); print.mockRestore();
  });

  it("reveals bulk card actions after mobile selection without changing the source counts", async () => {
    window.innerWidth = 390;
    renderList(); await screen.findByText("ENT-2026-0001");
    expect(screen.queryByRole("button", { name: "طباعة الكروت المحددة" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "تحديد المركبة ENT-2026-0001" }));
    expect(await screen.findByRole("button", { name: "طباعة الكروت المحددة" })).toBeEnabled();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("group", { name: "مراحل المركبات" }).querySelectorAll("button")).toHaveLength(4);
  });

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
    expect(screen.getByRole("button", { name: /تحتاج مراجعة.*1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    expect(await screen.findByText("ENT-2026-0002")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0001")).toBeNull();
    expect(screen.getByText("صادرة")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /تحتاج مراجعة.*1/ }));
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
    expect(screen.queryByRole("group", { name: "مراحل المركبات" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "تسجيل دخول للورشة · ENT-2026-0001" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    expect(await screen.findByRole("button", { name: "تسجيل دخول للورشة · ENT-2026-0002" })).toBeTruthy();
    await chooseRecord(/تم التسليم/);
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "delivered", page: 1 })));
    expect(screen.queryByRole("button", { name: "تسجيل دخول للورشة · ENT-2026-0002" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /تحتاج مراجعة/ }));
    expect(await screen.findByText("C/2026/1")).toBeTruthy();
    expect(screen.getByText("مطالبة بلا كرت دخول")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "مراجعة السجل · C/2026/1" }));
    // The controller is now a real lazy boundary, not eagerly imported with
    // the list. Wait for its module (not an HTTP retry or a hidden app error).
    expect(await screen.findByRole("dialog",{}, {timeout:10_000})).toBeTruthy();
    expect(screen.getByText(/لا يوجد كرت دخول مرتبط/)).toBeTruthy();
  });

  it("retrieves reviewed terminal details only when the matching closed tab opens", async () => {
    setVisits([{
      entry: { id: "delivered", entry_number: "ENT-2026-0099", arrival_date: "2026-07-01",
        vehicle_location: "داخل الورشة", status: "Received", claim: { vehicle_presence_status: "with_customer" } },
      stage: "needs_review", operationalStage: "delivered", reviewReason: "delivery_without_signed_handover",
    }]);
    renderList();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await openRecords();
    expect(await screen.findByRole("menuitemradio", { name: /تم التسليم.*1/ })).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0099")).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /تم التسليم/ }));
    expect(await screen.findByText("ENT-2026-0099")).toBeTruthy();
    expect(screen.getByText("حالة تسليم دون محضر تسليم موقّع ومعتمد")).toBeTruthy();
  });

  it("uses compact cards on a phone while keeping record links and quick actions", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderList();
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: "ENT-2026-0001" })).toHaveAttribute("href", "/vehicle-entry/inside");
    fireEvent.keyDown(screen.getByRole("button", { name: "إجراءات إضافية · ENT-2026-0001" }), { key: "Enter" });
    expect(screen.getByRole("menuitem", { name: "الموقع والمراحل · ENT-2026-0001" })).toBeTruthy();
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
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "with_customer" })));
    expect(await screen.findByText("ENT-2026-0002")).toBeTruthy();
    expect(screen.queryByText("ENT-2026-0001")).toBeNull();
    const outside = screen.getByRole("tab", { selected: true });
    expect(outside).toHaveFocus();
    expect(panel).toHaveAttribute("aria-labelledby", outside.id);
    fireEvent.keyDown(outside, { key: language === "ar" ? "ArrowLeft" : "ArrowRight" });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "awaiting_arrival" })));
    const pending = screen.getByRole("tab", { selected: true });
    expect(pending).toHaveFocus();
    fireEvent.keyDown(pending, { key: "Home" });
    expect(await screen.findByText("ENT-2026-0001")).toBeTruthy();
    expect(inside).toHaveFocus();
  });

  it("separates prepared forms from actual inspection releases and retains the arrival action", async () => {
    setVisits([{ entry: { id: "prepared", entry_number: "ENT-PREPARED", vehicle_location: "مع العميل",
      vehicle_condition: { visit_purpose: "inspection", arrival_confirmation: "pending" } }, stage: "arrived", operationalStage: "arrived" }]);
    renderList();
    fireEvent.click(screen.getByRole("tab", { name: /مع العميل/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: "with_customer" })));
    expect(screen.queryByText("ENT-PREPARED")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /بانتظار الوصول/ }));
    expect(await screen.findByText("ENT-PREPARED")).toBeTruthy();
    expect(screen.getByRole("row", { name: /ENT-PREPARED/ })).toHaveTextContent("بانتظار الوصول");
    expect(screen.getByRole("columnheader", { name: "تاريخ النموذج" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تسجيل دخول للورشة · ENT-PREPARED" })).toBeTruthy();
  });

  it("offers individual, page and all-filtered selection without eagerly loading all records", async () => {
    renderList();
    await screen.findByText("ENT-2026-0001");
    expect(mocks.list).toHaveBeenCalledTimes(1);
    const print = screen.getByRole("button", { name: "طباعة الكروت المحددة" });
    expect(print).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "تحديد المركبة ENT-2026-0001" }));
    expect(print).toBeEnabled();
    expect(screen.getByText("تم تحديد 1 مركبة")).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء التحديد" }));
    expect(print).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "تحديد جميع نتائج الفلتر (1)" }));
    expect(screen.getByRole("checkbox", { name: "تحديد مركبات الصفحة" })).toBeChecked();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
