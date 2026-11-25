// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { SavedGmailSettingsStatus } from "@/lib/gmailSettings";
const api = vi.hoisted(() => ({
  profile: { user_id: "actor-a", tenant_id: "tenant-a", role: "admin" },
  gmail: vi.fn(), save: vi.fn(), invoke: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: api.profile }) }));
vi.mock("@/lib/gmailSettings", () => ({ invokeGmailSettings: api.gmail }));
vi.mock("sonner", () => ({ toast: { success: api.success, error: api.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => { const query = { select: () => query, eq: () => query, in: async () => ({ data: [], error: null }) }; return query; },
  functions: { invoke: api.invoke },
} }));
import IntegrationsSettingsPage from "@/pages/settings/IntegrationsSettingsPage";

function status(tenant: string): SavedGmailSettingsStatus {
  return { enabled: false, configured: true, fromEmail: `${tenant}@example.test`, clientId: "123.apps.googleusercontent.com",
    hasClientSecret: true, hasRefreshToken: true, updatedAt: "2026-11-24T10:00:00Z" };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((done, failed) => { resolve = done; reject = failed; }), resolve, reject }; }
function gmailCard() { return screen.getByText("Gmail (Google)").closest(".p-4") as HTMLElement; }
function show() { return render(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>); }
async function ready(tenant: string) { await screen.findByDisplayValue(`${tenant}@example.test`); }

beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en");
  api.profile = { user_id: "actor-a", tenant_id: "tenant-a", role: "admin" };
  api.save.mockReset().mockResolvedValue(status("tenant-a"));
  api.gmail.mockReset().mockImplementation(body => body.action === "status" ? Promise.resolve(status(body.tenant_id)) : api.save(body));
  api.invoke.mockReset().mockResolvedValue({ data: { ok: true, status: { configured: false, enabled: false } }, error: null });
});

describe("Gmail settings UI request ownership", () => {
  it("shows the specific English stale-version error and offers a fresh read", async () => {
    api.save.mockRejectedValue(new Error("gmail_settings_stale")); show(); await ready("tenant-a");
    fireEvent.click(within(gmailCard()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.error).toHaveBeenCalledExactlyOnceWith("Gmail settings changed in another session. Reload before saving."));
    expect(api.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
    await ready("tenant-a");
    expect(api.gmail.mock.calls.filter(([body]) => body.action === "status")).toHaveLength(2);
  });
  it.each(["success", "failure"])("discards an old workshop's %s without clearing a new pending save", async outcome => {
    const oldSave = deferred<SavedGmailSettingsStatus>(), newSave = deferred<SavedGmailSettingsStatus>();
    api.save.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise);
    const view = show(); await ready("tenant-a");
    fireEvent.click(within(gmailCard()).getByRole("button", { name: "Save" }));
    expect(api.save).toHaveBeenCalledTimes(1);
    api.profile = { user_id: "actor-b", tenant_id: "tenant-b", role: "admin" };
    view.rerender(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>);
    await ready("tenant-b");
    fireEvent.click(within(gmailCard()).getByRole("button", { name: "Save" }));
    expect(api.save).toHaveBeenCalledTimes(2);
    await act(async () => { if (outcome === "success") oldSave.resolve(status("tenant-a")); else oldSave.reject(new Error("gmail_settings_stale")); });
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled();
    expect(within(gmailCard()).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(api.gmail.mock.calls.filter(([body]) => body.action === "status").map(([body]) => body.tenant_id)).toEqual(["tenant-a", "tenant-b"]);
    await act(async () => newSave.resolve(status("tenant-b")));
    await ready("tenant-b");
    expect(api.success).toHaveBeenCalledExactlyOnceWith("Gmail settings saved.");
    expect(api.gmail.mock.calls.filter(([body]) => body.action === "status").map(([body]) => body.tenant_id)).toEqual(["tenant-a", "tenant-b", "tenant-b"]);
    expect(within(gmailCard()).getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("also fences a changed user within the same workshop", async () => {
    const pending = deferred<SavedGmailSettingsStatus>(); api.save.mockReturnValueOnce(pending.promise);
    const view = show(); await ready("tenant-a"); fireEvent.click(within(gmailCard()).getByRole("button", { name: "Save" }));
    api.profile = { user_id: "another-admin", tenant_id: "tenant-a", role: "admin" };
    view.rerender(<MemoryRouter><IntegrationsSettingsPage /></MemoryRouter>);
    await ready("tenant-a");
    await act(async () => pending.resolve(status("tenant-a")));
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled();
    expect(api.gmail.mock.calls.filter(([body]) => body.action === "status")).toHaveLength(2);
    expect(within(gmailCard()).getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("discards a response superseded by a new read without leaving its own saving state stuck", async () => {
    const pending = deferred<SavedGmailSettingsStatus>(); api.save.mockReturnValueOnce(pending.promise);
    show(); await ready("tenant-a"); fireEvent.click(within(gmailCard()).getByRole("button", { name: "Save" }));
    // Testing another provider performs the page's existing canonical reload.
    fireEvent.click(screen.getAllByRole("button", { name: "اختبار الاتصال" })[0]);
    await waitFor(() => expect(api.gmail.mock.calls.filter(([body]) => body.action === "status")).toHaveLength(2));
    await ready("tenant-a"); api.success.mockClear();
    expect(within(gmailCard()).getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => pending.resolve(status("tenant-a")));
    expect(api.success).not.toHaveBeenCalled(); expect(api.error).not.toHaveBeenCalled();
    expect(api.gmail.mock.calls.filter(([body]) => body.action === "status")).toHaveLength(2);
    expect(within(gmailCard()).getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
