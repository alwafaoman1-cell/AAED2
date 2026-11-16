// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ unlock: vi.fn(), read: vi.fn(), document: vi.fn(), media: vi.fn(), sign: vi.fn(), signOrder: vi.fn(), signRelease: vi.fn(), feedback: vi.fn(), note: vi.fn(), pad: vi.fn(), context: vi.fn(), ensure: vi.fn(), toggle: vi.fn(), approve: vi.fn(), html: vi.fn(), send: vi.fn(), success: vi.fn(), failure: vi.fn(), role: "manager", language: "en" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: api.language, changeLanguage: vi.fn() } }) }));
vi.mock("@/contexts/useAuth", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" }, hasRole: (...roles: string[]) => roles.includes(api.role) }) }));
vi.mock("sonner", () => ({ toast: { success: api.success, error: api.failure, info: vi.fn() } }));
vi.mock("@/lib/vehicleIntakeReceipt", () => ({ buildIntakeReceiptHtml: api.html }));
vi.mock("@/lib/partsWhatsApp", () => ({ sendWhatsAppMessage: api.send }));
vi.mock("@/components/ElectronicSignaturePad", () => ({ default: ({ onChange, value, compactOutput }: { onChange: (value: string) => void; value: string; compactOutput: boolean }) => { api.pad(compactOutput); return <div><button type="button" onClick={() => onChange("data:image/png;base64,AA==")}>Draw signature</button><output data-testid="signature-value">{value}</output></div>; } }));
vi.mock("@/components/PdfPreviewDialog", () => ({ default: ({ open, htmlContent, allowShare }: { open: boolean; htmlContent: string; allowShare: boolean }) => open ? <div data-testid="document-preview" data-share={String(allowShare)}>{htmlContent}</div> : null }));
vi.mock("@/lib/unifiedVehiclePortal", async () => {
  const actual = await vi.importActual<typeof import("@/lib/unifiedVehiclePortal")>("@/lib/unifiedVehiclePortal");
  return { ...actual, unlockVehiclePortal: api.unlock, readVehiclePortal: api.read, readVehiclePortalDocument: api.document, readVehiclePortalMedia: api.media, signVehiclePortalEntry: api.sign, signVehiclePortalOrder: api.signOrder, signVehiclePortalRelease: api.signRelease, submitVehiclePortalFeedback: api.feedback, submitVehiclePortalNote: api.note, getVehicleCustomerPortalContext: api.context, ensureVehicleCustomerPortal: api.ensure, setVehicleCustomerPortalEnabled: api.toggle, approveVehicleCustomerPortalDelivery: api.approve };
});
import UnifiedVehicleCustomerPortal from "@/pages/public/UnifiedVehicleCustomerPortal";
import VehicleCustomerPortalPanel from "@/components/vehicle-entry/VehicleCustomerPortalPanel";
import { VehiclePortalError, type StaffVehiclePortalContext, type VehiclePortalData, type VehiclePortalIntakeSignature } from "@/lib/unifiedVehiclePortal";

let portal: VehiclePortalData;
let staff: StaffVehiclePortalContext | null;
beforeEach(() => {
  vi.clearAllMocks(); api.role = "manager"; api.language = "en";
  portal = { vehicle: { make: "Toyota", model: "Corolla", year: 2020, plate_number: "77221", plate_letters: "BA" }, customer: { name: "Private Customer" }, entries: [{ id: "entry", entry_number: "ENT-1", revision: 3, arrival_date: "2026-11-14", arrival_time: "09:30", running_status: "not_running", mileage: 5400, condition: "Stopped engine", notes: "Review engine", new_damage: true, new_damage_notes: "New bumper scratch", signed: true, signer_name: "Original Signer", signed_at: "2026-11-14T05:30:00Z", signature_data_url: "data:image/png;base64,AA==", receipt_number: "RCPT-1", review_source_entry_id: "original-entry" }], order: { enabled: false, work_summary: "Hidden work" }, delivery: { enabled: false, recipient_name: "Hidden Recipient" } };
  api.unlock.mockResolvedValue({ session: "secret-session", expires_at: null });
  api.read.mockImplementation(async () => structuredClone(portal));
  api.document.mockResolvedValue({ entry: { id: "entry" }, receipt: { receipt_number: "RCPT-1" } });
  api.media.mockResolvedValue([]); api.html.mockResolvedValue("Combined canonical intake and receipt");
  staff = { token: "prepared-token", enabled: true, expires_at: null, customer_name: "Customer", vehicle_make: "Toyota", vehicle_year: 2020, pending_handover_id: "handover" };
  api.context.mockImplementation(async () => staff && structuredClone(staff));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ChangeVehicle() { const navigate = useNavigate(); return <button onClick={() => navigate("/customer/vehicle/second-token")}>Change vehicle</button>; }
function renderPortal() { return render(<MemoryRouter initialEntries={["/customer/vehicle/first-token"]}><ChangeVehicle /><Routes><Route path="/customer/vehicle/:token" element={<UnifiedVehicleCustomerPortal />} /></Routes></MemoryRouter>); }
async function unlock() {
  const ar = api.language === "ar";
  fireEvent.change(screen.getByLabelText(ar ? "رقم اللوحة" : "Plate digits"), { target: { value: "77221" } });
  fireEvent.change(screen.getByLabelText(ar ? "حروف اللوحة" : "Plate letters"), { target: { value: "BA" } });
  fireEvent.click(screen.getByRole("button", { name: ar ? "فتح البوابة" : "Open portal" }));
  await screen.findByText("Private Customer");
}
const ink = "data:image/png;base64,AA==";
function pendingIntake() {
  Object.assign(portal.entries[0], { signed: false, legacy_signature: false, has_frozen_document: false, signer_name: undefined, signer_id_number: undefined, signed_at: undefined, signature_data_url: undefined, signature_id: undefined, receipt_id: undefined, receipt_number: undefined });
}
function enterIntakeIdentity(name = "Actual Deliverer", idNumber = "00123AB") {
  fireEvent.change(screen.getByLabelText(api.language === "ar" ? "اسم مُسلّم المركبة الكامل" : "Vehicle deliverer's full name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(api.language === "ar" ? "رقم بطاقة مُسلّم المركبة" : "Vehicle deliverer's ID number"), { target: { value: idNumber } });
}
function intakeResult(name = "Actual Deliverer", idNumber = "00123AB", revision = portal.entries[0].revision): VehiclePortalIntakeSignature {
  return { signed: true, entry_id: portal.entries[0].id, revision, signer_name: name, signer_id_number: idNumber, signature_id: "signature-new", receipt_id: "receipt-new", receipt_number: "RCPT-NEW" };
}
function freezeIntake(result: VehiclePortalIntakeSignature, signature = ink) {
  Object.assign(portal.entries[0], { revision: result.revision, signed: true, has_frozen_document: true, legacy_signature: false, signer_name: result.signer_name, signer_id_number: result.signer_id_number, delivered_by: { full_name: result.signer_name, id_number: result.signer_id_number }, signature_id: result.signature_id, receipt_id: result.receipt_id, receipt_number: result.receipt_number, signed_at: "2026-11-16T07:00:00Z", signature_data_url: signature });
}
function renderStaff() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><VehicleCustomerPortalPanel entryId="entry" customerPhone="000000000" /></QueryClientProvider>);
}

describe("protected vehicle portal UI", () => {
  it("performs no sensitive reads or media requests before plate verification", () => {
    renderPortal();
    expect(api.read).not.toHaveBeenCalled(); expect(api.document).not.toHaveBeenCalled(); expect(api.media).not.toHaveBeenCalled();
    expect(screen.queryByText(/Toyota|Private Customer|77221|Original Signer|Hidden Recipient/)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull(); expect(api.sign).not.toHaveBeenCalled();
  });
  it("keeps failed authentication private and surfaces only a safe message", async () => {
    api.unlock.mockRejectedValue(new VehiclePortalError("credentials")); renderPortal();
    fireEvent.change(screen.getByLabelText("Plate digits"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Plate letters"), { target: { value: "AA" } });
    fireEvent.click(screen.getByRole("button", { name: "Open portal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The plate could not be verified");
    expect(api.read).not.toHaveBeenCalled(); expect(screen.queryByText("Private Customer")).toBeNull();
  });
  it("fails closed before reading data if expiry is not a usable future timestamp", async () => {
    api.unlock.mockResolvedValue({ session: "invalid-expiry-session", expires_at: "-infinity" }); renderPortal();
    fireEvent.change(screen.getByLabelText("Plate digits"), { target: { value: "123" } }); fireEvent.change(screen.getByLabelText("Plate letters"), { target: { value: "AA" } }); fireEvent.click(screen.getByRole("button", { name: "Open portal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("link has expired"); expect(api.read).not.toHaveBeenCalled();
  });
  it("shows exactly three gated icons, intake reviews and explicit condition after unlock", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem"); renderPortal(); await unlock();
    expect(api.read).toHaveBeenCalledWith("first-token", "secret-session");
    const navigation = screen.getByRole("navigation", { name: "Vehicle documents" });
    expect(navigation.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Work order Not enabled yet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Final delivery Not enabled yet" })).toBeDisabled();
    expect(screen.getByText("Review visit linked to the previous intake")).toBeVisible();
    expect(screen.getByText("Not running")).toBeVisible(); expect(screen.getByText("New bumper scratch")).toBeVisible();
    expect(screen.queryByText("Hidden work")).toBeNull(); expect(screen.queryByText("Hidden Recipient")).toBeNull();
    expect(storage).not.toHaveBeenCalled();
  });
  it.each(["ar", "en"].flatMap(language => [undefined, null, "", "   "].map(reviewSource => ({ language, reviewSource }))))("hides review-only damage for an initial intake ($language / $reviewSource)", async ({ language, reviewSource }) => {
    api.language = language; pendingIntake();
    Object.assign(portal.entries[0], { review_source_entry_id: reviewSource, new_damage: true, new_damage_notes: "STRAY REVIEW DAMAGE" });
    renderPortal(); await unlock();
    const en = language === "en";
    expect(screen.getByText(en ? "Vehicle intake" : "دخول واستلام المركبة", { exact: true })).toBeVisible();
    expect(screen.queryByRole("heading", { name: en ? "Any new damage?" : "هل توجد أضرار جديدة؟" })).toBeNull();
    expect(screen.queryByText("STRAY REVIEW DAMAGE")).toBeNull();
    expect(screen.queryByText(en ? "Review visit linked to the previous intake" : "زيارة مراجعة مرتبطة بالدخول السابق")).toBeNull();
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(en ? /recorded damage/ : /الأضرار المسجلة/);
    expect(screen.getByRole("checkbox")).not.toHaveAccessibleName(en ? /new damage/ : /الأضرار الجديدة/);
    expect(api.sign).not.toHaveBeenCalled();
  });
  it.each(["ar", "en"].flatMap(language => [true, false, null].map(newDamage => ({ language, newDamage }))))("retains an accurate review damage assessment ($language / $newDamage)", async ({ language, newDamage }) => {
    api.language = language; pendingIntake();
    Object.assign(portal.entries[0], { review_source_entry_id: "  original-entry  ", new_damage: newDamage, new_damage_notes: newDamage === true ? "Recorded review scratch" : "" });
    renderPortal(); await unlock();
    const en = language === "en";
    expect(screen.getByText(en ? "Review visit linked to the previous intake" : "زيارة مراجعة مرتبطة بالدخول السابق")).toBeVisible();
    expect(screen.getByRole("heading", { name: en ? "Any new damage?" : "هل توجد أضرار جديدة؟" })).toBeVisible();
    const yes = en ? "Yes, new damage is recorded" : "نعم، توجد أضرار جديدة";
    const no = en ? "No new damage" : "لا توجد أضرار جديدة";
    const missing = en ? "Damage assessment not recorded for this visit." : "لم يُسجّل تقييم الأضرار لهذه الزيارة.";
    expect(screen.getByText(newDamage === true ? yes : newDamage === false ? no : missing, { exact: true })).toBeVisible();
    for (const other of [yes, no, missing].filter(text => text !== (newDamage === true ? yes : newDamage === false ? no : missing))) expect(screen.queryByText(other, { exact: true })).toBeNull();
    if (newDamage === true) expect(screen.getByText("Recorded review scratch")).toBeVisible();
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(en ? /new damage/ : /الأضرار الجديدة/);
    expect(screen.queryByText(en ? "Not recorded in this previous form" : "لم يُسجّل في النموذج السابق")).toBeNull();
  });
  it.each(["ar", "en"])("uses a neutral unknown-running label without claiming a previous form (%s)", async language => {
    api.language = language; portal.entries[0].running_status = undefined;
    renderPortal(); await unlock();
    expect(screen.getByText(language === "en" ? "Not recorded" : "غير مسجلة", { exact: true })).toBeVisible();
    expect(screen.queryByText(language === "en" ? "Not recorded in this previous form" : "غير موثّقة في النموذج السابق", { exact: true })).toBeNull();
    expect(screen.queryByText(language === "en" ? "Not running" : "لا تعمل", { exact: true })).toBeNull();
  });
  it.each(["ar", "en"].flatMap(language => [0, null].map(mileage => ({ language, mileage }))))("keeps zero and missing odometer distinct in the portal ($language / $mileage)", async ({ language, mileage }) => {
    api.language = language; portal.entries[0].mileage = mileage;
    renderPortal(); await unlock();
    const en = language === "en";
    const displayed = mileage === null ? "—" : `${mileage.toLocaleString(en ? "en-GB" : "ar-OM")} ${en ? "km" : "كم"}`;
    expect(screen.getByText(en ? "Odometer" : "قراءة العداد", { exact: true }).parentElement).toHaveTextContent(displayed);
  });
  it("forgets session, signatures, photos and document immediately when switching links", async () => {
    renderPortal(); await unlock();
    fireEvent.click(screen.getByRole("button", { name: /Receipt with intake form/ }));
    await screen.findByTestId("document-preview");
    fireEvent.click(screen.getByRole("button", { name: "Change vehicle" }));
    expect(screen.queryByText("Private Customer")).toBeNull(); expect(screen.queryByTestId("document-preview")).toBeNull();
    expect(screen.getByLabelText("Plate digits")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Open portal" })).toBeDisabled();
    expect(api.read).not.toHaveBeenCalledWith("second-token", "secret-session");
  });
  it("does not fetch old-token data after a late unlock response", async () => {
    let resolve!: (value: { session: string; expires_at: null }) => void;
    api.unlock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderPortal();
    fireEvent.change(screen.getByLabelText("Plate digits"), { target: { value: "123" } }); fireEvent.change(screen.getByLabelText("Plate letters"), { target: { value: "AA" } });
    fireEvent.click(screen.getByRole("button", { name: "Open portal" }));
    fireEvent.click(screen.getByRole("button", { name: "Change vehicle" }));
    await act(async () => { resolve({ session: "late-session", expires_at: null }); });
    expect(api.read).not.toHaveBeenCalled(); expect(screen.queryByText("Private Customer")).toBeNull();
  });
  it("downloads only signed, session-bound combined documents without staff share controls", async () => {
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: /Receipt with intake form/ }));
    expect(await screen.findByTestId("document-preview")).toHaveAttribute("data-share", "false");
    expect(api.document).toHaveBeenCalledWith("first-token", "secret-session", "entry");
    expect(api.html).toHaveBeenCalledWith(expect.objectContaining({ entry: { id: "entry" } }), "en", true);
    fireEvent.click(screen.getByRole("button", { name: "Lock portal" }));
    expect(screen.queryByTestId("document-preview")).toBeNull(); expect(screen.queryByText("Original Signer")).toBeNull();
  });
  it.each([false, true])("retains legacy intake ink without creating a receipt, transferring it or requesting a new signature (frozen flag %s)", async hasFrozenDocument => {
    Object.assign(portal.entries[0], { revision: 1, legacy_signature: true, has_frozen_document: hasFrozenDocument, signed_at: null, created_at: "2025-01-01T06:00:00Z" });
    renderPortal(); await unlock();
    expect(screen.getByRole("heading", { name: "Retained previous signature" })).toBeVisible();
    expect(screen.getByAltText("Retained previous signature")).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(screen.getByText("Signer: Original Signer")).toBeVisible();
    expect(screen.getByText("The previous signature time was not recorded.")).toBeVisible();
    expect(screen.getByText(/Showing it does not create a new receipt or transfer it to a new revision/)).toBeVisible();
    expect(screen.queryByText(/01\/01\/2025|Invalid Date/)).toBeNull();
    expect(screen.queryByText("Signed and saved")).toBeNull();
    expect(screen.queryByRole("button", { name: /Receipt with intake form|Submit and save signature|Draw signature/ })).toBeNull();
    expect(api.document).not.toHaveBeenCalled(); expect(api.html).not.toHaveBeenCalled(); expect(api.sign).not.toHaveBeenCalled(); expect(api.pad).not.toHaveBeenCalled();
  });
  it("shows a known retained signature time as recorded and localizes the historical notice", async () => {
    api.language = "ar";
    Object.assign(portal.entries[0], { revision: 1, legacy_signature: true, has_frozen_document: false });
    renderPortal();
    fireEvent.change(screen.getByLabelText("رقم اللوحة"), { target: { value: "77221" } });
    fireEvent.change(screen.getByLabelText("حروف اللوحة"), { target: { value: "BA" } });
    fireEvent.click(screen.getByRole("button", { name: "فتح البوابة" }));
    await screen.findByText("Private Customer");
    expect(screen.getByRole("heading", { name: "التوقيع السابق المحفوظ" })).toBeVisible();
    expect(screen.getByText(new Date(portal.entries[0].signed_at!).toLocaleString("ar-OM"))).toBeVisible();
    expect(screen.queryByText("وقت التوقيع السابق غير موثّق.")).toBeNull();
    expect(screen.getByText(/لا يُصدر هذا العرض وصلًا جديدًا منه ولا ينقله إلى إصدار جديد/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /معاينة وتنزيل|إرسال التوقيع وحفظه/ })).toBeNull();
  });
  it("withholds combined download when a current signature has no frozen original", async () => {
    portal.entries[0].has_frozen_document = false;
    renderPortal(); await unlock();
    expect(screen.getByText("Signed and saved")).toBeVisible();
    expect(screen.getByText("The original signed document is unavailable for download.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Receipt with intake form|Submit and save signature/ })).toBeNull();
    expect(api.document).not.toHaveBeenCalled(); expect(api.sign).not.toHaveBeenCalled();
  });
  it("requires fresh drawn consent after a material edit instead of reusing the retained legacy signature", async () => {
    Object.assign(portal.entries[0], { revision: 1, legacy_signature: true, has_frozen_document: false, signed_at: null });
    renderPortal(); await unlock();
    expect(screen.getByRole("heading", { name: "Retained previous signature" })).toBeVisible();
    portal.entries[0] = { ...portal.entries[0], revision: 2, legacy_signature: false, has_frozen_document: false, signed: false, signer_name: undefined, signed_at: undefined, signature_data_url: undefined, receipt_number: undefined };
    fireEvent.focus(window);
    const submit = await screen.findByRole("button", { name: "Submit and save signature" });
    expect(submit).toBeDisabled(); expect(screen.getByTestId("signature-value")).toHaveTextContent("");
    expect(screen.queryByRole("heading", { name: "Retained previous signature" })).toBeNull(); expect(screen.queryByRole("img")).toBeNull();
    expect(api.sign).not.toHaveBeenCalled();
    enterIntakeIdentity("New revision signer", "00NEW1");
    api.sign.mockImplementation(async () => { const result = intakeResult("New revision signer", "00NEW1"); freezeIntake(result, "data:image/png;base64,NEW="); return result; });
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(submit);
    await screen.findByText("Signer: New revision signer");
    expect(api.sign).toHaveBeenCalledWith("first-token", "secret-session", expect.objectContaining({ revision: 2, legacy_signature: false, signed: false }), "New revision signer", "00NEW1", "data:image/png;base64,AA==", true);
    expect(screen.getByRole("button", { name: /Receipt with intake form/ })).toBeVisible();
    expect(screen.getByAltText("Saved signature")).toHaveAttribute("src", "data:image/png;base64,NEW=");
  });
  it("requires fresh signature and consent, binds revision and verifies signed readback", async () => {
    pendingIntake();
    api.sign.mockImplementation(async () => { const result = intakeResult(); freezeIntake(result); return result; });
    renderPortal(); await unlock();
    const submit = screen.getByRole("button", { name: "Submit and save signature" }); expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Vehicle deliverer's full name")).toHaveValue("");
    enterIntakeIdentity();
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(submit);
    await screen.findByText("Signed and saved");
    expect(api.sign).toHaveBeenCalledWith("first-token", "secret-session", expect.objectContaining({ id: "entry", revision: 3, signed: false }), "Actual Deliverer", "00123AB", "data:image/png;base64,AA==", true);
    expect(screen.getByText("Signer: Actual Deliverer")).toBeVisible();
    expect(screen.getByText("00123AB")).toBeVisible();
    expect(api.pad.mock.calls.every(([compact]) => compact === false)).toBe(true);
    expect(screen.queryByRole("button", { name: "Submit and save signature" })).toBeNull();
  });
  it("retains an unsaved signature if readback did not confirm persistence", async () => {
    pendingIntake(); api.sign.mockResolvedValue(intakeResult());
    renderPortal(); await unlock(); enterIntakeIdentity(); fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Submit and save signature" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be completed");
    expect(screen.getByTestId("signature-value")).toHaveTextContent("data:image/png;base64,AA==");
    expect(screen.queryByRole("button", { name: /Receipt with intake form/ })).toBeNull();
  });
  it.each(["", "   "])("requires an actual deliverer ID even with a name, drawn ink and consent (%j)", async idNumber => {
    pendingIntake(); renderPortal(); await unlock();
    enterIntakeIdentity("Actual Deliverer", idNumber);
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox"));
    const submit = screen.getByRole("button", { name: "Submit and save signature" });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(api.sign).not.toHaveBeenCalled();
    expect(screen.queryByText("Signed and saved")).toBeNull();
  });
  it("requires the deliverer's name instead of silently using the vehicle owner", async () => {
    pendingIntake(); renderPortal(); await unlock();
    expect(screen.getByLabelText("Vehicle deliverer's full name")).toHaveValue("");
    expect(screen.getByLabelText("Vehicle deliverer's ID number")).toHaveValue("");
    enterIntakeIdentity("   ", "00123AB"); fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox"));
    const submit = screen.getByRole("button", { name: "Submit and save signature" });
    expect(submit).toBeDisabled(); fireEvent.submit(submit.closest("form")!);
    expect(api.sign).not.toHaveBeenCalled();
  });
  it("prefills only the recorded actual deliverer and keeps identity numbers as text", async () => {
    pendingIntake(); portal.entries[0].delivered_by = { full_name: "Canonical Carrier", id_number: "000C99" };
    renderPortal(); await unlock();
    expect(screen.getByLabelText("Vehicle deliverer's full name")).toHaveValue("Canonical Carrier");
    const identity = screen.getByLabelText("Vehicle deliverer's ID number");
    expect(identity).toHaveValue("000C99"); expect(identity).toHaveProperty("type", "text"); expect(identity).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: "Submit and save signature" })).toBeDisabled();
    expect(api.sign).not.toHaveBeenCalled();
  });
  it("confirms the exact newly frozen revision and normalized identity when signing advances the revision", async () => {
    pendingIntake(); const result = intakeResult("Actual Carrier", "00123AB", 4);
    api.sign.mockImplementation(async () => { freezeIntake(result); return result; });
    renderPortal(); await unlock(); enterIntakeIdentity("Actual Carrier", "٠٠١۲۳AB");
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Submit and save signature" }));
    await screen.findByText("Signer: Actual Carrier");
    expect(screen.getByText("00123AB")).toBeVisible(); expect(screen.getByText("Private Customer")).toBeVisible();
    expect(api.sign).toHaveBeenCalledExactlyOnceWith("first-token", "secret-session", expect.objectContaining({ id: "entry", revision: 3 }), "Actual Carrier", "00123AB", ink, true);
    expect(screen.getByRole("button", { name: /Receipt with intake form/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit and save signature" })).toBeNull();
  });
  it.each([
    ["previous revision", { revision: 3 }],
    ["different signature", { signature_id: "different-signature" }],
    ["different receipt", { receipt_id: "different-receipt" }],
    ["different receipt number", { receipt_number: "DIFFERENT-RECEIPT" }],
    ["different signer", { signer_name: "Vehicle owner" }],
    ["different signer ID", { signer_id_number: "123AB" }],
    ["missing frozen original", { has_frozen_document: false }],
    ["legacy ink", { legacy_signature: true }],
    ["different canonical name", { delivered_by: { full_name: "Vehicle owner", id_number: "00123AB" } }],
    ["different canonical ID", { delivered_by: { full_name: "Actual Deliverer", id_number: "123AB" } }],
  ])("never confirms signing when readback has %s", async (_label, overrides) => {
    pendingIntake(); const result = intakeResult("Actual Deliverer", "00123AB", 4);
    api.sign.mockImplementation(async () => { freezeIntake(result); Object.assign(portal.entries[0], overrides); return result; });
    renderPortal(); await unlock(); enterIntakeIdentity();
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Submit and save signature" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be completed");
    expect(screen.getByTestId("signature-value")).toHaveTextContent(ink); expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.queryByText("Signed and saved")).toBeNull(); expect(screen.queryByRole("button", { name: /Receipt with intake form/ })).toBeNull();
  });
  it.each(["name", "id"])("invalidates the intake ink and consent when the %s changes", async field => {
    pendingIntake(); renderPortal(); await unlock(); enterIntakeIdentity();
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Submit and save signature" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(field === "name" ? "Vehicle deliverer's full name" : "Vehicle deliverer's ID number"), { target: { value: field === "name" ? "Different Carrier" : "000DIFFERENT" } });
    expect(screen.getByTestId("signature-value")).toHaveTextContent(""); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit and save signature" })).toBeDisabled();
    expect(screen.getByLabelText(field === "name" ? "Vehicle deliverer's ID number" : "Vehicle deliverer's full name")).toHaveValue(field === "name" ? "00123AB" : "Actual Deliverer");
    expect(api.sign).not.toHaveBeenCalled();
  });
  it.each(["lock", "different link"])("clears the unsaved intake identity and ink after %s", async action => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    pendingIntake(); renderPortal(); await unlock(); enterIntakeIdentity("CLIENT UNSAVED CARRIER", "CLIENT-DRAFT-001");
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: action === "lock" ? "Lock portal" : "Change vehicle" }));
    expect(screen.queryByDisplayValue("CLIENT-DRAFT-001")).toBeNull(); expect(screen.queryByTestId("signature-value")).toBeNull();
    await unlock();
    expect(screen.getByLabelText("Vehicle deliverer's full name")).toHaveValue(""); expect(screen.getByLabelText("Vehicle deliverer's ID number")).toHaveValue("");
    expect(screen.getByTestId("signature-value")).toHaveTextContent(""); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(JSON.stringify(stored.mock.calls)).not.toContain("CLIENT-DRAFT-001"); expect(api.sign).not.toHaveBeenCalled();
  });
  it.each(["ar", "en"])("labels the required deliverer fields and safe identity error in %s", async language => {
    api.language = language; pendingIntake(); api.sign.mockRejectedValue(new VehiclePortalError("identity"));
    renderPortal(); await unlock(); enterIntakeIdentity();
    expect(screen.getByLabelText(language === "ar" ? "اسم مُسلّم المركبة الكامل" : "Vehicle deliverer's full name")).toBeRequired();
    expect(screen.getByLabelText(language === "ar" ? "رقم بطاقة مُسلّم المركبة" : "Vehicle deliverer's ID number")).toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: language === "ar" ? "إرسال التوقيع وحفظه" : "Submit and save signature" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(language === "ar" ? "أدخل اسم مُسلّم المركبة ورقم بطاقته بشكل صحيح" : "Enter the vehicle deliverer's name and ID number correctly");
    expect(screen.queryByText(language === "ar" ? "موقّع ومحفوظ" : "Signed and saved")).toBeNull();
  });
  it("revalidates manager pause on focus and wipes all private content", async () => {
    renderPortal(); await unlock(); api.read.mockRejectedValueOnce(new VehiclePortalError("disabled"));
    fireEvent.focus(window);
    expect(await screen.findByRole("alert")).toHaveTextContent("paused this link");
    expect(screen.queryByText("Private Customer")).toBeNull(); expect(screen.queryByText("Original Signer")).toBeNull();
  });
  it("opens enabled work order and delivery without rendering financial fields", async () => {
    portal.order = { enabled: true, signed: true, order_number: "WO-1", signer_name: "Order signer", work_summary: "Replace bumper" };
    portal.delivery = { enabled: true, recipient_name: "Actual recipient", receipt_number: "RCPT-1" };
    Object.assign(portal, { invoices: [{ number: "PRIVATE-INVOICE" }], expenses: [{ name: "PRIVATE-EXPENSE" }], payments: [{ amount: "PRIVATE-AMOUNT" }] });
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    expect(screen.getByText("Replace bumper")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Final delivery" })); expect(screen.getByText(/Actual recipient/)).toBeVisible();
    expect(screen.queryByText(/PRIVATE-INVOICE|PRIVATE-EXPENSE|PRIVATE-AMOUNT/)).toBeNull();
  });
  it("keeps temporary release signing under intake and uses the authenticated session", async () => {
    portal.entries[0].releases = [{ id: "release", digest: "release-digest", recipient_name: "Actual inspector", release_number: "REL-1", status: "awaiting_signature", declaration_en: "Inspection release declaration", form_data: { inspection_summary: "Diagnostic inspection", pending_action: "Awaiting parts availability", exit_condition: "Requires towing / transport", visible_damage: "Visible dent", notes: "Inspection findings reviewed" } }];
    api.signRelease.mockImplementation(async () => { portal.entries[0].releases![0].signed_at = "2026-11-14T06:00:00Z"; });
    renderPortal(); await unlock(); expect(screen.getByText("Inspection release declaration")).toBeVisible();
    expect(screen.getByText("Requires towing / transport")).toBeVisible(); expect(screen.getByText("Visible dent")).toBeVisible();
    expect(screen.getByLabelText("Signer's full name")).toHaveValue("Actual inspector");
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Submit and save signature" }));
    await waitFor(() => expect(api.signRelease).toHaveBeenCalledWith("first-token", "secret-session", expect.objectContaining({ id: "release", digest: "release-digest" }), "Actual inspector", "data:image/png;base64,AA==", true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Submit and save signature" })).toBeNull());
  });
  it("refreshes changed order terms and requires a fresh signature for the new digest", async () => {
    portal.order = { enabled: true, id: "order", digest: "first-digest", order_number: "WO-1", diagnosis: "First diagnosis", work_items: [{ title: "Repair bumper", note: "Approved work item" }], declaration_en: "Authorize listed work", signed: false };
    api.signOrder.mockImplementation(async () => {
      portal.order = { ...portal.order!, digest: "new-digest", diagnosis: "Updated diagnosis" };
      throw new VehiclePortalError("changed");
    });
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    expect(screen.getByText("Repair bumper")).toBeVisible(); expect(screen.getByText("Authorize listed work")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Draw signature" })); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Submit and save signature" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("document changed before saving");
    expect(screen.getByText("Updated diagnosis")).toBeVisible(); expect(screen.getByTestId("signature-value")).toHaveTextContent(""); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(api.signOrder).toHaveBeenCalledWith("first-token", "secret-session", expect.objectContaining({ id: "order", digest: "first-digest" }), "Private Customer", "data:image/png;base64,AA==", true);
    expect(screen.queryByText("Order signer")).toBeNull();
  });
  it("labels historical work-order signatures without pairing old ink with live terms", async () => {
    portal.order = { enabled: true, id: "legacy-order", digest: "current-digest", order_number: "WO-1", signed: true, legacy_signature: true, signature_data_url: "data:image/png;base64,AA==", signer_name: "Historical signer", work_summary: "Current work reference" };
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    expect(screen.getByText("Previously signed; the original signed content snapshot is unavailable.")).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("button", { name: "Submit and save signature" })).toBeNull();
  });
  it("keeps tracking photos and progress gated until unlock and claim approval", async () => {
    portal.order = { enabled: false, id: "order", signed: true, tracking: { stage_key: "in_repair", progress_pct: 70, photos: [{ url: "https://storage.example/work-photo", caption: "Repair progress", phase: "in_repair" }] } };
    renderPortal(); expect(screen.queryByText("Under repair")).toBeNull(); expect(screen.queryByAltText("Repair progress")).toBeNull();
    await unlock(); expect(screen.queryByText("Under repair")).toBeNull(); expect(screen.queryByAltText("Repair progress")).toBeNull();
    portal.order.enabled = true; fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole("button", { name: "Work order" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    expect(screen.getByText("Under repair")).toBeVisible(); expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByAltText("Repair progress")).toHaveAttribute("src", "https://storage.example/work-photo"); expect(screen.getByText("During repair")).toBeVisible();
    expect(api.feedback).not.toHaveBeenCalled(); expect(api.note).not.toHaveBeenCalled();
  });
  it("uses safe tracking images, bounded progress and localized unknown-stage fallback", async () => {
    portal.order = { enabled: true, id: "order", signed: true, tracking: { stage_key: "SECRET-INTERNAL-STAGE", progress_pct: 190, photos: [{ url: "javascript:alert(1)", caption: "Unsafe photo" }, { url: "https://storage.example/safe", caption: "Safe photo", phase: "SECRET-INTERNAL-PHASE" }] } };
    Object.assign(portal.order.tracking!, { invoices: "PRIVATE-INVOICE", expenses: "PRIVATE-EXPENSE" });
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"); expect(screen.getByText("Status update pending")).toBeVisible();
    expect(screen.getByAltText("Safe photo")).toBeVisible(); expect(screen.queryByAltText("Unsafe photo")).toBeNull();
    expect(screen.queryByText(/SECRET-INTERNAL|PRIVATE-INVOICE|PRIVATE-EXPENSE/)).toBeNull();
  });
  it("saves a displayed-order note only after confirming the latest persisted message", async () => {
    portal.order = { enabled: true, id: "order", signed: true, tracking: { stage_key: "in_repair", progress_pct: 70, messages: [] } };
    api.note.mockImplementation(async (_token, _session, _orderId, note) => { portal.order!.tracking!.messages = [{ message: note.trim(), created_at: "2026-11-14T06:00:00Z" }]; });
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" })); fireEvent.click(screen.getByText("Notes and workshop communication"));
    fireEvent.change(screen.getByLabelText("Your note to the workshop"), { target: { value: " Please call before collection " } }); fireEvent.click(screen.getByRole("button", { name: "Send note" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Your note was saved"); expect(screen.getByLabelText("Your note to the workshop")).toHaveValue("");
    expect(screen.getByText("Please call before collection")).toBeVisible();
    expect(api.note).toHaveBeenCalledWith("first-token", "secret-session", "order", " Please call before collection ");
    expect(screen.queryByRole("button", { name: "Submit feedback" })).toBeNull();
  });
  it("accepts feedback once after delivery and confirms saved rating and comment", async () => {
    portal.order = { enabled: true, id: "order", signed: true, tracking: { stage_key: "delivered", progress_pct: 100, feedback: null } };
    api.feedback.mockImplementation(async (_token, _session, _orderId, rating, comment) => { portal.order!.tracking!.feedback = { rating, comment: comment.trim(), created_at: "2026-11-14T06:00:00Z" }; });
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    fireEvent.click(screen.getByRole("button", { name: "5 out of 5 stars" })); fireEvent.change(screen.getByLabelText("Optional comment"), { target: { value: "Good workshop service" } }); fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText("Good workshop service"); expect(screen.getByText("5 / 5")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit feedback" })).toBeNull();
    expect(api.feedback).toHaveBeenCalledWith("first-token", "secret-session", "order", 5, "Good workshop service");
  });
  it("preserves feedback inputs when acknowledgement is not confirmed by readback", async () => {
    portal.order = { enabled: true, id: "order", signed: true, tracking: { stage_key: "delivered", progress_pct: 100, feedback: null } }; api.feedback.mockResolvedValue(undefined);
    renderPortal(); await unlock(); fireEvent.click(screen.getByRole("button", { name: "Work order" }));
    fireEvent.click(screen.getByRole("button", { name: "4 out of 5 stars" })); fireEvent.change(screen.getByLabelText("Optional comment"), { target: { value: "Keep this unsaved comment" } }); fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be completed"); expect(screen.getByLabelText("Optional comment")).toHaveValue("Keep this unsaved comment"); expect(screen.getByRole("button", { name: "4 out of 5 stars" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("staff portal lifecycle controls", () => {
  it("treats non-date closed-only expiry as expired and disables sharing", async () => {
    staff!.expires_at = "-infinity"; renderStaff(); await screen.findByRole("textbox", { name: "Customer portal link" });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Send portal by WhatsApp" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Reactivate link" })).toBeVisible();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
  it("reads without automatically preparing a token or sending messages", async () => {
    staff = null; renderStaff(); await screen.findByRole("button", { name: "Prepare customer link" });
    expect(api.ensure).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
    api.ensure.mockImplementation(async () => { staff = { token: "created", enabled: true, expires_at: null }; });
    fireEvent.click(screen.getByRole("button", { name: "Prepare customer link" }));
    await screen.findByRole("textbox", { name: "Customer portal link" }); expect(api.ensure).toHaveBeenCalledWith("entry");
    expect(api.context.mock.calls.length).toBeGreaterThanOrEqual(2); expect(api.send).not.toHaveBeenCalled();
  });
  it("shows manager controls only to managers and does not expose them to supervisors", async () => {
    api.role = "supervisor"; renderStaff(); await screen.findByRole("textbox", { name: "Customer portal link" });
    expect(screen.queryByRole("button", { name: "Pause link" })).toBeNull(); expect(screen.queryByRole("button", { name: "Approve final delivery for customer" })).toBeNull();
    expect(api.toggle).not.toHaveBeenCalled(); expect(api.approve).not.toHaveBeenCalled();
  });
  it("does not claim manager approval if readback still reports a pending handover", async () => {
    api.approve.mockResolvedValue(staff); renderStaff(); fireEvent.click(await screen.findByRole("button", { name: "Approve final delivery for customer" }));
    await waitFor(() => expect(api.failure).toHaveBeenCalled());
    expect(api.success).not.toHaveBeenCalled(); expect(api.approve).toHaveBeenCalledWith("entry");
  });
});
