// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), addImage: vi.fn(), output: vi.fn() }));
vi.mock("html2canvas", () => ({ default: mocks.capture }));
vi.mock("jspdf", () => ({ default: class {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  setProperties() {}
  addPage() {}
  addImage = mocks.addImage;
  output = mocks.output;
} }));
vi.mock("@/lib/pdfLayoutSettings", () => ({ buildHtmlWithPageMarginStyle: (s: string) => s, injectPageMarginStyle: vi.fn() }));
vi.mock("@/lib/pdfDocumentRenderer", () => ({ preparePagedPdfDocument: vi.fn(), waitForPdfAssets: vi.fn(async () => {}) }));
import { generatePdfFromHtml } from "@/lib/htmlToPdf";

const pausedFrameRaf = vi.fn(() => 7);
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement && node.contentWindow) node.contentWindow.requestAnimationFrame = pausedFrameRaf;
    return result;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(), drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(16) }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,AA==");
  const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
  mocks.capture.mockResolvedValue(canvas);
  mocks.output.mockReturnValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
});
afterEach(() => { document.body.replaceChildren(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("offscreen PDF rendering", () => {
  it("finishes when iframe animation callbacks never run, preserving the sandbox", async () => {
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Vehicle Entry<script>window.unsafe=1</script><img onerror="window.unsafe=2"></main></body></html>', fileName: "ENT-001", download: false });
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).type).toBe("application/pdf");
    expect(pausedFrameRaf).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledOnce();
    const [element, options] = mocks.capture.mock.calls[0];
    expect(element.ownerDocument).toBe(document);
    expect(element.getRootNode()).toBeInstanceOf(ShadowRoot);
    expect(element.querySelector("script")).toBeNull();
    expect(element.querySelector("[onerror]")).toBeNull();
    expect(options.ignoreElements(document.createElement("input"))).toBe(true);
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(mocks.addImage).toHaveBeenCalledOnce();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
  });
  it("rejects capture errors and removes the render frame", async () => {
    mocks.capture.mockRejectedValueOnce(new Error("Capture failed"));
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Entry</main></body></html>', fileName: "ENT-001", download: false });
    const rejected = expect(pending).rejects.toThrow("Capture failed");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(document.querySelector("iframe")).toBeNull();
  });
});
