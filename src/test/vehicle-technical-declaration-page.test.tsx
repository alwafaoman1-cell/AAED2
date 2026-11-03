// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DOMPurify from "dompurify";

const getEntry = vi.hoisted(() => vi.fn());
const getDeclaration = vi.hoisted(() => vi.fn());
const saveDeclaration = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "ar" } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { full_name: "Report Creator" } }) }));
vi.mock("@/components/ElectronicSignaturePad", () => ({ default: ({ onChange }: { onChange: (value: string) => void }) => (
  <button type="button" onClick={() => onChange("data:image/png;base64,aGVsbG8=")}>Test signature</button>
) }));
vi.mock("@/lib/vehicleEntryService", () => ({ getVehicleEntry: getEntry }));
vi.mock("@/lib/vehicleTechnicalDeclaration", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/vehicleTechnicalDeclaration")>(),
  getVehicleTechnicalDeclaration: getDeclaration,
  saveVehicleTechnicalDeclaration: saveDeclaration,
}));
vi.mock("@/lib/vehicleTechnicalDeclarationPdf", () => ({
  assertPrintableTechnicalDeclaration: vi.fn().mockResolvedValue(undefined),
  downloadTechnicalDeclarationPdf: vi.fn(), openTechnicalDeclarationPreview: vi.fn(), printTechnicalDeclaration: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VehicleTechnicalDeclarationPage from "@/pages/vehicle-entry/VehicleTechnicalDeclarationPage";
import { buildVehicleTechnicalDeclarationHtml, emptyVehicleTechnicalDeclaration } from "@/lib/vehicleTechnicalDeclaration";

function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={["/vehicle-entry/entry-test/technical-declaration"]}>
      <Routes><Route path="/vehicle-entry/:id/technical-declaration" element={<VehicleTechnicalDeclarationPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  return { ...view, client };
}

describe("vehicle technical declaration page", () => {
  beforeEach(() => {
    getEntry.mockReset(); getDeclaration.mockReset(); saveDeclaration.mockReset();
    getEntry.mockResolvedValue({
      id: "entry-test", entry_number: "ENT-2026-0001",
      claim: { claim_number: "C/NEW" },
      vehicle: { brand: "Toyota", model: "Corolla", plate_letters: "AB", plate_number: "1234" },
    });
  });

  it("starts from entry identity, saves once, then enables the confirmed print actions", async () => {
    getDeclaration.mockResolvedValue(null);
    saveDeclaration.mockImplementation(async (_id, form) => ({
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 1,
      form_data: form, updated_at: "2026-11-03T10:00:00Z",
    }));
    showPage();
    expect(await screen.findByDisplayValue("C/NEW")).toBeTruthy();
    expect(screen.getByDisplayValue("AB 1234")).toBeTruthy();
    expect(screen.getByDisplayValue("المركز التخصصي لصيانة السيارات")).toBeTruthy();
    expect((screen.getByDisplayValue("المركز التخصصي لصيانة السيارات") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByDisplayValue("Report Creator")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    const cranking = screen.getByRole("group", { name: "يدور المحرك" });
    fireEvent.click(within(cranking).getByRole("button", { name: "نعم" }));
    expect(within(cranking).getByRole("button", { name: "نعم" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: /تنزيل PDF/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getAllByLabelText("ملاحظات أخرى", { selector: "input" })[0], { target: { value: "Checked" } });
    fireEvent.click(screen.getByRole("button", { name: "Test signature" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ النموذج" }));
    await waitFor(() => expect(saveDeclaration).toHaveBeenCalledTimes(1));
    expect(saveDeclaration.mock.calls[0][0]).toBe("entry-test");
    expect(saveDeclaration.mock.calls[0][2]).toBeNull();
    expect(saveDeclaration.mock.calls[0][1]).toMatchObject({
      cranking: "yes", authorized_person: "Report Creator", signer_role: "report_author",
      signature_data_url: "data:image/png;base64,aGVsbG8=",
    });
    await waitFor(() => expect((screen.getByRole("button", { name: /تنزيل PDF/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("reopens the saved snapshot instead of silently replacing it with later entry edits", async () => {
    getDeclaration.mockResolvedValue({
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 3,
      form_data: { ...emptyVehicleTechnicalDeclaration, claim_number: "C/ORIGINAL", make_model: "Toyota Old Model" },
    });
    showPage();
    expect(await screen.findByDisplayValue("C/ORIGINAL")).toBeTruthy();
    expect(screen.getByDisplayValue("Toyota Old Model")).toBeTruthy();
    expect(screen.queryByDisplayValue("C/NEW")).toBeNull();
  });

  it("uses the linked work-order technician when selected", async () => {
    getEntry.mockResolvedValue({
      id: "entry-test", entry_number: "ENT-2026-0001",
      work_order: { technician_name: "Workshop Technician" },
      vehicle: { brand: "Toyota", model: "Corolla", plate_letters: "AB", plate_number: "1234" },
    });
    getDeclaration.mockResolvedValue(null);
    showPage();
    await screen.findByDisplayValue("Report Creator");
    fireEvent.click(within(screen.getByRole("group", { name: "صفة الموقّع" })).getByRole("button", { name: "الفني" }));
    expect(screen.getByDisplayValue("Workshop Technician")).toBeTruthy();
  });

  it("clears the old signature if the signer name changes", async () => {
    getDeclaration.mockResolvedValue(null);
    saveDeclaration.mockImplementation(async (_id, form) => ({
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 1,
      form_data: form, updated_at: "2026-11-03T10:00:00Z",
    }));
    showPage();
    await screen.findByDisplayValue("Report Creator");
    fireEvent.click(screen.getByRole("button", { name: "Test signature" }));
    fireEvent.change(screen.getByLabelText("اسم الموقّع"), { target: { value: "Another Signer" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ النموذج" }));
    await waitFor(() => expect(saveDeclaration).toHaveBeenCalledTimes(1));
    expect(saveDeclaration.mock.calls[0][1].signature_data_url).toBe("");
  });

  it("keeps the captured signature after sanitizing the printable document", () => {
    const image = "data:image/png;base64,aGVsbG8=";
    const safe = DOMPurify.sanitize(buildVehicleTechnicalDeclarationHtml({
      ...emptyVehicleTechnicalDeclaration,
      authorized_person: "Report Creator", signer_role: "report_author", signature_data_url: image,
    }), { WHOLE_DOCUMENT: true, ADD_TAGS: ["style", "meta"], ADD_ATTR: ["dir", "lang"] });
    const doc = new DOMParser().parseFromString(safe, "text/html");
    expect(doc.querySelector(".signature-box img")?.getAttribute("src")).toBe(image);
    expect(doc.querySelector(".tick")).toBeNull();
  });

  it("keeps the opened revision while editing even if React Query refreshes in the background", async () => {
    getDeclaration.mockResolvedValue({
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 3,
      form_data: { ...emptyVehicleTechnicalDeclaration, claim_number: "C/ORIGINAL" },
    });
    saveDeclaration.mockResolvedValue({
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 4,
      form_data: { ...emptyVehicleTechnicalDeclaration, claim_number: "C/EDITED" },
    });
    const { client } = showPage();
    const input = await screen.findByDisplayValue("C/ORIGINAL");
    fireEvent.change(input, { target: { value: "C/EDITED" } });
    act(() => client.setQueryData(["vehicle_technical_declaration", "entry-test"], {
      id: "declaration-1", vehicle_entry_id: "entry-test", revision: 4,
      form_data: { ...emptyVehicleTechnicalDeclaration, claim_number: "C/OTHER-USER" },
    }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ النموذج" }));
    await waitFor(() => expect(saveDeclaration).toHaveBeenCalledTimes(1));
    expect(saveDeclaration.mock.calls[0][2]).toBe(3);
  });
});
