// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const state = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/components/Can", () => ({ default: ({ children }: { children: ReactNode }) => state.allowed ? children : null }));
import { VehicleEntryInspectionAction } from "@/components/vehicle-entry/VehicleEntryInspectionAction";
import i18n from "@/i18n";
const entry = { id: "visit-uuid", entry_number: "ENT-1", status: "Issued", vehicle_id: "vehicle", insurance_claim_id: "claim", vehicle_location: "داخل الورشة", claim: { id: "claim", status: "pending", vehicle_presence_status: "in_workshop" } };
beforeEach(async () => { state.allowed = true; await i18n.changeLanguage("en"); });
afterEach(cleanup);
describe("center inspection action", () => {
  it("opens the existing inspection page with only the canonical entry ID", () => {
    render(<MemoryRouter><VehicleEntryInspectionAction entry={entry} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Vehicle inspection · ENT-1" }).getAttribute("href")).toBe("/inspection/insurance/new?entry=visit-uuid");
  });
  it("honors the inspection permission", () => {
    state.allowed = false;
    render(<MemoryRouter><VehicleEntryInspectionAction entry={entry} /></MemoryRouter>);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it.each([{ _claimOnly: true }, { status: "Draft" }, { vehicle_location: "مع العميل" }])("does not offer creation on an ineligible card %j", patch => {
    render(<MemoryRouter><VehicleEntryInspectionAction entry={{ ...entry, ...patch }} /></MemoryRouter>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
