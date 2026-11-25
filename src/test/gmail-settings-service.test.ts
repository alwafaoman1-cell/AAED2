import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
import { invokeGmailSettings } from "@/lib/gmailSettings";
beforeEach(() => vi.clearAllMocks());

describe("Gmail settings function response boundary", () => {
  it.each([[400, "gmail_credentials_incomplete"], [409, "gmail_settings_stale"], [409, "gmail_settings_tenant_changed"]])(
    "preserves a safe server code from HTTP %s", async (status, code) => {
      api.invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ ok: false, error: code }), { status: Number(status) }) } });
      await expect(invokeGmailSettings({ action: "status", tenant_id: "saved-tenant" })).rejects.toThrow(String(code));
    });
  it("returns only the status envelope and keeps the caller's tenant fence", async () => {
    const status = { enabled: false, configured: true, fromEmail: "workshop@example.test", clientId: "app.apps.googleusercontent.com",
      hasClientSecret: true, hasRefreshToken: true, updatedAt: "2026-11-24T10:00:00Z" };
    api.invoke.mockResolvedValue({ data: { ok: true, status }, error: null });
    expect(await invokeGmailSettings({ action: "status", tenant_id: "saved-tenant" })).toEqual(status);
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("gmail-settings", { body: { action: "status", tenant_id: "saved-tenant" } });
  });
  it("uses a safe code for non-JSON errors without exposing a provider response or credential", async () => {
    api.invoke.mockResolvedValue({ data: null, error: { context: new Response("provider details synthetic-secret", { status: 500 }) } });
    await expect(invokeGmailSettings({ action: "status", tenant_id: "tenant" })).rejects.toThrow("gmail_settings_unavailable");
  });
});
