import { describe, expect, it } from "vitest";
import { createGmailSettingsHandler } from "../../supabase/functions/gmail-settings/handler";

const tenant = "00000000-0000-4000-8000-000000000101";
const initial = () => ({ id: "integration-1", tenant_id: tenant, provider: "gmail", enabled: false,
  config: { from_email: "workshop@example.com", client_id: "123.apps.googleusercontent.com", retained: "configuration" },
  secrets: { client_secret: "synthetic-old-secret", refresh_token: "synthetic-old-refresh", retained: "private-setting" },
  updated_at: "2026-11-24T10:00:00Z" });

function fixture(options: { role?: string; active?: boolean; concurrent?: boolean; writeError?: boolean; existing?: boolean; clientId?: string } = {}) {
  let saved: any = options.existing === false ? null : initial();
  if (saved && "clientId" in options) saved.config.client_id = options.clientId;
  let writes = 0, reads = 0;
  const profile = { user_id: "actor", tenant_id: tenant, role: options.role || "admin",
    account_status: options.active === false ? "disabled" : "active", disabled_at: null };
  const admin = { from(table: string) {
    let op = "select", patch: any;
    const filters: Array<[string, unknown]> = [];
    const execute = async () => {
      if (table === "profiles") return { data: profile };
      reads++;
      if (op === "select") return { data: saved ? structuredClone(saved) : null };
      if (options.concurrent) return { data: null };
      if (options.writeError) return { error: { message: "synthetic database failure" } };
      if (filters.some(([key, value]) => saved?.[key] !== value)) return { data: null };
      writes++;
      saved = { ...saved, ...patch, updated_at: "2026-11-24T10:01:00Z" };
      return { data: structuredClone(saved) };
    };
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (value: unknown) => { op = "update"; patch = value; return query; },
      insert: (value: unknown) => { op = "insert"; patch = value; return query; },
      maybeSingle: execute, single: execute,
    };
    return query;
  } };
  const handler = createGmailSettingsHandler({
    env: key => ({ SUPABASE_URL: "https://development.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-service", SUPABASE_ANON_KEY: "test-anon" })[key],
    createClient: (_url, key) => key === "test-service" ? admin : { auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) } },
  });
  const send = async (body: unknown, authorization = "Bearer synthetic-user") => {
    const response = await handler(new Request("https://development.invalid/gmail-settings", {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { send, state: () => ({ saved, writes, reads }) };
}
const saveBody = (extra = {}) => ({ action: "save", tenant_id: tenant, expected_updated_at: initial().updated_at,
  enabled: true, from_email: "workshop@example.com", client_id: "123.apps.googleusercontent.com", ...extra });

describe("Gmail settings: server merge and identity fencing", () => {
  it("returns credential presence without returning stored secret values", async () => {
    const f = fixture(); const result = await f.send({ action: "status", tenant_id: tenant });
    expect(result.status).toBe(200);
    expect(result.body.status).toMatchObject({ hasClientSecret: true, hasRefreshToken: true, configured: true });
    expect(JSON.stringify(result)).not.toContain("synthetic-old-secret");
    expect(JSON.stringify(result)).not.toContain("synthetic-old-refresh");
    expect(f.state().writes).toBe(0);
  });
  it("preserves the refresh token and other credentials when only the client secret changes", async () => {
    const f = fixture(); const result = await f.send(saveBody({ client_secret: "synthetic-replacement-secret", refresh_token: "" }));
    expect(result.body.ok).toBe(true);
    expect(f.state().saved.secrets).toEqual({ ...initial().secrets, client_secret: "synthetic-replacement-secret" });
    expect(f.state().saved.config.retained).toBe("configuration");
    expect(JSON.stringify(result)).not.toContain("synthetic-replacement-secret");
  });
  it("keeps both saved secrets when the operator changes only the enabled flag", async () => {
    const f = fixture(); expect((await f.send(saveBody({ enabled: false, client_secret: "", refresh_token: "" }))).body.ok).toBe(true);
    expect(f.state().saved.secrets).toEqual(initial().secrets);
  });
  it.each(["manager", "technician", "insurance"])("denies %s before loading private settings", async role => {
    const f = fixture({ role }); const result = await f.send(saveBody());
    expect(result.status).toBe(403); expect(f.state().reads).toBe(0); expect(f.state().writes).toBe(0);
  });
  it("denies a disabled administrator and a stale tenant context", async () => {
    const inactive = fixture({ active: false }); expect((await inactive.send(saveBody())).status).toBe(403);
    const changed = fixture(); expect((await changed.send(saveBody({ tenant_id: "another-tenant" }))).status).toBe(409);
    expect(changed.state().writes).toBe(0);
  });
  it("requires a matching saved version and rejects a concurrent write atomically", async () => {
    const stale = fixture(); expect((await stale.send(saveBody({ expected_updated_at: null }))).status).toBe(409);
    const concurrent = fixture({ concurrent: true }); expect((await concurrent.send(saveBody())).status).toBe(409);
    expect(concurrent.state().saved.secrets).toEqual(initial().secrets); expect(concurrent.state().writes).toBe(0);
  });
  it("does not transfer existing credentials to a changed OAuth application", async () => {
    const f = fixture(); const result = await f.send(saveBody({ client_id: "456.apps.googleusercontent.com" }));
    expect(result.body.error).toBe("gmail_oauth_client_changed_requires_credentials"); expect(f.state().writes).toBe(0);
  });
  it.each(["", undefined])("does not assign orphaned saved credentials to a new client when the old ID is %s", async clientId => {
    const f = fixture({ clientId });
    const result = await f.send(saveBody({ client_id: "456.apps.googleusercontent.com", client_secret: "", refresh_token: "" }));
    expect(result.status).toBe(400); expect(result.body.error).toBe("gmail_oauth_client_changed_requires_credentials");
    expect(f.state().writes).toBe(0); expect(f.state().saved.secrets).toEqual(initial().secrets);
  });
  it("allows repairing an orphaned client only with both replacement credentials", async () => {
    const f = fixture({ clientId: "" });
    const result = await f.send(saveBody({ client_id: "456.apps.googleusercontent.com", client_secret: "new-client-secret", refresh_token: "new-client-refresh" }));
    expect(result.body.ok).toBe(true); expect(f.state().writes).toBe(1);
    expect(f.state().saved.secrets).toEqual({ ...initial().secrets, client_secret: "new-client-secret", refresh_token: "new-client-refresh" });
  });
  it("rejects header injection and an oversized body without saving", async () => {
    const f = fixture(); expect((await f.send(saveBody({ from_email: "workshop@example.com\r\nBcc: other@example.com" }))).status).toBe(400);
    expect((await f.send(saveBody({ client_secret: "x".repeat(17000) }))).status).toBe(413);
    expect(f.state().writes).toBe(0);
  });
  it("does not claim success on a database failure", async () => {
    const f = fixture({ writeError: true }); const result = await f.send(saveBody());
    expect(result.status).toBe(500); expect(result.body.error).toBe("gmail_settings_save_failed");
    expect(f.state().writes).toBe(0);
  });
});
