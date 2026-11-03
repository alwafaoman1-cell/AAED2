// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VehicleVisitBadge } from "@/components/vehicles/VehicleVisitBadge";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ linked: vi.fn() }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getLinkedVehicleVisit: mocks.linked }));
const ID = "7e5373de-9a8a-43fe-92df-7c6097e1849f";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <VehicleVisitBadge source="claim" id={ID} />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  mocks.linked.mockReset();
});

describe("linked visit badge", () => {
  it("shows the same stage and physical custody as the center", async () => {
    mocks.linked.mockResolvedValue({ entryId: ID, number: "ENT-26-0001", stage: "in_progress", presence: "in_workshop" });
    show();
    const link = await screen.findByRole("link");
    expect(link.textContent).toContain("قيد العمل");
    expect(link.textContent).toContain("داخل الورشة");
    expect(link.getAttribute("href")).toBe(`/vehicle-entry/${ID}`);
  });
  it("does not guess a physical location when linked records conflict", async () => {
    mocks.linked.mockResolvedValue({ entryId: ID, number: "ENT-26-0001", stage: "needs_review", presence: "needs_review" });
    show();
    expect((await screen.findByRole("link")).textContent).toContain("تحتاج مراجعة الموقع");
  });
});
