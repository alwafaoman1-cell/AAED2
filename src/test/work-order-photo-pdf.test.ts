import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StagePhoto } from "@/lib/workOrdersStore";

const { resolveVehicleMediaUrls, generatePhotoAlbumPdf } = vi.hoisted(() => ({
  resolveVehicleMediaUrls: vi.fn(),
  generatePhotoAlbumPdf: vi.fn(),
}));
vi.mock("@/lib/vehicleMediaUrls", () => ({
  parseMediaStorageReference: () => null,
  resolveVehicleMediaUrls,
}));
vi.mock("@/lib/photoAlbumPdf", () => ({ generatePhotoAlbumPdf }));

import { generateWorkOrderPhotosPdf } from "@/lib/workOrderPhotoPdf";

const photos: StagePhoto[] = [
  { id: "one", phase: "received", dataUrl: "https://example.test/one", uploadedAt: "" },
  { id: "two", phase: "inspection", dataUrl: "https://example.test/two", uploadedAt: "" },
];

describe("work order photo PDF export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveVehicleMediaUrls.mockImplementation(async (rows: Array<{ public_url: string }>) => rows.map((row) => ({ ...row, url: row.public_url })));
    generatePhotoAlbumPdf.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/jpeg" }) }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("Image", class {
      naturalWidth = 2400;
      naturalHeight = 1600;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }),
        toDataURL: () => "data:image/jpeg;base64,AA==",
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("includes every gallery photo after downsizing, without writing a second Storage object", async () => {
    const progress = vi.fn();
    const result = await generateWorkOrderPhotosPdf(photos, "WO-C-26-0001", progress);
    expect(result.type).toBe("application/pdf");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(generatePhotoAlbumPdf).toHaveBeenCalledWith(
      [
        { dataUrl: "data:image/jpeg;base64,AA==", width: 1200, height: 800 },
        { dataUrl: "data:image/jpeg;base64,AA==", width: 1200, height: 800 },
      ],
      { workOrderRef: "WO-C-26-0001", title: "WO-C-26-0001" },
    );
  });

  it("aborts the whole export when one stored photo cannot be read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await expect(generateWorkOrderPhotosPdf(photos, "WO-C-26-0001")).rejects.toThrow("PHOTO_PDF_IMAGE_FAILED:1");
    expect(generatePhotoAlbumPdf).not.toHaveBeenCalled();
  });
});
