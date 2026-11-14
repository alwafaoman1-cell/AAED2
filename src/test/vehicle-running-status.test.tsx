// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
import { VehicleRunningStatusField } from "@/components/vehicle-entry/VehicleRunningStatusField";
import { needsRunningStatusBeforeIssue, parseVehicleOdometer, vehicleRunningStatus, vehicleRunningStatusLabel } from "@/lib/vehicleRunningStatus";

it("never infers a recorded running state from old free text or technical cranking", () => {
  expect(vehicleRunningStatus("Vehicle working")).toBe("unknown");
  expect(vehicleRunningStatus(undefined)).toBe("unknown");
  expect(vehicleRunningStatusLabel(undefined, "en")).toBe("Not recorded / not checked");
  expect(vehicleRunningStatusLabel("running", "ar")).toBe("المركبة تعمل");
});
it("requires a choice for a new issued intake and a draft being issued, preserving historic unknown", () => {
  expect(needsRunningStatusBeforeIssue({ status: "Draft", condition: {} }, "Draft")).toBe(false);
  expect(needsRunningStatusBeforeIssue({ status: "Draft", condition: {} }, "Issued")).toBe(true);
  expect(needsRunningStatusBeforeIssue({ id: "draft", status: "Draft", condition: { running_status: "unknown" } }, "Issued")).toBe(true);
  expect(needsRunningStatusBeforeIssue({ id: "old", status: "Issued", condition: {} }, "Issued")).toBe(false);
  expect(needsRunningStatusBeforeIssue({ status: "Draft", condition: { running_status: "not_running" } }, "Issued")).toBe(false);
});
it("parses explicit odometer readings including Arabic/Persian zero and rejects invalid values", () => {
  expect(parseVehicleOdometer("٠")).toBe(0);
  expect(parseVehicleOdometer("۱۲۳۴۵۶")).toBe(123456);
  for (const value of ["", "-1", "1.5", "1e5", "123456789", "unknown"]) expect(parseVehicleOdometer(value)).toBeNull();
});
it("starts unknown rather than selecting running, with clear explicit choices", () => {
  const change = vi.fn(); render(<VehicleRunningStatusField value={undefined} onChange={change}/>);
  expect(screen.getByRole("radio", { name: "Not recorded / not checked" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Vehicle runs" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Vehicle does not run" }));
  expect(change).toHaveBeenCalledWith("not_running");
});
