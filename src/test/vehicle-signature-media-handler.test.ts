import { describe, it, expect, vi } from "vitest";
import { createSignatureMediaHandler, corsHeaders } from "../../supabase/functions/vehicle-entry-signature-media/handler";
const token = "a".repeat(64);
const env = (name: string) => ({ SUPABASE_URL: "https://rrhyglrnlveygyiandhs.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only" })[name];
function setup(revision: number | null = 2, rows: unknown[] = [], signError = false) {
  const signed = vi.fn().mockResolvedValue({ data: signError ? null : { signedUrl: "https://storage.test/signed" }, error: signError ? new Error("missing") : null });
  const from = vi.fn((table: string) => {
    const data = table === "vehicle_entry_signature_links" ? { tenant_id: "tenant", vehicle_entry_id: "entry", intake_revision: revision } : table === "vehicle_entries" ? { id: "entry", intake_revision: 2 } : rows;
    const chain: Record<string, unknown> = {}; for (const method of ["select", "eq", "is", "gt", "neq", "in", "order"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null }); chain.limit = vi.fn().mockResolvedValue({ data, error: null }); return chain;
  });
  return { handle: createSignatureMediaHandler(() => ({ from, storage: { from: () => ({ createSignedUrl: signed }) } }), env), signed, from };
}
function request(body: unknown = { token }, origin = "http://127.0.0.1:5194") { return new Request("http://local/media", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }); }
describe("signature media origin and revision security", () => {
  it("allows Development loopback preflight but not other-project loopback or lookalike hosts", () => {
    expect(corsHeaders(request(), env)["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5194");
    expect(corsHeaders(request(), () => "https://other-project.supabase.co")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(request({}, "http://127.0.0.1.evil.test:5194"), env)["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("rejects untrusted origins and malformed tokens before database access", async () => {
    const s = setup(); expect((await s.handle(request({ token }, "https://evil.test"))).status).toBe(403);
    expect((await s.handle(request({ token: "bad" }))).status).toBe(400); expect(s.from).not.toHaveBeenCalled();
  });
  it.each([1, null])("denies stale or unversioned links (%s) before signing any image", async revision => {
    const s = setup(revision); const response = await s.handle(request()); expect(response.status).toBe(404); expect(s.signed).not.toHaveBeenCalled();
  });
  it("signs only image paths belonging to the authorized tenant and visit", async () => {
    const valid = { id: "photo", storage_path: "tenant/vehicle-entry/entry/photo.png", mime_type: "image/png" };
    const s = setup(2, [valid, { ...valid, storage_path: "other/vehicle-entry/entry/photo.png" }, { ...valid, storage_path: "tenant/vehicle-entry/entry/../secret.png" }, { ...valid, mime_type: "application/pdf" }]);
    const body = await (await s.handle(request())).json(); expect(body.media).toHaveLength(1); expect(s.signed).toHaveBeenCalledExactlyOnceWith(valid.storage_path, 900);
  });
  it("distinguishes a missing stored object from a visit without photos", async () => {
    const s = setup(2, [{ storage_path: "tenant/vehicle-entry/entry/missing.png" }], true);
    expect(await (await s.handle(request())).json()).toMatchObject({ media: [], unavailable_count: 1 });
    expect(await (await setup().handle(request())).json()).toMatchObject({ media: [], unavailable_count: 0 });
  });
  it("enforces size limits even without Content-Length", async () => {
    const s = setup(); expect((await s.handle(request({ token, padding: "x".repeat(4200) }))).status).toBe(413); expect(s.from).not.toHaveBeenCalled();
  });
});
