// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorVehicleCard } from "@/components/supervisor/SupervisorVehicleCard";
import { useSupervisorTheme } from "@/hooks/useSupervisorTheme";
import type { SupervisorVehicle } from "@/lib/supervisorWorkspace";
import i18n from "@/i18n";
const projection = vi.hoisted(() => ({ centerTab: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getVehicleCenterTab: projection.centerTab }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/supervisorWorkspace", () => ({ supervisorCanOpenAction: (row: SupervisorVehicle, action: string) =>
  action === "messages" ? Boolean(row.entryId || row.claimId) : action === "stages" || action === "location" ? Boolean(row.entryId)
    : action === "expense" ? Boolean(row.entryId || row.workOrderId) : Boolean(row.workOrderId) }));
const row: SupervisorVehicle = { key: "one", entryId: "one", number: "ENT-1", workOrderNumber: "WO-I-26-0124", workOrderId: "order",
  customer: "Customer", vehicle: "Toyota RAV4", plate: "RR 12345", country: "OM", arrivalDate: "2026-10-21", channel: "insurance",
  custody: "in_workshop", stage: "arrived", review: false, legacy: false };
const permissions = { expense: true, stages: true, workOrder: true, entry: true, messages: true };
beforeEach(async () => { projection.centerTab.mockReset(); projection.centerTab.mockReturnValue("in_workshop"); await i18n.changeLanguage("en"); });
afterEach(cleanup);
describe("compact supervisor card", () => {
  it("keeps complete references, separate day counters, and primary actions in the workspace", () => {
    const action = vi.fn();
    const { container } = render(<SupervisorVehicleCard row={row} permissions={permissions} onAction={action} onOpenEntry={vi.fn()} milestones={[]} now={Date.parse("2026-11-06T08:00:00+04:00")} />);
    expect(screen.getByText("WO-I-26-0124").className).toContain("whitespace-nowrap");
    expect(container.querySelector('[data-clock="arrivalAge"]')?.getAttribute("data-tone")).toBe("overdue");
    expect(screen.getByText("No approval date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update stage" }));
    expect(action).toHaveBeenCalledWith("stages", row);
    fireEvent.click(screen.getByRole("button", { name: /Actual location/ }));
    expect(action).toHaveBeenCalledWith("location", row);
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(action).toHaveBeenCalledWith("expense", row);
    expect(container.querySelector('a[href^="/work-orders"],a[href^="/insurance"],a[href^="/accounting"]')).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });
  it("does not bypass permissions or make an unconfirmed order editable", () => {
    render(<SupervisorVehicleCard row={{ ...row, workOrderId: undefined }} permissions={{ ...permissions, stages: false, expense: false }} onAction={vi.fn()} onOpenEntry={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Update stage" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add expense" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Photos" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("has fully translated Arabic labels and the same color thresholds", async () => {
    await i18n.changeLanguage("ar");
    const { container } = render(<SupervisorVehicleCard row={row} permissions={permissions} onAction={vi.fn()} onOpenEntry={vi.fn()} milestones={[]} now={Date.parse("2026-11-20T08:00:00+04:00")} />);
    expect(screen.getByRole("button", { name: "تحديث المرحلة" })).toBeTruthy();
    expect(screen.getByText("أكثر من 25 يومًا — متابعة عاجلة")).toBeTruthy();
    expect(container.querySelector('[data-clock="arrivalAge"]')?.getAttribute("data-tone")).toBe("critical");
  });
  it.each(["with_customer", "in_workshop"])("uses the central confirmed custody result for the pending badge and arrival clock at %s", tab => {
    const visit = { entry: { id: "one", vehicle_location: "مع العميل", vehicle_condition: { visit_purpose: "inspection", arrival_confirmation: "pending" } },
      workflow: null, stage: "arrived" as const, operationalStage: "arrived" as const, reviewReason: null,
      hasFinalHandover: false, hasSignedTemporaryRelease: tab === "with_customer" };
    projection.centerTab.mockReturnValue(tab);
    const { container } = render(<SupervisorVehicleCard row={{ ...row, visit }} permissions={permissions} onAction={vi.fn()} onOpenEntry={vi.fn()} milestones={[]} now={Date.parse("2026-11-06T08:00:00+04:00")} />);
    expect(screen.getByText("Arrived")).toBeTruthy();
    expect(container.querySelector('[data-clock="arrivalAge"]')?.getAttribute("data-tone")).toBe("overdue");
    expect(projection.centerTab).toHaveBeenCalledWith(visit);
    expect(visit.entry.vehicle_condition.arrival_confirmation).toBe("pending");
  });
  it("keeps a genuine prepared arrival unconfirmed in both the badge and clock", () => {
    projection.centerTab.mockReturnValue("awaiting_arrival");
    const visit = { entry: { id: "one", vehicle_location: "مع العميل", vehicle_condition: { visit_purpose: "inspection", arrival_confirmation: "pending" } },
      workflow: null, stage: "arrived" as const, operationalStage: "arrived" as const, reviewReason: null, hasFinalHandover: false };
    const { container } = render(<SupervisorVehicleCard row={{ ...row, visit }} permissions={permissions} onAction={vi.fn()} onOpenEntry={vi.fn()} milestones={[]} />);
    expect(screen.queryByText("Arrived")).toBeNull();
    expect(screen.getByText("Date not confirmed")).toBeTruthy();
    expect(container.querySelector('[data-clock="arrivalAge"]')?.getAttribute("data-tone")).toBe("unknown");
  });
});
describe("route-scoped low-glare theme", () => {
  function Theme() { useSupervisorTheme(); return null; }
  it("applies to portal dialogs and is removed when leaving Supervisor, without persisting operational data", () => {
    const { unmount } = render(<Theme />);
    expect(document.documentElement.dataset.workspace).toBe("supervisor");
    unmount(); expect(document.documentElement.dataset.workspace).toBeUndefined();
  });
});
