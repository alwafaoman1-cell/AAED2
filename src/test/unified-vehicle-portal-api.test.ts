import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), media: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc } }));
vi.mock("@/lib/vehicleSignatureMedia", () => ({ loadUnifiedVehiclePortalMedia: api.media }));
import { buildUnifiedVehiclePortalUrl, buildVehiclePortalWhatsAppMessage, readVehiclePortalDocument, signVehiclePortalEntry, signVehiclePortalOrder, signVehiclePortalRelease, submitVehiclePortalFeedback, submitVehiclePortalNote, unlockVehiclePortal } from "@/lib/unifiedVehiclePortal";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } })));
});
afterEach(() => { vi.unstubAllGlobals(); });
describe("unified vehicle portal API boundaries", () => {
  it("normalizes Arabic plate digits and letters before server verification", async () => {
    api.rpc.mockResolvedValue({ data: { session: "opaque-session", expires_at: null }, error: null });
    expect(await unlockVehiclePortal("token", "١٢٣٤", "ب ا")).toEqual({ session: "opaque-session", expires_at: null });
    expect(api.rpc).toHaveBeenCalledWith("customer_vehicle_portal_unlock", { p_token: "token", p_plate_digits: "1234", p_plate_letters: "BA" });
    await unlockVehiclePortal("token", "1234", "b a");
    expect(api.rpc).toHaveBeenLastCalledWith("customer_vehicle_portal_unlock", { p_token: "token", p_plate_digits: "1234", p_plate_letters: "BA" });
  });
  it("never copies vehicle credentials or internal data into customer invitations", () => {
    const context = { customer_name: "Customer", vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_year: 2020, plate_number: "SECRET-123", plate_letters: "ZX", vin: "SECRET-VIN", claim_number: "SECRET-CLAIM", order_number: "SECRET-ORDER", work_summary: "SECRET-WORK", invoice: "SECRET-INVOICE" };
    const url = buildUnifiedVehiclePortalUrl("opaque-token", "https://workshop.example");
    for (const language of ["ar", "en"] as const) {
      const message = buildVehiclePortalWhatsAppMessage(context, url, language);
      expect(message).toContain(url); expect(message).toContain("Customer"); expect(message).toContain("Toyota"); expect(message).toContain("2020");
      expect(message).not.toMatch(/SECRET-|ZX/);
    }
    expect(buildVehiclePortalWhatsAppMessage(context, url, "en")).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("binds each new intake signature to the unlocked session and exact revision", async () => {
    api.rpc.mockResolvedValue({ data: { signed: true }, error: null });
    await signVehiclePortalEntry("token", "session", { id: "entry", revision: 4 } as never, " Customer ", "data:image/png;base64,AA==", true);
    expect(api.rpc).toHaveBeenCalledWith("customer_vehicle_portal_sign", { p_token: "token", p_session: "session", p_entry_id: "entry", p_revision: 4, p_name: "Customer", p_signature: "data:image/png;base64,AA==", p_consent: true });
    api.rpc.mockResolvedValueOnce({ data: { signed: false }, error: null });
    await expect(signVehiclePortalEntry("token", "session", { id: "entry", revision: 4 } as never, "Customer", "signature", true)).rejects.toMatchObject({ code: "failed" });
  });
  it("never submits retained legacy ink as a new intake signature", async () => {
    await expect(signVehiclePortalEntry("token", "session", { id: "entry", revision: 1, legacy_signature: true } as never, "Customer", "old-signature", true)).rejects.toMatchObject({ code: "failed" });
    expect(api.rpc).not.toHaveBeenCalled();
    api.rpc.mockResolvedValue({ data: { signed: true }, error: null });
    await signVehiclePortalEntry("token", "session", { id: "entry", revision: 2, legacy_signature: false } as never, "Customer", "new-signature", true);
    expect(api.rpc).toHaveBeenCalledExactlyOnceWith("customer_vehicle_portal_sign", expect.objectContaining({ p_entry_id: "entry", p_revision: 2, p_signature: "new-signature" }));
  });
  it("replaces raw snapshot URLs with session-authorized frozen media", async () => {
    api.rpc.mockResolvedValue({ data: { entry: { id: "entry", vehicle_media: [{ url: "https://raw-private-object" }] }, receipt: { receipt_number: "R1" }, revision: 2 }, error: null });
    api.media.mockResolvedValue({ data: { media: [{ id: "photo", url: "https://storage.example/signed-photo", caption: "Damage" }], revision: 2, unavailable_count: 0 }, error: null });
    const document = await readVehiclePortalDocument("token", "session", "entry");
    expect(api.rpc).toHaveBeenCalledWith("customer_vehicle_portal_document", { p_token: "token", p_session: "session", p_entry_id: "entry" });
    expect(api.media).toHaveBeenCalledWith("token", "session", "entry", 2);
    expect(document.entry.vehicle_media).toEqual([{ id: "photo", url: "data:image/png;base64,iVBORw==", caption: "Damage", media_type: "image" }]);
    expect(fetch).toHaveBeenCalledWith("https://storage.example/signed-photo", { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.stringify(document)).not.toContain("raw-private-object");
  });
  it("blocks incomplete PDFs when media fails, but permits a verified empty media list", async () => {
    api.rpc.mockResolvedValue({ data: { entry: { id: "entry" }, receipt: { receipt_number: "R1" }, revision: 2 }, error: null });
    api.media.mockResolvedValueOnce({ data: null, error: new Error("storage failed") });
    await expect(readVehiclePortalDocument("token", "session", "entry")).rejects.toMatchObject({ code: "failed" });
    api.media.mockResolvedValueOnce({ data: { media: [], revision: 2, unavailable_count: 0 }, error: null });
    expect((await readVehiclePortalDocument("token", "session", "entry")).entry.vehicle_media).toEqual([]);
    api.media.mockResolvedValueOnce({ data: { media: [{ id: "bad", url: "javascript:alert(1)" }], revision: 2, unavailable_count: 0 }, error: null });
    await expect(readVehiclePortalDocument("token", "session", "entry")).rejects.toMatchObject({ code: "failed" });
    api.media.mockResolvedValueOnce({ data: { media: [], revision: 3, unavailable_count: 0 }, error: null });
    await expect(readVehiclePortalDocument("token", "session", "entry")).rejects.toMatchObject({ code: "failed" });
    api.media.mockResolvedValueOnce({ data: { media: [], revision: 2, unavailable_count: 1 }, error: null });
    await expect(readVehiclePortalDocument("token", "session", "entry")).rejects.toMatchObject({ code: "failed" });
    api.media.mockResolvedValueOnce({ data: { error: "PORTAL_ACCESS_REQUIRED" }, error: null });
    await expect(readVehiclePortalDocument("token", "session", "entry")).rejects.toMatchObject({ code: "session" });
  });
  it("returns safe errors without exposing database messages", async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: "invalid plate SECRET_DATABASE_ROW" } });
    await expect(unlockVehiclePortal("token", "123", "AA")).rejects.toMatchObject({ code: "credentials", message: "credentials" });
  });
  it("binds work-order consent to the displayed ID and content digest and rejects stale terms", async () => {
    const order = { enabled: true, id: "displayed-order", digest: "displayed-digest" };
    api.rpc.mockResolvedValue({ data: { signed: true }, error: null });
    await signVehiclePortalOrder("token", "session", order, "Customer", "signature", true);
    expect(api.rpc).toHaveBeenCalledWith("customer_vehicle_portal_sign_order", { p_token: "token", p_session: "session", p_order_id: "displayed-order", p_order_digest: "displayed-digest", p_name: "Customer", p_signature: "signature", p_consent: true });
    api.rpc.mockResolvedValueOnce({ data: null, error: { message: "PORTAL_ORDER_CHANGED" } });
    await expect(signVehiclePortalOrder("token", "session", order, "Customer", "signature", true)).rejects.toMatchObject({ code: "changed" });
  });
  it("binds temporary-release consent to the exact displayed report digest", async () => {
    const release = { id: "release", digest: "displayed-release-digest", status: "awaiting_signature", release_number: "REL-1" };
    api.rpc.mockResolvedValue({ data: { signed: true }, error: null });
    await signVehiclePortalRelease("token", "session", release, "Actual recipient", "signature", true);
    expect(api.rpc).toHaveBeenCalledWith("customer_vehicle_portal_sign_release", { p_token: "token", p_session: "session", p_release_id: "release", p_release_digest: "displayed-release-digest", p_name: "Actual recipient", p_signature: "signature", p_consent: true });
    api.rpc.mockResolvedValueOnce({ data: null, error: { message: "PORTAL_RELEASE_CHANGED" } });
    await expect(signVehiclePortalRelease("token", "session", release, "Actual recipient", "signature", true)).rejects.toMatchObject({ code: "changed" });
  });
  it("binds notes and feedback to the session and displayed order, never a bearer-only endpoint", async () => {
    api.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await submitVehiclePortalNote("token", "session", "displayed-order", " Please call ");
    expect(api.rpc).toHaveBeenLastCalledWith("customer_vehicle_portal_note", { p_token: "token", p_session: "session", p_order_id: "displayed-order", p_note: "Please call" });
    await submitVehiclePortalFeedback("token", "session", "displayed-order", 5, " Good service ");
    expect(api.rpc).toHaveBeenLastCalledWith("customer_vehicle_portal_feedback", { p_token: "token", p_session: "session", p_order_id: "displayed-order", p_rating: 5, p_comment: "Good service" });
    api.rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    await expect(submitVehiclePortalNote("token", "session", "displayed-order", "Note")).rejects.toMatchObject({ code: "failed" });
    api.rpc.mockResolvedValueOnce({ data: null, error: { message: "PORTAL_ORDER_CHANGED" } });
    await expect(submitVehiclePortalFeedback("token", "session", "displayed-order", 5, "Comment")).rejects.toMatchObject({ code: "changed" });
  });
});
