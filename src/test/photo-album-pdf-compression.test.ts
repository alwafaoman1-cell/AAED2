import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pdfGenerator", () => ({
  getTemplateSettings: () => ({
    logoUrl: "",
    companyNameEn: "Al Wafa Auto",
    primaryColor: "#c79b35",
  }),
}));

import { generatePhotoAlbumPdf } from "@/lib/photoAlbumPdf";

const SMALL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAUSURBVAiZY2RgYPjPwMDAwMQABQAOKAEDtjjK0wAAAABJRU5ErkJggg==";

describe("photo album PDF generation", () => {
  it("produces a real compact PDF containing all gallery images", async () => {
    const images = Array.from({ length: 5 }, () => ({ dataUrl: SMALL_PNG, width: 2, height: 2 }));
    const blob = await generatePhotoAlbumPdf(images, { workOrderRef: "WO-C-26-0001", title: "WO-C-26-0001" });
    const bytes = await blob.arrayBuffer();
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    const source = new TextDecoder("latin1").decode(bytes);
    expect(header).toBe("%PDF-");
    expect(source).toContain("/Subtype /Image");
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(blob.size).toBeLessThan(100_000);
  });

  it("does not silently deliver an incomplete album when an image is corrupt", async () => {
    await expect(generatePhotoAlbumPdf([
      { dataUrl: "data:image/png;base64,AA==", width: 2, height: 2 },
    ], { workOrderRef: "WO-C-26-0001" })).rejects.toThrow("PHOTO_ALBUM_IMAGE_FAILED:1");
  });
});
