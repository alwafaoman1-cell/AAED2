// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn(), navigate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en", dir: () => "ltr" } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock("@/hooks/useWorkflowRequirements", () => ({ useWorkflowRequirements: () => ({ requirementsEnabled: true }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }) } }));
import { VehicleReviewReturnAction } from "@/components/vehicle-entry/VehicleReviewReturnAction";
beforeEach(() => { vi.clearAllMocks(); });
function complete() {
  fireEvent.click(screen.getByRole("button", { name: "Return for review" }));
  fireEvent.change(screen.getByLabelText("Vehicle delivered by now"), { target: { value: "Test driver" } });
  fireEvent.change(screen.getByLabelText("Reason for return"), { target: { value: "Brake noise" } });
  fireEvent.change(screen.getByLabelText("Vehicle condition on return"), { target: { value: "Running, door scratched" } });
  fireEvent.change(screen.getByLabelText("Odometer on return (km)"), { target: { value: "١٢٠٠٠٠" } });
  fireEvent.click(screen.getByRole("radio", { name: "Vehicle runs" }));
  fireEvent.click(screen.getByRole("radio", { name: "No new visible damage" }));
}
it("requires physical arrival and retains the same request ID after an uncertain save", async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { message: "Network interrupted" } }).mockResolvedValueOnce({ data: { entry_id: "new", existing: true } });
  mocks.single.mockResolvedValue({ data: { vehicle_condition: { review_return: { source_entry_id: "old" } }, custody_receipt_required: true } });
  render(<VehicleReviewReturnAction entryId="old" />); complete();
  expect(screen.getByRole("button", { name: "Register review visit" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("I confirm the vehicle has physically arrived"));
  fireEvent.click(screen.getByRole("button", { name: "Register review visit" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Register review visit" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/vehicle-entry/new"));
  expect(mocks.rpc.mock.calls[0][1]).toEqual(expect.objectContaining({ p_mileage: 120000, p_running_status: "running", p_new_damage: false, p_new_damage_notes: "" }));
  expect(mocks.rpc.mock.calls[0][1].p_request_id).toBe(mocks.rpc.mock.calls[1][1].p_request_id);
  expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("existing review visit"));
});
it("does not claim success when read-back belongs to another source visit", async () => {
  mocks.rpc.mockResolvedValue({ data: { entry_id: "new", existing: false } });
  mocks.single.mockResolvedValue({ data: { vehicle_condition: { review_return: { source_entry_id: "different" } }, custody_receipt_required: true } });
  render(<VehicleReviewReturnAction entryId="old" />); complete();
  fireEvent.click(screen.getByLabelText("I confirm the vehicle has physically arrived"));
  fireEvent.click(screen.getByRole("button", { name: "Register review visit" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
});
it("requires an explicit new-damage answer and details before confirming a new review intake", async () => {
  mocks.rpc.mockResolvedValue({ data: { entry_id: "new", existing: false } });
  mocks.single.mockResolvedValue({ data: {
    vehicle_snapshot: { mileage: 120000 }, custody_receipt_required: true,
    vehicle_condition: { running_status: "running", review_return: { source_entry_id: "old", mileage: 120000, running_status: "running", new_damage: true, new_damage_notes: "New bumper scratch" } },
  } });
  render(<VehicleReviewReturnAction entryId="old" />); complete();
  fireEvent.click(screen.getByLabelText("I confirm the vehicle has physically arrived"));
  fireEvent.click(screen.getByRole("radio", { name: "New visible damage observed" }));
  expect(screen.getByRole("button", { name: "Register review visit" })).toBeDisabled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("New visible damage details"), { target: { value: "New bumper scratch" } });
  fireEvent.click(screen.getByRole("button", { name: "Register review visit" }));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/vehicle-entry/new"));
  expect(mocks.rpc.mock.calls[0][1]).toEqual(expect.objectContaining({ p_new_damage: true, p_new_damage_notes: "New bumper scratch" }));
});
