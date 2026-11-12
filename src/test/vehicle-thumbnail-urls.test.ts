import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;
const mocks = vi.hoisted(() => ({
  tenant: "tenant-a" as string | null,
  user: "user-a" as string | null,
  authCallback: null as AuthCallback | null,
  getSession: vi.fn(),
  getCurrentTenantId: vi.fn(),
  storageFrom: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (callback: AuthCallback) => { mocks.authCallback = callback; },
    },
    storage: { from: mocks.storageFrom },
  },
}));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/lib/refreshSignedUrls", () => ({ refreshSignedUrls: vi.fn(() => { throw new Error("Original signing must not be used for thumbnails"); }) }));

import { clearVehicleThumbnailCache, resolveVehicleThumbnailUrls } from "@/lib/vehicleThumbnailUrls";

const source = (name = "rear", tenant = "tenant-a", bucket = "insurance-docs") => ({
  id: name, storage_bucket: bucket, storage_path: `${tenant}/vehicle-entry/entry/${name}.png`, public_url: null,
});
function signed(bucket: string, path: string, token = "thumbnail") {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return { data: { signedUrl: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/render/image/sign/${bucket}/${encoded}?token=${token}` }, error: null };
}
type SignedResult = ReturnType<typeof signed>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function auth(event: string, user: string | null = "user-a") {
  mocks.user = user;
  mocks.authCallback!(event, user ? { user: { id: user } } : null);
}
let now = 1_800_000_000_000;

beforeEach(() => {
  clearVehicleThumbnailCache();
  vi.clearAllMocks();
  mocks.sign.mockReset();
  mocks.getCurrentTenantId.mockReset();
  mocks.getSession.mockReset();
  mocks.tenant = "tenant-a";
  mocks.user = "user-a";
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.getCurrentTenantId.mockImplementation(async () => mocks.tenant);
  mocks.getSession.mockImplementation(async () => ({ data: { session: mocks.user ? { user: { id: mocks.user } } : null }, error: null }));
  mocks.storageFrom.mockImplementation((bucket: string) => ({
    createSignedUrl: (path: string, ttl: number, options: unknown) => mocks.sign(bucket, path, ttl, options),
  }));
  mocks.sign.mockImplementation(async (bucket: string, path: string) => signed(bucket, path));
});

afterEach(() => {
  clearVehicleThumbnailCache();
  vi.restoreAllMocks();
});

describe("private rear image transformations", () => {
  it("signs the same canonical source as a true 144x144 cover thumbnail at quality 65", async () => {
    const row = source();
    const original = { ...row };
    const [result] = await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith("insurance-docs", row.storage_path, 3_600, {
      transform: { width: 144, height: 144, resize: "cover", quality: 65 },
    });
    expect(result.url).toBe(signed("insurance-docs", row.storage_path).data.signedUrl);
    expect(result.storage_path).toBe(row.storage_path);
    expect(result.public_url).toBeNull();
    expect(row).toEqual(original);
  });

  it("re-signs a legacy expired original URL using its durable bucket/path, not its token", async () => {
    const path = "tenant-a/vehicle-entry/entry/rear image.png";
    const row = { storage_bucket: null, storage_path: null,
      public_url: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/sign/work-order-photos/${encodeURI(path)}?token=expired` };
    const [result] = await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign.mock.calls[0].slice(0, 2)).toEqual(["work-order-photos", path]);
    expect(result.url).toContain("/render/image/sign/work-order-photos/");
    expect(result.public_url).toBe(row.public_url);
  });

  it("shares cache and in-flight work between duplicate files and overlapping calls", async () => {
    const gate = deferred<SignedResult>();
    const row = source();
    mocks.sign.mockReturnValue(gate.promise);
    const a = resolveVehicleThumbnailUrls("tenant-a", [row, { ...row, id: "duplicate" }]);
    const b = resolveVehicleThumbnailUrls("tenant-a", [row]);
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    gate.resolve(signed(row.storage_bucket, row.storage_path));
    const [first, second] = await Promise.all([a, b]);
    expect(first.map((item) => item.url)).toEqual([second[0].url, second[0].url]);
    expect((await resolveVehicleThumbnailUrls("tenant-a", [row]))[0].url).toBe(second[0].url);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });

  it("separates bucket and requested size in the cache key", async () => {
    const row = source();
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    await resolveVehicleThumbnailUrls("tenant-a", [row], { width: 72, height: 72 });
    await resolveVehicleThumbnailUrls("tenant-a", [{ ...row, storage_bucket: "work-order-photos" }]);
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(3);
    expect(mocks.sign.mock.calls[1][3]).toEqual({ transform: { width: 72, height: 72, resize: "cover", quality: 65 } });
  });

  it("expires signed thumbnails before token expiry and measures validity from request start", async () => {
    const gate = deferred<SignedResult>();
    const row = source();
    mocks.sign.mockReturnValueOnce(gate.promise);
    const read = resolveVehicleThumbnailUrls("tenant-a", [row]);
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    now += 10_000;
    gate.resolve(signed(row.storage_bucket, row.storage_path));
    await read;
    now += 3_529_999;
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    now += 1;
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("limits concurrent signing to four across separate batches, preserving result order", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<SignedResult>());
    const rows = Array.from({ length: 6 }, (_, i) => source(`rear-${i}`));
    let active = 0;
    let maximum = 0;
    mocks.sign.mockImplementation((bucket: string, path: string) => {
      const index = rows.findIndex((row) => row.storage_path === path);
      active += 1;
      maximum = Math.max(maximum, active);
      return gates[index].promise.then((value) => { active -= 1; return value; });
    });
    const a = resolveVehicleThumbnailUrls("tenant-a", rows.slice(0, 3));
    const b = resolveVehicleThumbnailUrls("tenant-a", rows.slice(3));
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(4));
    gates[1].resolve(signed(rows[1].storage_bucket, rows[1].storage_path));
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(5));
    gates.forEach((gate, index) => gate.resolve(signed(rows[index].storage_bucket, rows[index].storage_path)));
    const [first, second] = await Promise.all([a, b]);
    expect(maximum).toBe(4);
    expect([...first, ...second].map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(mocks.sign).toHaveBeenCalledTimes(6);
  });

  it.each(["sign error", "rejection", "original URL", "foreign URL"])("never substitutes an original or caches failure after %s", async (failure) => {
    const row = source();
    const original = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/sign/insurance-docs/${row.storage_path}?token=original`;
    if (failure === "sign error") mocks.sign.mockResolvedValueOnce({ data: null, error: new Error("Transform unavailable") });
    else if (failure === "rejection") mocks.sign.mockRejectedValueOnce(new Error("offline"));
    else mocks.sign.mockResolvedValueOnce({ data: { signedUrl: failure === "original URL" ? original : "https://foreign.example/storage/v1/render/image/sign/insurance-docs/rear.png?token=x" }, error: null });
    expect((await resolveVehicleThumbnailUrls("tenant-a", [{ ...row, public_url: original }]))[0].url).toBe("");
    expect((await resolveVehicleThumbnailUrls("tenant-a", [row]))[0].url).toContain("/render/image/sign/");
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate or sign inline/external/cross-tenant/traversal references", async () => {
    const rows = ["data:image/png;base64,abc", "blob:local", "https://external.example/photo.png", "tenant-b/rear.png", "tenant-a/../tenant-b/rear.png"]
      .map((storage_path) => ({ storage_bucket: "insurance-docs", storage_path }));
    expect((await resolveVehicleThumbnailUrls("tenant-a", rows)).map((row) => row.url)).toEqual(rows.map(() => ""));
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});

describe("thumbnail tenant and auth boundaries", () => {
  it("clears cache across tenant changes and never returns a cached URL to a mismatched tenant", async () => {
    const row = source();
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    mocks.tenant = "tenant-b";
    expect((await resolveVehicleThumbnailUrls("tenant-a", [row]))[0].url).toBe("");
    const b = source("rear", "tenant-b");
    expect((await resolveVehicleThumbnailUrls("tenant-b", [b]))[0].url).toContain("tenant-b/");
    mocks.tenant = "tenant-a";
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(3);
  });

  it.each(["SIGNED_OUT", "USER_UPDATED", "SIGNED_IN as another user"])("clears private URLs on %s", async (event) => {
    const row = source();
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    if (event === "SIGNED_OUT") { auth("SIGNED_OUT", null); auth("SIGNED_IN"); }
    else if (event === "USER_UPDATED") auth(event);
    else auth("SIGNED_IN", "user-b");
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("keeps cache on same-user token refresh and ordinary SIGNED_IN notifications", async () => {
    const row = source();
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    auth("TOKEN_REFRESHED");
    auth("SIGNED_IN");
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });

  it("drops old running/queued URLs on logout and retains the global concurrency limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => source(`old-${i}`));
    const gates = Array.from({ length: 4 }, () => deferred<SignedResult>());
    let calls = 0;
    mocks.sign.mockImplementation((bucket: string, path: string) => calls < 4 ? gates[calls++].promise : Promise.resolve(signed(bucket, path)));
    const old = resolveVehicleThumbnailUrls("tenant-a", rows);
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(4));
    auth("SIGNED_OUT", null);
    auth("SIGNED_IN");
    const current = resolveVehicleThumbnailUrls("tenant-a", [source("current")]);
    // No new signing slot is available until the pre-logout requests finish.
    expect(mocks.sign).toHaveBeenCalledTimes(4);
    gates.forEach((gate, index) => gate.resolve(signed(rows[index].storage_bucket, rows[index].storage_path)));
    expect((await old).every((row) => row.url === "")).toBe(true);
    expect((await current)[0].url).toContain("/current.png?");
    expect(mocks.sign).toHaveBeenCalledTimes(5); // queued old-4 was cancelled
  });

  it("does not let an old completion erase the new login's same-key in-flight request", async () => {
    const row = source();
    const old = deferred<SignedResult>();
    const current = deferred<SignedResult>();
    mocks.sign.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldRead = resolveVehicleThumbnailUrls("tenant-a", [row]);
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    auth("SIGNED_OUT", null);
    auth("SIGNED_IN");
    const currentRead = resolveVehicleThumbnailUrls("tenant-a", [row]);
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(2));
    old.resolve(signed(row.storage_bucket, row.storage_path, "old-session"));
    expect((await oldRead)[0].url).toBe("");
    const joined = resolveVehicleThumbnailUrls("tenant-a", [row]);
    current.resolve(signed(row.storage_bucket, row.storage_path, "new-session"));
    const [a, b] = await Promise.all([currentRead, joined]);
    expect(a[0].url).toBe(b[0].url);
    expect(a[0].url).toContain("new-session");
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("does not revive a tenant lookup that crosses logout", async () => {
    const gate = deferred<string | null>();
    mocks.getCurrentTenantId.mockReturnValueOnce(gate.promise);
    const read = resolveVehicleThumbnailUrls("tenant-a", [source()]);
    await vi.waitFor(() => expect(mocks.getCurrentTenantId).toHaveBeenCalledTimes(1));
    auth("SIGNED_OUT", null);
    gate.resolve("tenant-a");
    expect((await read)[0].url).toBe("");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("requires a live session even for an already cached path", async () => {
    const row = source();
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    mocks.user = null;
    expect((await resolveVehicleThumbnailUrls("tenant-a", [row]))[0].url).toBe("");
    mocks.user = "user-a";
    await resolveVehicleThumbnailUrls("tenant-a", [row]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("does not sign without a tenant, for empty inputs, or for invalid sizes", async () => {
    await resolveVehicleThumbnailUrls("", [source()]);
    await resolveVehicleThumbnailUrls("tenant-a", []);
    await resolveVehicleThumbnailUrls("tenant-a", [source()], { width: 0, height: 144 });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
