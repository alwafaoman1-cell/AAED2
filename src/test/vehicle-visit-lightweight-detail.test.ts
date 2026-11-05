import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVehicleVisitDetail } from "@/lib/vehicleVisitLifecycle";

const mocks = vi.hoisted(() => ({ from: vi.fn(), entry: vi.fn(), tenant: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));
vi.mock("@/lib/vehicleEntryService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicleEntryService")>()),
  getVehicleEntry: mocks.entry,
}));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.entry.mockReset();
  mocks.tenant.mockReset().mockResolvedValue("tenant-1");
});

describe("cycle-center quick detail", () => {
  it("fetches custody evidence without requesting the full operational file", async () => {
    mocks.entry.mockResolvedValue({
      id: "entry-1", vehicle_id: "vehicle-1", vehicle_location: "داخل الورشة",
      arrival_date: "2026-11-04", status: "Received", work_order_id: "order-1",
      work_order: { id: "order-1", vehicle_id: "vehicle-1", status: "received", work_order_type: "cash", vehicle_presence_status: "in_workshop" },
    });
    const results: Record<string, unknown> = {
      vehicle_visit_workflows: null,
      vehicle_handover_records: [],
      vehicle_inspection_releases: [],
    };
    mocks.from.mockImplementation((table: string) => {
      const result = { data: results[table], error: null };
      const query: Record<string, any> = {};
      for (const method of ["select", "eq", "order", "limit"]) query[method] = () => query;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return query;
    });

    const detail = await getVehicleVisitDetail("entry-1", { includeOperationalFile: false });
    expect(detail?.stage).toBe("arrived");
    expect(detail?.expenses).toEqual([]);
    expect(mocks.entry).toHaveBeenCalledWith("entry-1", { includeAttachments: false });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      "vehicle_visit_workflows", "vehicle_handover_records", "vehicle_inspection_releases",
    ]);
  });
});
