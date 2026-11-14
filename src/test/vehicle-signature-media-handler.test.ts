import { describe, it, expect, vi } from "vitest";
import { createSignatureMediaHandler, corsHeaders } from "../../supabase/functions/vehicle-entry-signature-media/handler";

const token = "a".repeat(64), session = "b".repeat(64);
const entryId = "11111111-1111-4111-8111-111111111111";
const scope = { tenant_id: "tenant", entry_id: entryId, revision: 2, media_ids: null };
const access = { portal_token: token, portal_session: session, entry_id: entryId, revision: 2 };
const env = (name: string) => ({ SUPABASE_URL: "https://rrhyglrnlveygyiandhs.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only" })[name];
const photo = (id = "photo") => ({ id, storage_path: `tenant/vehicle-entry/${entryId}/${id}.png`, mime_type: "image/png" });

function setup(options: { rows?: any[]; scope?: any; nextScope?: any; scopeError?: boolean; signError?: boolean } = {}) {
  const signed = vi.fn().mockResolvedValue({ data: options.signError ? null : { signedUrl: "https://storage.test/signed" }, error: options.signError ? new Error("missing") : null });
  const rpc = vi.fn().mockResolvedValue({ data: options.scope === undefined ? scope : options.scope, error: options.scopeError ? new Error("session denied") : null });
  if ("nextScope" in options) rpc.mockResolvedValueOnce({ data: options.scope === undefined ? scope : options.scope, error: null }).mockResolvedValue({ data: options.nextScope, error: null });
  const query: Record<string, any> = {};
  let ids: unknown[] | null = null;
  for (const method of ["select", "eq", "is", "order"]) query[method] = vi.fn(() => query);
  query.in = vi.fn((_key: string, allowed: unknown[]) => { ids = allowed; return query; });
  query.limit = vi.fn(async (limit: number) => ({ data: (options.rows || []).filter(row => ids === null || ids.includes(row.id)).slice(0, limit), error: null }));
  const from = vi.fn(() => query);
  return { handle: createSignatureMediaHandler(() => ({ rpc, from, storage: { from: () => ({ createSignedUrl: signed }) } }), env), signed, from, rpc, query };
}
function request(body: unknown = access, origin = "http://127.0.0.1:5194") {
  return new Request("http://local/media", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
}

describe("signature media portal session and revision security", () => {
  it("allows Development loopback preflight but not other-project loopback or lookalike hosts", () => {
    expect(corsHeaders(request(), env)["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5194");
    expect(corsHeaders(request(), () => "https://other-project.supabase.co")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(request({}, "http://127.0.0.1.evil.test:5194"), env)["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("rejects untrusted origins and old bearer-only access before database access", async () => {
    const s = setup();
    expect((await s.handle(request(access, "https://evil.test"))).status).toBe(403);
    for (const body of [{ token }, { portal_token: token, entry_id: entryId }, { ...access, portal_session: "bad" }]) {
      expect((await s.handle(request(body))).status).toBe(401);
    }
    expect(s.rpc).not.toHaveBeenCalled(); expect(s.from).not.toHaveBeenCalled(); expect(s.signed).not.toHaveBeenCalled();
  });
  it.each([{ scope: null }, { scopeError: true }])("fails closed when the protected session scope is unavailable (%j)", async options => {
    const s = setup(options);
    expect((await s.handle(request())).status).toBe(403);
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith("customer_vehicle_portal_media_scope", { p_token: token, p_session: session, p_entry_id: entryId });
    expect(s.from).not.toHaveBeenCalled(); expect(s.signed).not.toHaveBeenCalled();
  });
  it("rejects a stale requested revision before querying or signing photos", async () => {
    const s = setup();
    expect((await s.handle(request({ ...access, revision: 1 }))).status).toBe(409);
    expect(s.from).not.toHaveBeenCalled(); expect(s.signed).not.toHaveBeenCalled();
  });
  it.each([null, { ...scope, revision: 3 }])("withholds all signed URLs when access is revoked or the revision changes during the read (%j)", async nextScope => {
    const s = setup({ rows: [photo()], nextScope });
    const response = await s.handle(request());
    expect(response.status).toBe(403);
    expect(s.rpc).toHaveBeenCalledTimes(2);
    expect(await response.json()).not.toHaveProperty("media");
  });
  it("confines photo queries and signed paths to the authorized tenant and visit", async () => {
    const valid = photo();
    const s = setup({ rows: [valid, { ...photo("other-tenant"), storage_path: `other/vehicle-entry/${entryId}/photo.png` }, { ...photo("other-entry"), storage_path: "tenant/vehicle-entry/other-entry/photo.png" }, { ...photo("traversal"), storage_path: `tenant/vehicle-entry/${entryId}/../secret.png` }, { ...photo("pdf"), mime_type: "application/pdf" }] });
    const body = await (await s.handle(request())).json();
    expect(body).toMatchObject({ revision: 2, expires_in: 60, unavailable_count: 4 });
    expect(body.media).toHaveLength(1);
    expect(s.query.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(s.query.eq).toHaveBeenCalledWith("vehicle_entry_id", entryId);
    expect(s.signed).toHaveBeenCalledExactlyOnceWith(valid.storage_path, 60);
  });
  it("limits a signed intake to frozen photo IDs and reports missing expected photos", async () => {
    const valid = photo("signed-photo");
    const s = setup({ scope: { ...scope, media_ids: ["signed-photo", "missing-photo"] }, rows: [valid, photo("later-photo")] });
    const body = await (await s.handle(request())).json();
    expect(s.query.in).toHaveBeenCalledExactlyOnceWith("id", ["signed-photo", "missing-photo"]);
    expect(body.media.map((item: any) => item.id)).toEqual(["signed-photo"]);
    expect(body.unavailable_count).toBe(1);
    expect(s.signed).toHaveBeenCalledExactlyOnceWith(valid.storage_path, 60);
  });
  it("keeps an empty signed snapshot empty even when newer photos exist", async () => {
    const s = setup({ scope: { ...scope, media_ids: [] }, rows: [photo("new-photo")] });
    const body = await (await s.handle(request())).json();
    expect(s.from).not.toHaveBeenCalled();
    expect(body).toMatchObject({ media: [], unavailable_count: 0 });
    expect(s.signed).not.toHaveBeenCalled();
  });
  it("returns every frozen image beyond the unsigned preview limit in bounded batches", async () => {
    const rows = Array.from({ length: 113 }, (_, index) => photo(`signed-${String(index).padStart(3, "0")}`));
    const s = setup({ scope: { ...scope, media_ids: rows.map(row => row.id) }, rows: [...rows, photo("not-in-signed-snapshot")] });
    const response = await s.handle(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.unavailable_count).toBe(0);
    expect(body.media.map((item: any) => item.id)).toEqual(rows.map(row => row.id));
    expect(s.query.in.mock.calls.map((call: any[]) => call[1].length)).toEqual([50, 50, 13]);
    expect(s.query.limit.mock.calls.map((call: any[]) => call[0])).toEqual([50, 50, 13]);
    expect(s.signed).toHaveBeenCalledTimes(113);
    expect(s.signed.mock.calls.map((call: any[]) => call[0])).not.toContain(photo("not-in-signed-snapshot").storage_path);
    expect(s.rpc).toHaveBeenCalledTimes(2);
  });
  it("still reports missing frozen evidence after a full batch rather than treating it as a preview omission", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => photo(`signed-${index}`));
    const s = setup({ scope: { ...scope, media_ids: [...rows.map(row => row.id), "missing-signed-photo"] }, rows });
    const body = await (await s.handle(request())).json();
    expect(body.media).toHaveLength(51);
    expect(body.unavailable_count).toBe(1);
    expect(s.query.in.mock.calls.map((call: any[]) => call[1].length)).toEqual([50, 2]);
  });
  it("retains the twelve-photo bound for an unsigned intake", async () => {
    const s = setup({ rows: Array.from({ length: 20 }, (_, index) => photo(`pending-${index}`)) });
    const body = await (await s.handle(request())).json();
    expect(body.media).toHaveLength(12);
    expect(body.unavailable_count).toBe(0);
    expect(s.query.in).not.toHaveBeenCalled();
    expect(s.query.limit).toHaveBeenCalledExactlyOnceWith(12);
  });
  it("distinguishes a missing stored object from a pending intake without photos", async () => {
    const s = setup({ rows: [photo("missing")], signError: true });
    expect(await (await s.handle(request())).json()).toMatchObject({ media: [], unavailable_count: 1 });
    const empty = setup();
    expect(await (await empty.handle(request())).json()).toMatchObject({ media: [], unavailable_count: 0 });
    expect(empty.query.in).not.toHaveBeenCalled();
  });
  it("enforces size limits even without Content-Length", async () => {
    const s = setup(); expect((await s.handle(request({ ...access, padding: "x".repeat(4200) }))).status).toBe(413);
    expect(s.rpc).not.toHaveBeenCalled(); expect(s.from).not.toHaveBeenCalled();
  });
});
