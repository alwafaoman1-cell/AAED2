import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertImageToWebp } from "@/lib/imageToWebp";

describe("browser photo compression", () => {
  let canvas: { width: number; height: number; getContext: () => { drawImage: ReturnType<typeof vi.fn> }; toBlob: (done: (blob: Blob) => void) => void };
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:camera");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("Image", class {
      naturalWidth = 3000;
      naturalHeight = 2000;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    });
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (done) => done(new Blob([new Uint8Array(10)], { type: "image/webp" })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downscales large camera photos and releases the temporary object URL", async () => {
    const file = new File([new Uint8Array(100)], "camera.jpg", { type: "image/jpeg" });
    const compressed = await convertImageToWebp(file, { quality: 0.78, maxDimension: 1800 });
    expect(compressed.type).toBe("image/webp");
    expect(compressed.size).toBe(10);
    expect(canvas.width).toBe(1800);
    expect(canvas.height).toBe(1200);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:camera");
  });

  it("keeps an original that is already smaller than the converted copy", async () => {
    const original = new File([new Uint8Array(5)], "tiny.jpg", { type: "image/jpeg" });
    expect(await convertImageToWebp(original)).toBe(original);
  });
});
