// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ClaimEngineerEmailPacket } from "@/lib/claimEngineerEmail";
import { emptyVehicleTechnicalDeclaration } from "@/lib/vehicleTechnicalDeclaration";
const api = vi.hoisted(() => ({ prepare: vi.fn(), send: vi.fn(), build: vi.fn(), encode: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/claimEngineerEmail", async original => ({ ...await original<typeof import("@/lib/claimEngineerEmail")>(),
  prepareClaimEngineerEmail: api.prepare, sendClaimEngineerEmail: api.send, encodeClaimEngineerGeneratedPdf: api.encode }));
vi.mock("@/lib/claimEngineerEmailDocuments", async original => ({ ...await original<typeof import("@/lib/claimEngineerEmailDocuments")>(), buildClaimEngineerDocumentPdf: api.build }));
vi.mock("@/lib/pdfFileDownload", () => ({ downloadPdfBlob: api.download }));
import ClaimEngineerEmailDialog from "@/components/insurance/ClaimEngineerEmailDialog";

function packet(overrides: Partial<ClaimEngineerEmailPacket> = {}): ClaimEngineerEmailPacket {
  return { claimId: "claim", entryId: "visit", entryNumber: "ENT-1", subject: "C/004/15/26/2510/00103 HONDA ACCORD61905/M",
    recipient: { id: "engineer", name: "Saved Engineer", email: "engineer@example.test" }, contextHash: "context-1",
    attachments: [
      { id: "doc", kind: "source_document", fileName: "claim-original.pdf", mimeType: "application/pdf", byteSize: 1000, bucket: "private", storagePath: "tenant/claim.pdf" },
      { id: "photo", kind: "vehicle_photo", fileName: "damage-original.jpg", mimeType: "image/jpeg", byteSize: 2000, bucket: "private", storagePath: "tenant/damage.jpg" },
    ], technicalDeclaration: null, gmail: { enabled: true, configured: true, fromEmail: "workshop@example.test" },
    body: "Please review the attached documents.", limitBytes: 20 * 1024 * 1024, warnings: [], ...overrides };
}
function show(entryId?: string, allowOwnerTest = false) { return render(<ClaimEngineerEmailDialog open onOpenChange={vi.fn()} claimId="claim" entryId={entryId} allowOwnerTest={allowOwnerTest} />); }
const sendButton = () => screen.getByRole("button", { name: "Send to engineer" });

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  api.prepare.mockReset().mockResolvedValue({ ok: true, packet: packet() });
  api.send.mockReset().mockResolvedValue({ ok: true, status: "sent", logId: "log", providerMessageId: "gmail" });
  api.build.mockReset().mockResolvedValue(new Blob(["%PDF synthetic"], { type: "application/pdf" }));
  api.encode.mockReset().mockImplementation(async (_blob, doc) => ({ id: doc.id, sourceHash: doc.sourceHash, sha256: "pdf-hash", base64: "JVBERg==" }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:exact-pdf") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("engineer packet review and send", () => {
  it("keeps the saved engineer and exact subject read-only, selects originals, and sends only chosen IDs", async () => {
    show();
    expect(await screen.findByLabelText("Saved engineer email")).toHaveValue("engineer@example.test");
    expect(screen.getByLabelText("Saved engineer email")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Email subject")).toHaveValue(packet().subject);
    expect(screen.getByLabelText("Email subject")).toHaveAttribute("readonly");
    expect(screen.getByRole("checkbox", { name: "claim-original.pdf" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "damage-original.jpg" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "damage-original.jpg" }));
    fireEvent.change(screen.getByLabelText("Additional note to the engineer"), { target: { value: "Inspect left door" } });
    fireEvent.click(sendButton());
    await screen.findByText("Sending was confirmed and recorded in communication history.");
    expect(api.send).toHaveBeenCalledExactlyOnceWith({ claimId: "claim", entryId: "visit", language: "en", contextHash: "context-1", selectedAttachmentIds: ["doc"], note: "Inspect left door", templateId: "inspection_status", recipientMode: "engineer", generatedPdfs: [] });
    expect(sendButton()).toBeDisabled();
  });
  it("blocks disabled Gmail and links directly to integration settings", async () => {
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ gmail: { enabled: false, configured: false, fromEmail: "" } }) });
    show(); await screen.findByText("Gmail sending is disabled. Enable it in integration settings.");
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("link", { name: "Gmail integration settings" })).toHaveAttribute("href", "/settings/integrations");
    expect(api.send).not.toHaveBeenCalled();
  });
  it("shows a missing saved engineer email without a company-email fallback", async () => {
    api.prepare.mockResolvedValue({ ok: false, error: "claim_email_engineer_email_required" });
    show(); await screen.findByText(/The saved engineer has no valid email/);
    expect(sendButton()).toBeDisabled();
    expect(screen.queryByLabelText("Saved engineer email")).toBeNull();
    expect(screen.getByRole("link", { name: "Open claim" })).toHaveAttribute("href", "/insurance/claim");
  });
  it("requires an explicit visit choice and freshly prepares that visit", async () => {
    api.prepare.mockResolvedValueOnce({ ok: false, error: "claim_email_visit_required", entries: [
      { id: "visit-one", entryNumber: "ENT-ONE", arrivalDate: "2026-11-20", status: "Issued" },
      { id: "visit-two", entryNumber: "ENT-TWO", arrivalDate: "2026-11-24", status: "Issued" },
    ] }).mockResolvedValueOnce({ ok: true, packet: packet({ entryId: "visit-one", entryNumber: "ENT-ONE" }) });
    show(); const visits = await screen.findByLabelText("Vehicle visit");
    expect(visits).toHaveValue(""); expect(sendButton()).toBeDisabled();
    expect(api.prepare).toHaveBeenCalledTimes(1);
    fireEvent.change(visits, { target: { value: "visit-one" } });
    await screen.findByLabelText("Saved engineer email");
    expect(api.prepare).toHaveBeenLastCalledWith("claim", "visit-one", "en", { templateId: "inspection_status", recipientMode: "engineer" });
  });
  it("blocks oversized selections and enables sending after files are deselected", async () => {
    const files = packet().attachments.map(file => ({ ...file, byteSize: 11 * 1024 * 1024 }));
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ attachments: files }) });
    show(); await screen.findByText(/Deselect some files/);
    expect(sendButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "damage-original.jpg" }));
    expect(sendButton()).toBeEnabled();
  });
  it("renders one saved technical PDF with the active language and permits deselecting it", async () => {
    const technicalDeclaration = { id: "technical", revision: 2, sourceHash: "source-hash", formData: { ...emptyVehicleTechnicalDeclaration }, fileName: "technical-declaration.pdf" };
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ technicalDeclaration }) });
    show(); await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(api.build).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "technical:technical", sourceHash: "source-hash", data: { formData: technicalDeclaration.formData, entryNumber: "ENT-1" } }), "en");
    expect(screen.getByRole("checkbox", { name: "technical-declaration.pdf" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "technical-declaration.pdf" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "damage-original.jpg" }));
    fireEvent.click(sendButton()); await screen.findByText(/Sending was confirmed/);
    expect(api.build).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0][0]).toMatchObject({ selectedAttachmentIds: ["doc"], generatedPdfs: [] });
  });
  it("blocks selected failed PDFs until the user explicitly deselects them", async () => {
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ technicalDeclaration: { id: "technical", revision: 1, sourceHash: "hash", formData: { ...emptyVehicleTechnicalDeclaration }, fileName: "technical.pdf" } }) });
    api.build.mockRejectedValue(new Error("render failed"));
    show(); await screen.findByText(/This PDF could not be prepared/);
    expect(sendButton()).toBeDisabled(); expect(api.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "technical.pdf" }));
    expect(sendButton()).toBeEnabled();
  });
  it("refreshes stale saved details and requires another reviewed send click", async () => {
    api.prepare.mockResolvedValueOnce({ ok: true, packet: packet() }).mockResolvedValueOnce({ ok: true, packet: packet({ contextHash: "context-2", recipient: { id: "new", name: "New Engineer", email: "new@example.test" } }) });
    api.send.mockResolvedValueOnce({ ok: false, error: "claim_email_context_changed" });
    show(); await waitFor(() => expect(sendButton()).toBeEnabled()); fireEvent.click(sendButton());
    await screen.findByText("Saved details changed. Review the refreshed packet before sending again.");
    expect(screen.getByLabelText("Saved engineer email")).toHaveValue("new@example.test");
    expect(api.send).toHaveBeenCalledTimes(1); expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton()); await screen.findByText(/Sending was confirmed/);
    expect(api.send.mock.calls[1][0].contextHash).toBe("context-2");
  });
  it.each(["server", "transport", "unknown-success"])("retains an unconfirmed delivery warning without retrying (%s)", async mode => {
    if (mode === "transport") api.send.mockRejectedValue(new Error("response lost"));
    else api.send.mockResolvedValue(mode === "server" ? { ok: false, error: "claim_email_delivery_unconfirmed", status: "unconfirmed" } : { ok: true, status: "queued", logId: "log" });
    show(); await waitFor(() => expect(sendButton()).toBeEnabled()); fireEvent.click(sendButton());
    await screen.findByText(/Delivery could not be confirmed/);
    expect(sendButton()).toBeDisabled(); expect(api.send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh packet" }));
    await waitFor(() => expect(api.prepare).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Delivery could not be confirmed/)).toBeVisible();
    expect(sendButton()).toBeDisabled(); expect(api.send).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Sending was confirmed/)).toBeNull();
  });
  it("discards a late preparation response after the visit prop changes", async () => {
    let resolve!: (value: unknown) => void;
    api.prepare.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ok: true, packet: packet({ entryId: "new-visit", recipient: { id: "new", name: "New Engineer", email: "new@example.test" } }) });
    const view = show("old-visit");
    view.rerender(<ClaimEngineerEmailDialog open onOpenChange={vi.fn()} claimId="claim" entryId="new-visit" />);
    await screen.findByDisplayValue("new@example.test");
    await act(async () => resolve({ ok: true, packet: packet() }));
    expect(screen.getByLabelText("Saved engineer email")).toHaveValue("new@example.test");
  });
  it("uses Arabic labels when Arabic is active and English-only labels when switched", async () => {
    await i18n.changeLanguage("ar"); show();
    expect(await screen.findByRole("heading", { name: "نماذج إرسال المهندس" })).toBeVisible();
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(await screen.findByRole("heading", { name: "Engineer email templates" })).toBeVisible();
    expect(screen.queryByText("نماذج إرسال المهندس")).toBeNull();
  });

  it("starts priority originals, signed intake and estimate checked while financial and technical files remain selectable", async () => {
    const kinds = ["signed_intake", "repair_estimate", "quote", "invoice", "work_order"] as const;
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ attachments: [...packet().attachments, ...kinds.map(kind => ({
      id: kind, kind, fileName: `${kind}.pdf`, mimeType: "application/pdf", byteSize: 500, bucket: "private", storagePath: `tenant/${kind}.pdf`,
      defaultSelected: ["signed_intake", "repair_estimate"].includes(kind),
    }))], generatedDocuments: [{ id: "technical:saved", kind: "technical_declaration", sourceKind: "technical_declaration", sourceId: "saved",
      sourceHash: "saved-hash", fileName: "optional-technical.pdf", mimeType: "application/pdf", renderer: "technical_declaration", data: {}, defaultSelected: false }] }) });
    show(); await screen.findByLabelText("Saved engineer email");
    for (const name of ["claim-original.pdf", "damage-original.jpg", "signed_intake.pdf", "repair_estimate.pdf"]) expect(screen.getByRole("checkbox", { name })).toBeChecked();
    for (const name of ["quote.pdf", "invoice.pdf", "work_order.pdf", "optional-technical.pdf"]) expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    expect(api.build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "quote.pdf" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "signed_intake.pdf" }));
    fireEvent.click(sendButton()); await screen.findByText(/Sending was confirmed/);
    expect(api.send.mock.calls[0][0].selectedAttachmentIds).toEqual(["doc", "photo", "repair_estimate", "quote"]);
    expect(api.send.mock.calls[0][0].generatedPdfs).toEqual([]);
  });

  it("reprepares a changed template for the explicitly chosen visit and resets template defaults", async () => {
    api.prepare.mockResolvedValueOnce({ ok: false, error: "claim_email_visit_required", entries: [{ id: "visit-one", entryNumber: "ENT-ONE", arrivalDate: null, status: "Issued" }] })
      .mockResolvedValue({ ok: true, packet: packet({ entryId: "visit-one" }) });
    show(); fireEvent.change(await screen.findByLabelText("Vehicle visit"), { target: { value: "visit-one" } });
    await screen.findByLabelText("Saved engineer email");
    fireEvent.click(screen.getByRole("checkbox", { name: "damage-original.jpg" }));
    fireEvent.change(screen.getByLabelText("Email template"), { target: { value: "invoice_submission" } });
    await waitFor(() => expect(api.prepare).toHaveBeenLastCalledWith("claim", "visit-one", "en", { templateId: "invoice_submission", recipientMode: "engineer" }));
    expect(await screen.findByRole("checkbox", { name: "damage-original.jpg" })).toBeChecked();
    expect(screen.getAllByRole("option")).toHaveLength(8); // six templates plus explicit visit choice
  });

  it("shows saved status facts, missing values and their sources and appends the exact note to the preview", async () => {
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ statusSummary: [
      { key: "runs", label: "Vehicle runs", value: null, source: "vehicle_entry" },
      { key: "remarks", label: "Inspection remarks", value: "Saved left door damage", source: "inspection" },
    ] }) });
    show(); await screen.findByRole("region", { name: "Saved inspection and status" });
    expect(screen.getByText("Not recorded")).toBeVisible();
    expect(screen.getByText("Saved left door damage")).toBeVisible();
    expect(screen.getByText("Source: Inspection report")).toBeVisible();
    expect(screen.getByText("Source: Vehicle entry")).toBeVisible();
    expect(screen.queryByText(/vehicle_entry/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Additional note to the engineer"), { target: { value: "  Check wheel alignment  " } });
    expect(screen.getByLabelText("Email preview")).toHaveTextContent("Please review the attached documents. Check wheel alignment");
  });

  it.each(["en", "ar"])("localizes saved-status sources without exposing technical keys in %s", async lang => {
    await i18n.changeLanguage(lang);
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ statusSummary: [
      { key: "claim", label: "Saved claim", value: "C/1", source: "insurance_claim" },
      { key: "order", label: "Saved order", value: "WO-1", source: "job_order" },
      { key: "other", label: "Other saved fact", value: "Unchanged fact", source: "future_private_source" },
    ] }) });
    show();
    expect(await screen.findByText(lang === "en" ? "Source: Claim" : "المصدر: المطالبة")).toBeVisible();
    expect(screen.getByText(lang === "en" ? "Source: Work order" : "المصدر: أمر العمل")).toBeVisible();
    expect(screen.getByText(lang === "en" ? "Source: Not recorded" : "المصدر: غير مسجل")).toBeVisible();
    expect(screen.getByText("Unchanged fact")).toBeVisible();
    for (const key of ["insurance_claim", "job_order", "future_private_source"]) expect(screen.queryByText(new RegExp(key))).toBeNull();
  });

  it("reuses the same generated PDF for preview, download and the individually selected attachment", async () => {
    const doc = { id: "entry:receipt", kind: "signed_intake" as const, sourceKind: "intake_receipt", sourceId: "receipt", sourceHash: "frozen-entry-hash",
      fileName: "signed-entry.pdf", mimeType: "application/pdf" as const, renderer: "vehicle_entry" as const, data: { entry: { signatures: ["saved"] } }, defaultSelected: true };
    const exactBlob = new Blob(["%PDF saved signature"], { type: "application/pdf" });
    api.build.mockResolvedValue(exactBlob);
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ generatedDocuments: [doc] }) });
    show(); await waitFor(() => expect(sendButton()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Preview signed-entry.pdf" }));
    expect(await screen.findByTitle("Attachment PDF preview")).toHaveAttribute("src", "blob:exact-pdf");
    fireEvent.click(screen.getByRole("button", { name: "Download preview copy" }));
    expect(api.download).toHaveBeenCalledExactlyOnceWith(exactBlob, "signed-entry.pdf");
    fireEvent.click(sendButton()); await screen.findByText(/Sending was confirmed/);
    expect(api.build).toHaveBeenCalledExactlyOnceWith(doc, "en");
    expect(api.encode).toHaveBeenCalledExactlyOnceWith(exactBlob, doc);
    expect(api.send.mock.calls[0][0]).toMatchObject({ selectedAttachmentIds: ["doc", "photo", "entry:receipt"], generatedPdfs: [{ id: doc.id, sourceHash: "frozen-entry-hash", base64: "JVBERg==", sha256: "pdf-hash" }] });
  });

  it("blocks the generated PDF aggregate above 8 MB until the user deselects a file", async () => {
    api.build.mockResolvedValue(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "application/pdf" }));
    api.prepare.mockResolvedValue({ ok: true, packet: packet({ generatedDocuments: [1, 2, 3].map(id => ({ id: `entry:${id}`, kind: "signed_intake", sourceKind: "intake_receipt", sourceId: String(id), sourceHash: `hash-${id}`,
      fileName: `entry-${id}.pdf`, mimeType: "application/pdf", renderer: "vehicle_entry", data: {}, defaultSelected: true })) }) });
    show(); await screen.findByText(/generated PDFs together to 8 MB/);
    expect(sendButton()).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "entry-3.pdf" })); });
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it("allows the administrator's explicit real owner test even when no saved engineer exists, with no editable recipient", async () => {
    api.prepare.mockResolvedValueOnce({ ok: false, error: "claim_email_engineer_required" }).mockResolvedValue({ ok: true, packet: packet({
      recipient: { id: "owner-test", name: "Owner test", email: "alwafa.oman1@gmail.com" }, recipientMode: "owner_test", ownerTestAllowed: true, contextHash: "owner-context",
    }) });
    show(undefined, true); await screen.findByText("Save the assigned engineer on the claim first.");
    fireEvent.change(screen.getByLabelText("Send destination"), { target: { value: "owner_test" } });
    const recipient = await screen.findByLabelText("Fixed owner email");
    expect(recipient).toHaveValue("alwafa.oman1@gmail.com"); expect(recipient).toHaveAttribute("readonly");
    const button = screen.getByRole("button", { name: "Send real owner test" });
    expect(button).toBeDisabled(); expect(api.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm real test email" }));
    fireEvent.click(button); await screen.findByText(/Sending was confirmed/);
    expect(api.prepare).toHaveBeenLastCalledWith("claim", undefined, "en", { templateId: "inspection_status", recipientMode: "owner_test" });
    expect(api.send.mock.calls[0][0]).toMatchObject({ recipientMode: "owner_test", confirmOwnerTest: true, contextHash: "owner-context" });
    expect(api.send.mock.calls[0][0]).not.toHaveProperty("recipient");
  });

  it("hides owner test controls for non-administrators and blocks sending an empty selection", async () => {
    show(); await screen.findByLabelText("Saved engineer email");
    expect(screen.queryByLabelText("Send destination")).toBeNull();
    for (const name of ["claim-original.pdf", "damage-original.jpg"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    expect(sendButton()).toBeDisabled(); expect(api.send).not.toHaveBeenCalled();
  });
  it.each(["en", "ar"])("explains an owner test sender mismatch and blocks sending in %s", async lang => {
    await i18n.changeLanguage(lang);
    api.prepare.mockResolvedValueOnce({ ok: true, packet: packet() }).mockResolvedValueOnce({ ok: false, error: "claim_email_owner_test_mailbox_mismatch" });
    show(undefined, true);
    await screen.findByLabelText(lang === "en" ? "Saved engineer email" : "بريد المهندس المحفوظ");
    fireEvent.change(screen.getByLabelText(lang === "en" ? "Send destination" : "وجهة الإرسال"), { target: { value: "owner_test" } });
    expect(await screen.findByText(lang === "en"
      ? "Owner testing is available only when this workshop's configured Gmail sender is alwafa.oman1@gmail.com. Check Gmail integration settings."
      : "اختبار المالك متاح فقط عندما يكون مرسل Gmail المرتبط بهذه المنشأة هو alwafa.oman1@gmail.com. راجع إعدادات ربط Gmail.")).toBeVisible();
    expect(screen.getByRole("button", { name: lang === "en" ? "Send real owner test" : "إرسال اختبار حقيقي للمالك" })).toBeDisabled();
    expect(screen.getByRole("link", { name: lang === "en" ? "Gmail integration settings" : "إعدادات ربط Gmail" })).toHaveAttribute("href", "/settings/integrations");
    expect(screen.queryByLabelText(lang === "en" ? "Fixed owner email" : "بريد المالك الثابت")).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
  });
});
