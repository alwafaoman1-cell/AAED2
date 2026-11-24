// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ role: "admin", tenant: "tenant-a", read: vi.fn(), save: vi.fn(), audit: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: mock.role, tenant_id: mock.tenant, user_id: "staff-a" } }) }));
vi.mock("@/lib/workflowRequirements", () => ({ WORKFLOW_REQUIREMENT_QUERY_KEY: "workflow_requirement_policy", readWorkflowRequirementPolicy: mock.read, setWorkflowRequirementPolicy: mock.save, listWorkflowRequirementAudit: mock.audit }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error } }));
import i18n from "@/i18n";
import WorkflowRequirementsSettingsPanel from "@/components/settings/WorkflowRequirementsSettingsPanel";
const strict = { tenant_id: "tenant-a", requirements_enabled: true, revision: 0, reason: "", updated_by: null, updated_at: null };
const relaxed = { ...strict, requirements_enabled: false, revision: 1, reason: "Documented trial", updated_by: "staff-a", updated_by_name: "Administrator", updated_at: "2026-11-23T12:00:00Z" };
let client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks(); mock.role = "admin"; mock.tenant = "tenant-a";
  mock.read.mockResolvedValue(strict); mock.save.mockResolvedValue(relaxed); mock.audit.mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await i18n.changeLanguage("en");
});
afterEach(() => { cleanup(); client.clear(); });
function panel() { return render(<MemoryRouter><QueryClientProvider client={client}><WorkflowRequirementsSettingsPanel /></QueryClientProvider></MemoryRouter>); }

describe("administrator workflow requirement controls", () => {
  it("is absent for a workshop manager or other non-administrators", () => {
    mock.role = "manager"; panel();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("requires a reason and updates the committed state only after verified service success", async () => {
    panel();
    const toggle = await screen.findByRole("switch", { name: "Enforce operational requirements" });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    const save = screen.getByRole("button", { name: "Save and apply setting" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for change" }), { target: { value: "Documented trial" } });
    fireEvent.click(save);
    await waitFor(() => expect(mock.success).toHaveBeenCalledTimes(1));
    expect(mock.save).toHaveBeenCalledWith("tenant-a", false, "Documented trial", 0);
    expect(screen.getByText(/Currently saved setting: Documented exceptions mode/)).toBeVisible();
    expect(screen.getByText(/signatures and receipts are never fabricated/)).toBeVisible();
  });
  it("keeps the saved setting enforced if a save cannot be confirmed", async () => {
    mock.save.mockRejectedValue(new Error("read-back failed")); panel();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for change" }), { target: { value: "Documented trial" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply setting" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalled());
    expect(mock.success).not.toHaveBeenCalled();
    expect(screen.getByText(/Currently saved setting: Requirements enabled/)).toBeVisible();
  });
  it("disables the control when the policy could not be loaded", async () => {
    mock.read.mockRejectedValue(new Error("missing RPC")); panel();
    expect(await screen.findByRole("alert")).toHaveTextContent("remain enforced");
    expect(screen.getByRole("switch")).toBeDisabled();
  });
  it("clears an unsaved reason when the workshop changes", async () => {
    const view = panel();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for change" }), { target: { value: "Workshop A private reason" } });
    mock.tenant = "tenant-b";
    mock.read.mockResolvedValue({ ...strict, tenant_id: "tenant-b" });
    view.rerender(<MemoryRouter><QueryClientProvider client={client}><WorkflowRequirementsSettingsPanel /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByRole("textbox", { name: "Reason for change" })).toHaveValue("");
  });
  it("uses Arabic labels when the active language is Arabic", async () => {
    await act(async () => { await i18n.changeLanguage("ar"); }); panel();
    expect(await screen.findByRole("switch", { name: "تطبيق الشروط التشغيلية" })).toBeVisible();
    expect(screen.getByRole("button", { name: "حفظ وتطبيق الإعداد" })).toBeVisible();
  });
  it.each(["en", "ar"])("shows a readable %s exception with actor, reason and linked visit", async language => {
    await act(async () => { await i18n.changeLanguage(language); });
    mock.audit.mockResolvedValue([{ id: "audit-a", entity_type: "vehicle_visit", entity_id: "entry-a", action: "advance_vehicle_visit", actor_name: "Administrator", policy_revision: 3, reason: "Approved operational exception", created_at: "2026-11-23T12:00:00Z", details: {} }]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Changes and exceptions audit" : "سجل التغييرات والاستثناءات" }));
    expect(await screen.findByText(language === "en" ? /Change visit stage with a documented exception/ : /تغيير مرحلة الزيارة باستثناء موثّق/)).toBeVisible();
    expect(screen.getByText(/Administrator.*3.*Approved operational exception/)).toBeVisible();
    expect(screen.getByRole("link", { name: language === "en" ? "Open record" : "فتح السجل" })).toHaveAttribute("href", "/vehicle-entry/entry-a");
    expect(screen.queryByText("advance_vehicle_visit")).not.toBeInTheDocument();
  });
  it.each(["en", "ar"])("shows a readable %s direct order completion exception linked to the order", async language => {
    await act(async () => { await i18n.changeLanguage(language); });
    mock.audit.mockResolvedValue([{ id: "audit-completion", entity_type: "job_order", entity_id: "order-a", action: "complete_order_with_workflow_exception", actor_name: "Workshop manager", policy_revision: 5, reason: "Authorized closing exception", created_at: "2026-11-24T12:00:00Z", details: { from_status: "received", to_status: "completed", closing_review_recorded: false } }]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Changes and exceptions audit" : "سجل التغييرات والاستثناءات" }));
    expect(await screen.findByText(language === "en" ? /Complete or deliver a work order with a documented exception/ : /إكمال أمر العمل أو تسليمه باستثناء موثّق/)).toBeVisible();
    expect(screen.getByText(/Workshop manager.*5.*Authorized closing exception/)).toBeVisible();
    expect(screen.getByRole("link", { name: language === "en" ? "Open record" : "فتح السجل" })).toHaveAttribute("href", "/work-orders/order-a");
    expect(screen.queryByText("complete_order_with_workflow_exception")).not.toBeInTheDocument();
  });
});
