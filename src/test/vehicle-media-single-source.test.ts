import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { sign } = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/lib/refreshSignedUrls", () => ({ refreshSignedUrls: sign }));

import { canonicalMediaReference, mediaStorageKey, parseMediaStorageReference, resolveVehicleMediaUrls } from "@/lib/vehicleMediaUrls";
import { mergeWorkOrderMedia } from "@/lib/workOrderMedia";

const source = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");

describe("vehicle image single-source reads", () => {
  it("extracts durable identity from expired signed URLs without duplicating a file", () => {
    const old = "https://example.supabase.co/storage/v1/object/sign/work-order-photos/tenant/order/a.webp?token=expired";
    expect(parseMediaStorageReference(old)).toEqual({ bucket: "work-order-photos", path: "tenant/order/a.webp" });
    expect(canonicalMediaReference(old, "work-order-photos")).toBe("tenant/order/a.webp");
    expect(mediaStorageKey("work-order-photos", old)).toBe(mediaStorageKey("work-order-photos", "tenant/order/a.webp"));
  });

  it("signs each unique storage file once and does not use a raw path as an image URL", async () => {
    sign.mockReset();
    sign.mockResolvedValue(new Map([["tenant/order/a.webp", "https://fresh/image"]]));
    const rows = await resolveVehicleMediaUrls([
      { storage_bucket: "work-order-photos", storage_path: "tenant/order/a.webp", public_url: "https://stale/image" },
      { storage_bucket: "work-order-photos", storage_path: "tenant/order/a.webp", public_url: null },
    ]);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith("work-order-photos", ["tenant/order/a.webp"]);
    expect(rows.map((row) => row.url)).toEqual(["https://fresh/image", "https://fresh/image"]);
    expect(rows[0].public_url).toBe("https://stale/image"); // no database mutation
  });

  it("signs large galleries in bounded batches", async () => {
    sign.mockReset();
    sign.mockImplementation(async (_bucket: string, paths: string[]) => new Map(paths.map((path) => [path, `https://fresh/${path}`])));
    const rows = await resolveVehicleMediaUrls(Array.from({ length: 101 }, (_, index) => ({
      storage_bucket: "work-order-photos", storage_path: `tenant/order/${index}.webp`,
    })));
    expect(sign).toHaveBeenCalledTimes(2);
    expect(sign.mock.calls[0][1]).toHaveLength(100);
    expect(sign.mock.calls[1][1]).toHaveLength(1);
    expect(rows[100].url).toBe("https://fresh/tenant/order/100.webp");
  });

  it("merges claim/entry and work-order references to one gallery image", () => {
    const media = [{ id: "media-1", media_type: "image", storage_bucket: "work-order-photos",
      storage_path: "tenant/order/a.webp", url: "https://fresh/image", public_url: null,
      category: "inspection", stage: "inspection", caption: null, uploaded_at: "2026-10-07" }] as any;
    const old = [{ id: "photo-1", phase: "inspection", storagePath: "tenant/order/a.webp",
      dataUrl: "https://stale/image", uploadedAt: "2026-10-07" }] as any;
    const merged = mergeWorkOrderMedia(media, old);
    expect(merged).toHaveLength(1);
    expect(merged[0].dataUrl).toBe("https://fresh/image");
  });

  it("keeps an unindexed legacy photo visible and excludes non-images", () => {
    const legacy = [{ id: "old", phase: "received", dataUrl: "data:image/png;base64,AA", uploadedAt: "2026-01-01" }] as any;
    const doc = [{ id: "document", media_type: "document", storage_bucket: "insurance-docs", storage_path: "a.pdf",
      url: "https://fresh/doc", public_url: null }] as any;
    expect(mergeWorkOrderMedia(doc, legacy)).toEqual(legacy);
  });

  it("deduplicates a receipt reference against its canonical media row", () => {
    const media = [{ id: "media", media_type: "image", storage_bucket: "damage-photos", storage_path: "reception/wo/one.webp",
      url: "https://supabase.example/storage/v1/object/sign/damage-photos/reception/wo/one.webp?token=new",
      category: "vehicle_receipt", uploaded_at: "2026-10-07" }] as any;
    const receipt = [{ id: "receipt", phase: "received", storagePath: "reception/wo/one.webp",
      dataUrl: "https://supabase.example/storage/v1/object/sign/damage-photos/reception/wo/one.webp?token=new", uploadedAt: "2026-10-07" }] as any;
    expect(mergeWorkOrderMedia(media, receipt)).toHaveLength(1);
  });

  it("does not persist expired URLs and filters soft-deleted media before display", () => {
    const unified = source("src/lib/claimWorkOrderUnified.ts");
    const workOrder = source("src/pages/WorkOrderDetail.tsx");
    expect(unified).toContain('.is("deleted_at", null)');
    expect(unified).toContain("resolveVehicleMediaUrls");
    expect(workOrder).toContain("mergeWorkOrderMedia(unifiedMedia, [...resolvedLegacyPhotos, ...attachedPhotos])");
    expect(workOrder).not.toContain("media.public_url || media.storage_path");
    expect(source("src/lib/workOrdersStore.ts")).toContain("publicUrl: null");
  });

  it("keeps one cloud copy and does not silently fall back to inline photos after an upload failure", () => {
    const stage = source("src/components/workorders/StagePhotosDialog.tsx");
    const status = source("src/components/workorders/WorkOrderStatusDialog.tsx");
    expect(stage).not.toContain("new FileReader");
    expect(status).not.toContain("new FileReader");
    expect(stage).toContain("فشل رفع");
    expect(status).toContain("فشل رفع");
    expect(source("src/lib/workOrdersStore.ts")).toContain('bucket: "work-order-photos"');
    expect(source("src/lib/workOrdersStore.ts")).not.toContain("migrateLegacyPhotosInBackground");
  });

  it("reads archived claim images from the canonical source without deleting shared Storage objects", () => {
    const archive = source("src/pages/insurance/ClaimArchivePage.tsx");
    expect(archive).toContain("getClaimMedia(id!)");
    expect(archive).toContain("resolveVehicleMediaUrls");
    expect(archive).not.toContain("removeStorageObjectIfPossible");
    expect(archive).not.toContain(".storage.from(candidate.bucket).remove");
  });

  it("reads reception and supplement references into the work-order gallery without re-uploading", () => {
    const reader = source("src/lib/workOrderAttachedPhotos.ts");
    expect(reader).toContain('select("reception_photos")');
    expect(reader).toContain('select("id,photos,created_at")');
    expect(reader).toContain('resolveImageReferences(paths, "damage-photos")');
    expect(reader).not.toContain(".upload(");
  });

  it("re-signs avatar fallbacks that point to expired Storage URLs", () => {
    const avatar = source("src/components/vehicles/VehicleAvatar.tsx");
    const service = source("src/lib/vehicleAvatarService.ts");
    expect(avatar).toContain("resolveVehicleMediaUrls");
    expect(avatar).toContain("parseMediaStorageReference(candidate)");
    expect(service).toContain("resolveVehicleMediaUrls([row])");
  });

  it("writes new claim photos once to canonical media, not to expiring legacy arrays", () => {
    const detail = source("src/pages/insurance/InsuranceClaimDetailRedesigned.tsx");
    expect(detail).toContain("if (!savedMedia) throw new Error");
    expect(detail).not.toContain("damage_photos: [...(claim.damage_photos || [])");
    expect(detail).toContain("mediaStorageKey(media.storage_bucket, media.storage_path)");
  });

  it("refreshes delivery photo references on display without changing saved claim data", () => {
    const delivery = source("src/components/insurance/ClaimDeliverySection.tsx");
    expect(delivery).toContain("resolveVehicleMediaUrls");
    expect(delivery).toContain("displayUrls[u] || u");
    expect(delivery).toContain("delivery_photos: deliveryPhotos");
  });
});
