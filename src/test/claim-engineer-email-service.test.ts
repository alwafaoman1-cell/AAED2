import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
import { confirmedClaimEngineerEmailSent, encodeClaimEngineerGeneratedPdf, encodeClaimEngineerTechnicalPdf, persistedEntryClaimId,
  prepareClaimEngineerEmail, sendClaimEngineerEmail } from "@/lib/claimEngineerEmail";

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());

describe("engineer packet API boundary", () => {
  it("sends only a fixed owner test mode plus explicit consent, template and selected generated PDFs", async () => {
    api.invoke.mockResolvedValue({ data: { ok: true, packet: {} }, error: null });
    await prepareClaimEngineerEmail("claim", "entry", "ar", { templateId: "invoice_submission", recipientMode: "owner_test" });
    expect(api.invoke.mock.calls[0][1].body).toEqual({ action: "prepare_claim_engineer_email", claim_id: "claim", entry_id: "entry", language: "ar", template_id: "invoice_submission", recipient_mode: "owner_test", test_mode: true });
    const doc = { id: "entry:receipt", sourceHash: "frozen", base64: "JVBERg==", sha256: "pdf" };
    await sendClaimEngineerEmail({ claimId: "claim", entryId: "entry", language: "ar", contextHash: "context", selectedAttachmentIds: [doc.id], note: "", templateId: "invoice_submission", recipientMode: "owner_test", confirmOwnerTest: true, generatedPdfs: [doc] });
    expect(api.invoke.mock.calls[1][1].body).toMatchObject({ template_id: "invoice_submission", recipient_mode: "owner_test", test_mode: true, confirm_owner_test: true, selected_attachment_ids: [doc.id], generated_pdfs: [doc] });
    expect(api.invoke.mock.calls[1][1].body).not.toHaveProperty("to");
    expect(api.invoke.mock.calls[1][1].body).not.toHaveProperty("technical_pdf");
  });
  it("binds exact generated PDF bytes to both frozen source and document id and rejects oversize before reading", async () => {
    const pdf = new Blob(["%PDF frozen signed intake"], { type: "application/pdf" });
    const payload = await encodeClaimEngineerGeneratedPdf(pdf, { id: "entry:receipt", sourceHash: "frozen" });
    expect(payload.id).toBe("entry:receipt"); expect(payload.sourceHash).toBe("frozen");
    expect(Buffer.from(payload.base64, "base64").toString()).toBe("%PDF frozen signed intake");
    const oversized = { size: 3 * 1024 * 1024 + 1, arrayBuffer: vi.fn() };
    await expect(encodeClaimEngineerGeneratedPdf(oversized as unknown as Blob, { id: "quote:id", sourceHash: "saved" })).rejects.toThrow("claim_email_generated_pdf_too_large");
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });
  it("sends persisted context and original IDs without downloading originals or allowing a recipient override", async () => {
    api.invoke.mockResolvedValue({ data: { ok: true, status: "sent", providerMessageId: "gmail-1", logId: "log-1" }, error: null });
    await sendClaimEngineerEmail({ claimId: "claim", entryId: "visit", language: "en", contextHash: "saved-hash",
      selectedAttachmentIds: ["original-pdf", "original-photo"], note: "Inspect left door", technicalPdf: { sourceHash: "source", sha256: "pdf-hash", base64: "JVBERg==" } });
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("unified-message-send", { body: {
      action: "send_claim_engineer_email", claim_id: "claim", entry_id: "visit", language: "en", context_hash: "saved-hash",
      selected_attachment_ids: ["original-pdf", "original-photo"], note: "Inspect left door",
      technical_pdf: { sourceHash: "source", sha256: "pdf-hash", base64: "JVBERg==" },
    } });
  });
  it("preserves structured visit choices from a non-2xx function response", async () => {
    const failure = { ok: false, error: "claim_email_visit_required", entries: [{ id: "visit-2", entryNumber: "ENT-2", arrivalDate: "2026-11-24", status: "Issued" }] };
    api.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify(failure), { status: 409 }) } });
    expect(await prepareClaimEngineerEmail("claim", undefined, "ar")).toEqual(failure);
    expect(api.invoke.mock.calls[0][1].body).not.toHaveProperty("entry_id");
  });
  it("does not manufacture success from transport failures or a merely accepted response", async () => {
    api.invoke.mockResolvedValue({ data: null, error: new Error("offline") });
    await expect(prepareClaimEngineerEmail("claim", "visit", "en")).rejects.toThrow("claim_email_request_failed");
    expect(confirmedClaimEngineerEmailSent({ ok: true, status: "queued", logId: "log" })).toBe(false);
    expect(confirmedClaimEngineerEmailSent({ ok: true, status: "sent", logId: "log" })).toBe(false);
    expect(confirmedClaimEngineerEmailSent({ ok: true, status: "sent", logId: "log", providerMessageId: "gmail" })).toBe(true);
  });
  it("encodes exact PDF bytes with a real digest and rejects oversized PDFs before reading them", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nsynthetic");
    const payload = await encodeClaimEngineerTechnicalPdf(new Blob([bytes], { type: "application/pdf" }), "saved-source");
    expect(Buffer.from(payload.base64, "base64")).toEqual(Buffer.from(bytes));
    expect(payload.sha256).toBe(Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex"));
    expect(payload.sourceHash).toBe("saved-source");
    const oversized = { size: 3 * 1024 * 1024 + 1, arrayBuffer: vi.fn() };
    await expect(encodeClaimEngineerTechnicalPdf(oversized as unknown as Blob, "source")).rejects.toThrow("claim_email_technical_pdf_too_large");
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });
  it("requires one unambiguous persisted claim link on entry pages", () => {
    expect(persistedEntryClaimId({ insurance_claim_id: "claim" })).toBe("claim");
    expect(persistedEntryClaimId({ converted_claim_id: "claim" })).toBe("claim");
    expect(persistedEntryClaimId({ insurance_claim_id: "claim", converted_claim_id: "claim" })).toBe("claim");
    expect(persistedEntryClaimId({ insurance_claim_id: "one", converted_claim_id: "two" })).toBeNull();
    expect(persistedEntryClaimId({})).toBeNull();
  });
});
