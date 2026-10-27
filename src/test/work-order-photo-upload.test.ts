import { beforeEach, describe, expect, it, vi } from "vitest";

const { upload, createSignedUrl, convertImageToWebp, getCurrentTenantId } = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  convertImageToWebp: vi.fn(),
  getCurrentTenantId: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ upload, createSignedUrl }) } },
}));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId }));
vi.mock("@/lib/imageToWebp", () => ({ convertImageToWebp }));
vi.mock("@/lib/vehicleMediaUrls", () => ({ resolveVehicleMediaUrls: vi.fn() }));

import { uploadStagePhoto } from "@/lib/workOrderPhotosStorage";

describe("work order photo upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantId.mockResolvedValue("tenant-1");
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.test/photo" } });
  });

  it("uploads the optimized image once with a matching MIME, extension, and tenant path", async () => {
    const original = new File([new Uint8Array(100)], "camera.jpg", { type: "image/jpeg" });
    const optimized = new File([new Uint8Array(20)], "camera.webp", { type: "image/webp" });
    convertImageToWebp.mockResolvedValue(optimized);

    const result = await uploadStagePhoto({ orderId: "WO-C-26-0001", photoId: "photo-1", file: original });

    expect(convertImageToWebp).toHaveBeenCalledWith(original, {
      quality: 0.78, maxDimension: 1800, reencodeWebp: true,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(
      "tenant-1/WO-C-26-0001/photo-1.webp",
      optimized,
      { contentType: "image/webp", cacheControl: "31536000", upsert: false },
    );
    expect(result?.path).toBe("tenant-1/WO-C-26-0001/photo-1.webp");
  });

  it("preserves a smaller JPEG without mislabeling it as WebP", async () => {
    const original = new File([new Uint8Array(20)], "small.jpg", { type: "image/jpeg" });
    convertImageToWebp.mockResolvedValue(original);
    await uploadStagePhoto({ orderId: "WO-I-26-0001", photoId: "photo-2", file: original });
    expect(upload).toHaveBeenCalledWith(
      "tenant-1/WO-I-26-0001/photo-2.jpg",
      original,
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("does not upload an oversized or unsupported image", async () => {
    const file = new File([new Uint8Array(1)], "large.jpg", { type: "image/jpeg" });
    convertImageToWebp.mockResolvedValue({ type: "image/jpeg", size: 7 * 1024 * 1024 });
    expect(await uploadStagePhoto({ orderId: "WO-C-26-0001", photoId: "large", file })).toBeNull();
    expect(upload).not.toHaveBeenCalled();

    const unsupported = new File([new Uint8Array(1)], "animation.gif", { type: "image/gif" });
    convertImageToWebp.mockResolvedValue(unsupported);
    expect(await uploadStagePhoto({ orderId: "WO-C-26-0001", photoId: "gif", file: unsupported })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });
});
