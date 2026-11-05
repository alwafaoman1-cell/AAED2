import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const migration = readFileSync("supabase/migrations/20261104125745_isolate_auth_signup_profile_provisioning.sql", "utf8");
const edgeSource = readFileSync("supabase/functions/manage-users/index.ts", "utf8");
// Execute the actual Deno.serve callback with a fake SDK/environment. No HTTP,
// real Auth client, host environment, email, account or database is used.
const compiled = ts.transpileModule(edgeSource.replace(/^import .*from "https:.*;\r?\n/m, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});

type Profile = { tenant_id: string; role: string; account_status?: string; disabled_at?: string | null; is_platform_admin?: boolean; id?: string; user_id?: string };
type Options = {
  caller?: Profile | null;
  existing?: Profile;
  tenantMissing?: boolean;
  tenantError?: boolean;
  authError?: boolean;
  noAuthUser?: boolean;
  lookupError?: boolean;
  writeError?: boolean;
  noSavedRow?: boolean;
  savedOverride?: Record<string, unknown>;
  roleRows?: Array<{ tenant_id: string; role: string }> | null;
  roleError?: boolean;
  concurrentInsert?: boolean;
  acceptedUser?: Record<string, unknown> | null;
  legacyClient?: boolean;
  invalidCallerToken?: boolean;
};

function harness(options: Options = {}) {
  const caller = options.caller === undefined
    ? { tenant_id: "tenant-a", role: "admin", account_status: "active" }
    : options.caller;
  let handler: (request: Request) => Promise<Response>;
  let saved: Record<string, unknown> | undefined;
  const writes: Array<{ table: string; operation: string; fields: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const authResult = () => ({ data: { user: options.noAuthUser ? null : { id: "new-user" } }, error: options.authError ? new Error("Auth failed") : null });
  const authAdmin = {
    createUser: vi.fn(async () => authResult()),
    inviteUserByEmail: vi.fn(async () => authResult()),
    deleteUser: vi.fn(),
    generateLink: vi.fn(async () => ({ data: { properties: { action_link: "https://example.invalid/test-only" } }, error: null })),
    getUserById: vi.fn(async () => ({ data: { user: options.acceptedUser === undefined
      ? { id: "caller", email_confirmed_at: "2026-01-01", last_sign_in_at: "2026-01-02" }
      : options.acceptedUser }, error: null })),
  };
  const admin = {
    auth: { admin: authAdmin },
    from(table: string) {
      let operation = "select";
      let fields: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const execute = () => {
        if (operation !== "select") {
          writes.push({ table, operation, fields, filters: { ...filters } });
          if (table === "profiles") {
            if (options.writeError || (options.concurrentInsert && operation === "insert")) return { data: null, error: new Error("Write failed") };
            if (options.noSavedRow) return { data: null, error: null };
            saved = { ...(filters.user_id === "caller" ? { ...caller, user_id: "caller" } : {}), ...fields, ...options.savedOverride };
            return { data: saved, error: null };
          }
          return { data: null, error: null };
        }
        if (table === "tenants") return { data: options.tenantMissing ? null : { id: filters.id }, error: options.tenantError ? new Error("Tenant read failed") : null };
        if (table === "profiles") {
          if (filters.user_id === "caller") return { data: caller, error: null };
          return { data: options.existing ?? null, error: options.lookupError ? new Error("Profile read failed") : null };
        }
        if (table === "user_roles") return {
          data: options.roleRows === undefined ? [{ tenant_id: saved?.tenant_id ?? caller?.tenant_id, role: saved?.role ?? caller?.role }] : options.roleRows,
          error: options.roleError ? new Error("Role read failed") : null,
        };
        throw new Error(`Unexpected table: ${table}`);
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        is: (key: string, value: unknown) => { filters[key] = value; return query; },
        insert: (value: Record<string, unknown>) => { operation = "insert"; fields = value; return query; },
        update: (value: Record<string, unknown>) => { operation = "update"; fields = value; return query; },
        maybeSingle: async () => execute(),
        single: async () => execute(),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(execute).then(resolve, reject),
      };
      return query;
    },
  };
  const callerClient = { auth: {
    ...(options.legacyClient ? {} : { getClaims: async () => ({ data: { claims: { sub: options.invalidCallerToken ? null : "caller" } } }) }),
    getUser: async () => ({ data: { user: options.invalidCallerToken ? null : { id: "caller" } } }),
  } };
  runInNewContext(compiled.outputText, {
    createClient: (_url: string, key: string) => key === "fake-service" ? admin : callerClient,
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake-service", SUPABASE_ANON_KEY: "fake-public", SITE_URL: "https://workshop.invalid" })[key] },
      serve: (callback: typeof handler) => { handler = callback; },
    },
    Response,
    console: { error: vi.fn() },
  });
  const request = async (overrides: Record<string, unknown> = {}, authenticated = true) => {
    const response = await handler(new Request("https://example.invalid/manage-users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer fake-token" } : {}) },
      body: JSON.stringify({ action: "create", email: "synthetic@example.invalid", password: "synthetic-not-used", full_name: "Synthetic", role: "technician", ...overrides }),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { request, authAdmin, writes };
}

describe("signup trigger isolation contract (not a PostgreSQL execution)", () => {
  it("pins the inspected Development function/binding before replacement", () => {
    expect(migration).toContain("01fbc7293f1c21dc236c112ef10190c7");
    expect(migration).toContain("AUTH_SIGNUP_TRIGGER_SOURCE_DRIFT");
    expect(migration).toContain("AUTH_SIGNUP_TRIGGER_BINDING_DRIFT");
    expect(migration).toContain("and tgtype = 5");
  });
  it("never uses user-selected tenant/role or infers authority from the Auth actor", () => {
    const sql = migration.replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/raw_user_meta_data\s*->>\s*'(tenant_id|role|is_platform_admin)'/i);
    expect(sql).not.toMatch(/raw_app_meta_data|auth\.(uid|role|jwt)\s*\(|current_user|session_user/i);
    expect(sql).toContain("v_tenant_id := pg_catalog.gen_random_uuid()");
    expect(sql).toContain("'admin'::public.app_role,\n    false");
    expect(sql).not.toMatch(/on\s+conflict|create\s+policy|alter\s+policy|update\s+public|delete\s+from/i);
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.handle_new_user() from public, anon, authenticated");
  });
  it("permits only privilege-reducing deferral, before any tenant/profile creation", () => {
    const branch = migration.indexOf("if NEW.raw_user_meta_data->>'profile_provisioning' = 'manage-users' then");
    const firstInsert = migration.indexOf("insert into public.tenants");
    expect(branch).toBeGreaterThan(0);
    expect(migration.slice(branch, firstInsert)).toMatch(/return NEW;\s*end if;/);
    expect(firstInsert).toBeGreaterThan(branch);
  });
  it("includes a separate opt-in, rollback-only database proof for Main", () => {
    const sql = readFileSync("supabase/tests/auth_signup_provisioning_rollback.sql", "utf8");
    expect(sql).toContain("security_audit.signup_expected");
    expect(sql).toContain("SIGNUP_ISOLATION_FAILED");
    expect(sql).toContain("MANAGED_DEFERRAL_FAILED");
    expect(sql.trimEnd()).toMatch(/rollback;$/);
    expect(sql).not.toMatch(/nextval|setval|@example|email\s*,|encrypted_password/i);
  });
  it("keeps the rollback runner scoped to the existing private Development helper", () => {
    const runner = readFileSync("scripts/auth-signup-provisioning-rollback.py", "utf8");
    expect(runner).toContain('DEV_REF = "rrhyglrnlveygyiandhs"');
    expect(runner).toContain('getattr(helper, "REF", None) != DEV_REF');
    expect(runner).toContain("with helper.admin_connection() as connection:");
    expect(runner).toContain("finally:\n            connection.rollback()");
    expect(runner).toContain('raise RuntimeError("SIGNUP_PROOF_STATE_CHANGED")');
    expect(runner).not.toMatch(/apply_migration|db push|createClient|os\.environ|psycopg\.connect/);
  });
});

describe("manage-users actual callback with an offline SDK", () => {
  it("transpiles the actual Edge entrypoint without syntax errors", () => {
    expect(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(compiled.outputText).not.toContain("https://esm.sh");
  });
  it("requires authentication before using the administrative client", async () => {
    const h = harness();
    expect((await h.request({}, false)).status).toBe(401);
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it("verifies the caller through getUser when the pinned older SDK has no getClaims", async () => {
    const h = harness({ legacyClient: true });
    expect((await h.request()).status).toBe(200);
    const denied = harness({ legacyClient: true, invalidCallerToken: true });
    expect((await denied.request()).status).toBe(401);
    expect(denied.writes).toEqual([]);
    expect(denied.authAdmin.createUser).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { tenant_id: "tenant-a", role: "technician", account_status: "active" },
    { tenant_id: "tenant-a", role: "admin", account_status: "disabled" },
    { tenant_id: "tenant-a", role: "manager", account_status: "invited" },
    { tenant_id: "tenant-a", role: "admin" },
    { tenant_id: "tenant-a", role: "admin", account_status: "active", disabled_at: "2026-01-01T00:00:00Z" },
  ])("denies missing, low-role, unactivated or disabled caller profiles: %j", async (caller) => {
    const h = harness({ caller });
    expect((await h.request()).status).toBe(403);
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
  });
  it("creates in the caller tenant, with a deferral-only metadata marker", async () => {
    const h = harness();
    expect(await h.request({ tenant_id: "foreign-tenant" })).toEqual({ status: 200, body: { ok: true, user_id: "new-user" } });
    expect(h.authAdmin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      user_metadata: { full_name: "Synthetic", profile_provisioning: "manage-users" },
      email_confirm: true,
    }));
    expect(h.writes[0]).toMatchObject({ table: "profiles", operation: "insert", fields: { tenant_id: "tenant-a", role: "technician", account_status: "active" } });
    expect(h.writes[1]).toMatchObject({ table: "admin_user_events", fields: { action: "user_created" } });
  });
  it("activates only the caller's confirmed invitation without granting or moving roles", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "technician", account_status: "invited" } });
    expect(await h.request({ action: "accept_invite", id: "other-user", tenant_id: "other-tenant", role: "admin" })).toEqual({ status: 200, body: { ok: true } });
    expect(h.authAdmin.getUserById).toHaveBeenCalledWith("caller");
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
    expect(h.writes).toEqual([{
      table: "profiles", operation: "update", fields: { account_status: "active" },
      filters: { user_id: "caller", tenant_id: "tenant-a", role: "technician", account_status: "invited", disabled_at: null },
    }]);
  });
  it.each([
    { acceptedUser: null },
    { acceptedUser: { id: "other", email_confirmed_at: "yes", last_sign_in_at: "yes" } },
    { acceptedUser: { id: "caller", last_sign_in_at: "yes" } },
    { acceptedUser: { id: "caller", email_confirmed_at: "yes" } },
    { roleRows: [] },
    { roleRows: [{ tenant_id: "other", role: "technician" }] },
  ])("does not activate an unconfirmed invitation: %j", async (options) => {
    const h = harness({ ...options, caller: { tenant_id: "tenant-a", role: "technician", account_status: "invited" } });
    expect((await h.request({ action: "accept_invite" })).status).toBe(403);
    expect(h.writes).toEqual([]);
  });
  it("fails visibly if concurrent disable or tenant changes prevent invitation activation", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "technician", account_status: "invited" }, noSavedRow: true });
    expect(await h.request({ action: "accept_invite" })).toMatchObject({ status: 409, body: { error: "invitation_activation_unconfirmed" } });
  });
  it("keeps accepted active-account retries idempotent without writes", async () => {
    const h = harness();
    expect((await h.request({ action: "accept_invite" })).status).toBe(200);
    expect(h.writes).toEqual([]);
  });
  it("does not reactivate a disabled account via invitation acceptance", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "admin", account_status: "disabled" } });
    expect((await h.request({ action: "accept_invite" })).status).toBe(403);
    expect(h.writes).toEqual([]);
  });
  it("preserves authorized platform-admin tenant selection", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "admin", account_status: "active", is_platform_admin: true } });
    expect((await h.request({ tenant_id: "tenant-b", role: "admin" })).status).toBe(200);
    expect(h.writes[0].fields).toMatchObject({ tenant_id: "tenant-b", role: "admin" });
  });
  it("permits manager staff creation but not admin assignment", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "manager", account_status: "active" } });
    expect((await h.request({ role: "admin" })).status).toBe(403);
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
    expect((await h.request({ role: "accountant" })).status).toBe(200);
  });
  it.each(["owner", "customer", "", null])("rejects invalid new-user roles before Auth: %j", async (role) => {
    const h = harness();
    expect((await h.request({ role })).status).toBe(400);
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
  });
  it.each([{ tenantMissing: true }, { tenantError: true }])("checks the existing target tenant before Auth: %j", async (options) => {
    const h = harness(options);
    expect((await h.request()).status).toBe(500);
    expect(h.authAdmin.createUser).not.toHaveBeenCalled();
  });
  it("keeps invitations on the supported data-only API and reset-password path", async () => {
    const h = harness();
    expect((await h.request({ action: "invite", password: undefined })).status).toBe(200);
    expect(h.authAdmin.inviteUserByEmail).toHaveBeenCalledWith("synthetic@example.invalid", {
      redirectTo: "https://workshop.invalid/reset-password",
      data: { full_name: "Synthetic", profile_provisioning: "manage-users" },
    });
    expect(h.writes[0].fields).toMatchObject({ tenant_id: "tenant-a", role: "technician", account_status: "invited", invited_at: expect.any(String) });
    expect(h.writes[1].fields.action).toBe("user_invited");
  });
  it("sends an existing-account invitation to the same confirmed-activation page", async () => {
    const h = harness({ existing: { id: "existing-profile", user_id: "existing-user", tenant_id: "tenant-a", role: "technician" },
      acceptedUser: { id: "existing-user", email: "synthetic@example.invalid" } });
    expect((await h.request({ action: "invite", id: "existing-profile" })).status).toBe(200);
    expect(h.authAdmin.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "synthetic@example.invalid", options: { redirectTo: "https://workshop.invalid/reset-password" } });
    expect(h.writes[0].fields.account_status).toBe("invited");
  });
  it.each(["create", "invite"])("does not report %s success when Auth returns no user or an error", async (action) => {
    for (const options of [{ noAuthUser: true }, { authError: true }]) {
      const h = harness(options);
      const result = await h.request({ action });
      expect(result.status).toBe(500);
      expect(result.body.ok).toBeUndefined();
      expect(h.writes).toEqual([]);
    }
  });
  it.each(["create", "invite"])("surfaces a partial %s provisioning failure without a false audit or account deletion", async (action) => {
    const h = harness({ writeError: true });
    expect(await h.request({ action })).toMatchObject({ status: 500, body: { code: "profile_provisioning_incomplete", user_id: "new-user" } });
    expect(h.writes.filter((write) => write.table === "admin_user_events")).toEqual([]);
    expect(h.authAdmin.deleteUser).not.toHaveBeenCalled();
  });
  it.each([
    { noSavedRow: true },
    { savedOverride: { user_id: "wrong" } },
    { savedOverride: { tenant_id: "wrong" } },
    { savedOverride: { role: "admin" } },
    { savedOverride: { account_status: "disabled" } },
    { roleRows: [] },
    { roleRows: null },
    { roleRows: [{ tenant_id: "wrong", role: "technician" }] },
    { roleRows: [{ tenant_id: "tenant-a", role: "admin" }] },
    { roleRows: [{ tenant_id: "tenant-a", role: "technician" }, { tenant_id: "tenant-a", role: "admin" }] },
    { roleError: true },
  ])("requires the saved profile AND authoritative role binding to match: %j", async (options) => {
    const h = harness(options);
    expect((await h.request()).body.code).toBe("profile_provisioning_incomplete");
    expect(h.writes.some((write) => write.table === "admin_user_events")).toBe(false);
  });
  it.each([{ lookupError: true }, { existing: { tenant_id: "tenant-b", role: "technician" } }])("does not overwrite an unreadable or foreign existing invite profile: %j", async (options) => {
    const h = harness(options);
    expect((await h.request({ action: "invite" })).body.code).toBe("profile_provisioning_incomplete");
    expect(h.writes).toEqual([]);
  });
  it("does not let managers overwrite an existing admin through invite", async () => {
    const h = harness({ caller: { tenant_id: "tenant-a", role: "manager", account_status: "active" }, existing: { tenant_id: "tenant-a", role: "admin" } });
    expect((await h.request({ action: "invite" })).body.code).toBe("profile_provisioning_incomplete");
    expect(h.writes).toEqual([]);
  });
  it("confirms same-tenant re-invites using tenant/role-conditional updates", async () => {
    const h = harness({ existing: { tenant_id: "tenant-a", role: "technician" } });
    expect((await h.request({ action: "invite" })).status).toBe(200);
    expect(h.writes[0]).toMatchObject({ operation: "update", filters: { user_id: "new-user", tenant_id: "tenant-a", role: "technician" } });
  });
  it("fails closed when a concurrent tenant/role change makes an existing update affect no rows", async () => {
    const h = harness({ existing: { tenant_id: "tenant-a", role: "technician" }, noSavedRow: true });
    expect((await h.request({ action: "invite" })).body.code).toBe("profile_provisioning_incomplete");
    expect(h.writes[0]).toMatchObject({ operation: "update", filters: { tenant_id: "tenant-a", role: "technician" } });
    expect(h.writes.some((write) => write.table === "admin_user_events")).toBe(false);
  });
  it("fails closed when a concurrent profile insert wins instead of overwriting it", async () => {
    const h = harness({ concurrentInsert: true });
    expect((await h.request({ action: "invite" })).body.code).toBe("profile_provisioning_incomplete");
    expect(h.writes[0].operation).toBe("insert");
    expect(edgeSource).not.toContain('.upsert(');
  });
});

