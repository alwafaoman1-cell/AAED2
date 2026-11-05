import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVehicleEntry } from "@/lib/vehicleEntryService";

const mocks = vi.hoisted(() => ({ from: vi.fn(), tenant: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.tenant }));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.tenant.mockReset().mockResolvedValue("tenant-1");
});

describe("vehicle entry summary for the cycle center", () => {
  it("loads only the canonical, tenant-scoped entry instead of fetching media and audit rows", async () => {
    const row = { id: "entry-1", tenant_id: "tenant-1", vehicle_location: "داخل الورشة" };
    const query = {
      select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    mocks.from.mockReturnValue(query);

    await expect(getVehicleEntry("entry-1", { includeAttachments: false })).resolves.toEqual(row);
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("vehicle_entries");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(query.eq).toHaveBeenCalledWith("id", "entry-1");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
  });
});
