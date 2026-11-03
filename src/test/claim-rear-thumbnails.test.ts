import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, resolveUrls } = vi.hoisted(() => ({
  from: vi.fn(),
  resolveUrls: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/lib/vehicleMediaUrls", () => ({ resolveVehicleMediaUrls: resolveUrls }));

import { getClaimRearThumbnailUrls, getEntryRearThumbnailUrls, selectClaimRearPhotos, type RearPhotoRow } from "@/lib/vehicleRearThumbnails";

const photo = (id: string, vehicleId: string, claimId: string | null, entryId: string | null): RearPhotoRow => ({
  id,
  vehicle_id: vehicleId,
  claim_id: claimId,
  vehicle_entry_id: entryId,
  storage_bucket: "insurance-docs",
  storage_path: `tenant/entry/${id}.webp`,
  public_url: null,
  uploaded_at: "2026-11-03T08:00:00Z",
});

describe("insurance claim rear thumbnails", () => {
  beforeEach(() => {
    from.mockReset();
    resolveUrls.mockReset();
  });

  it("prefers a rear photo from the same claim or visit over a newer visit, then falls back to the latest vehicle rear photo", () => {
    const newer = photo("newer", "vehicle-1", "other-claim", "other-entry");
    const matchingClaim = photo("matching-claim", "vehicle-1", "claim-1", "entry-1");
    const matchingEntry = photo("matching-entry", "vehicle-1", null, "entry-2");
    const chosen = selectClaimRearPhotos([
      { id: "claim-1", vehicle_id: "vehicle-1" },
      { id: "claim-2", vehicle_id: "vehicle-1", vehicle_entry_id: "entry-2" },
      { id: "claim-3", vehicle_id: "vehicle-1" },
      { id: "claim-4", vehicle_id: "vehicle-2" },
    ], [newer, matchingClaim, matchingEntry]);
    expect(chosen["claim-1"].id).toBe("matching-claim");
    expect(chosen["claim-2"].id).toBe("matching-entry");
    expect(chosen["claim-3"].id).toBe("newer");
    expect(chosen["claim-4"]).toBeUndefined();
  });

  it("reads only tenant-scoped, active rear images and signs selected files without writing or duplicating media", async () => {
    const filters: Array<[string, unknown]> = [];
    const rows = [photo("newer", "vehicle-1", "other-claim", "other-entry"), photo("own", "vehicle-1", "claim-1", "entry-1")];
    const query = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockImplementation((key: string, value: unknown) => { filters.push([key, value]); return query; });
    query.in.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: rows, error: null });
    from.mockReturnValue(query);
    resolveUrls.mockImplementation(async (selected: RearPhotoRow[]) => selected.map((row) => ({ ...row, url: `https://signed/${row.id}` })));

    const urls = await getClaimRearThumbnailUrls("tenant-1", [{ id: "claim-1", vehicle_id: "vehicle-1" }]);

    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("vehicle_media");
    expect(filters).toEqual(expect.arrayContaining([
      ["tenant_id", "tenant-1"], ["media_type", "image"], ["category", "rear_view"],
    ]));
    expect(query.in).toHaveBeenCalledWith("vehicle_id", ["vehicle-1"]);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.order).toHaveBeenCalledWith("uploaded_at", { ascending: false, nullsFirst: false });
    expect(resolveUrls).toHaveBeenCalledWith([rows[1]]);
    expect(urls).toEqual({ "claim-1": "https://signed/own" });
    expect((query as Record<string, unknown>).insert).toBeUndefined();
  });

  it("uses the exact vehicle visit for entry thumbnails and never substitutes another visit", async () => {
    const rows = [photo("new", "vehicle-1", "claim-2", "entry-2"), photo("old", "vehicle-1", "claim-1", "entry-1")];
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn() };
    for (const method of [query.select, query.eq, query.in, query.is, query.order]) method.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [rows[1]], error: null });
    from.mockReturnValue(query);
    resolveUrls.mockImplementation(async (selected: RearPhotoRow[]) => selected.map((row) => ({ ...row, url: `https://signed/${row.id}` })));

    const urls = await getEntryRearThumbnailUrls("tenant-1", ["entry-1", "entry-1"]);

    expect(query.in).toHaveBeenCalledWith("vehicle_entry_id", ["entry-1"]);
    expect(resolveUrls).toHaveBeenCalledWith([rows[1]]);
    expect(urls).toEqual({ "entry-1": "https://signed/old" });
    expect(urls["entry-2"]).toBeUndefined();
  });

  it("does not query media without a tenant or a linked vehicle", async () => {
    expect(await getClaimRearThumbnailUrls("", [{ id: "claim", vehicle_id: "vehicle" }])).toEqual({});
    expect(await getClaimRearThumbnailUrls("tenant", [{ id: "claim", vehicle_id: null }])).toEqual({});
    expect(await getEntryRearThumbnailUrls("tenant", [])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});
