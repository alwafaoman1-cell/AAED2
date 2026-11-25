// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), addImage: vi.fn(), addPage: vi.fn(), output: vi.fn(), paginate: vi.fn() }));
vi.mock("html2canvas", () => ({ default: mocks.capture }));
vi.mock("jspdf", () => ({ default: class {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  setProperties() {}
  addPage = mocks.addPage;
  addImage = mocks.addImage;
  output = mocks.output;
} }));
vi.mock("@/lib/pdfLayoutSettings", () => ({ buildHtmlWithPageMarginStyle: (s: string) => s, injectPageMarginStyle: vi.fn() }));
vi.mock("@/lib/pdfDocumentRenderer", () => ({ preparePagedPdfDocument: mocks.paginate, waitForPdfAssets: vi.fn(async () => {}) }));
import { generatePdfFromHtml } from "@/lib/htmlToPdf";

const pausedFrameRaf = vi.fn(() => 7);
let restoreFonts = () => {};
let autoLoadFrames = true;

function mockCssConnectedFonts(ready: Promise<void>, nativeReplacement = true) {
  const descriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  const face = { family: "PDF Arabic", style: "normal", weight: "400", stretch: "normal", unicodeRange: "U+0-10FFFF", status: "loaded" };
  const fonts = {
    ready,
    has: vi.fn(() => false),
    add: vi.fn<(font: typeof face) => void>(() => { throw new DOMException("The object can not be modified in this way.", "InvalidModificationError"); }),
    delete: vi.fn(),
    forEach: (visit: (font: typeof face) => void) => { if (nativeReplacement) visit({ ...face }); },
  };
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  restoreFonts = () => {
    if (descriptor) Object.defineProperty(document, "fonts", descriptor);
    else Reflect.deleteProperty(document, "fonts");
  };
  const append = vi.mocked(document.body.appendChild).getMockImplementation()!;
  vi.mocked(document.body.appendChild).mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement && node.contentDocument) {
      Object.defineProperty(node.contentDocument, "fonts", {
        configurable: true,
        value: { forEach: (visit: (font: typeof face) => void) => visit(face) },
      });
    }
    return result;
  });
  return { ...fonts, sourceFace: face };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.paginate.mockReset();
  autoLoadFrames = true;
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement && node.contentWindow) {
      node.contentWindow.requestAnimationFrame = pausedFrameRaf;
      // jsdom does not relay document.write's document load to its iframe.
      if (autoLoadFrames) setTimeout(() => node.dispatchEvent(new Event("load")), 0);
    }
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
afterEach(() => { document.body.replaceChildren(); restoreFonts(); restoreFonts = () => {}; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("offscreen PDF rendering", () => {
  it("embeds the entire near-fit vehicle intake canvas once, centered and bounded, before any trimming or slicing", async () => {
    const canvas = document.createElement("canvas"); canvas.width = 1961; canvas.height = 2803;
    const fullImage = vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/jpeg;base64,FULL_SAVED_FORM_AND_FOOTER");
    mocks.capture.mockResolvedValueOnce(canvas);
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page" data-pdf-fixed-form="vehicle-entry">Saved signed intake</main></body></html>', fileName: "intake", download: false });
    await vi.advanceTimersByTimeAsync(100); await pending;
    expect(fullImage).toHaveBeenCalledExactlyOnceWith("image/jpeg", 0.95);
    expect(mocks.addImage).toHaveBeenCalledOnce(); expect(mocks.addPage).not.toHaveBeenCalled();
    const [image, format, x, y, width, height] = mocks.addImage.mock.calls[0];
    expect(image).toBe("data:image/jpeg;base64,FULL_SAVED_FORM_AND_FOOTER"); expect(format).toBe("JPEG");
    expect(x).toBeGreaterThan(0); expect(y).toBe(0); expect(x + width).toBeLessThanOrEqual(210); expect(y + height).toBeLessThanOrEqual(297);
    expect(width / height).toBeCloseTo(1961 / 2803, 12);
    expect(mocks.paginate).toHaveBeenCalledOnce();
  });
  it.each([
    ["", 1961, 2803],
    ['data-pdf-fixed-form="another-form"', 1961, 2803],
    ['data-pdf-fixed-form="vehicle-entry"', 1941, 2832],
    ['data-pdf-fixed-form="vehicle-entry"', 1961, 4000],
  ])("keeps existing raster pagination for non-intake or genuine overflow (%s, %i×%i)", async (marker, width, height) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    mocks.capture.mockResolvedValueOnce(canvas);
    const pending = generatePdfFromHtml({ htmlContent: `<html><body><main class="page" ${marker}>Complete overflow content</main></body></html>`, fileName: "overflow", download: false });
    await vi.advanceTimersByTimeAsync(100); await pending;
    expect(mocks.addPage).toHaveBeenCalled(); expect(mocks.addImage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it.each([
    ['data-pdf-fixed-form="vehicle-entry"', "1.2mm"],
    ["", "7mm"],
    ['data-pdf-fixed-form="another-form"', "7mm"],
  ])("preserves the intake footer gap only for its existing fixed-form marker (%s)", async (marker, expectedGap) => {
    let inspected = false;
    mocks.paginate.mockImplementationOnce((doc: Document) => {
      const page = doc.querySelector<HTMLElement>(".page")!;
      const footer = doc.querySelector<HTMLElement>(".footer")!;
      const signature = doc.querySelector<HTMLImageElement>(".saved-signature")!;
      // Inspect the real export CSS cascade before pagination/rasterization,
      // rather than asserting source text or pretending jsdom measures A4.
      expect(doc.defaultView!.getComputedStyle(footer).marginTop).toBe(expectedGap);
      expect(doc.defaultView!.getComputedStyle(page).overflow).toBe("visible");
      expect(signature.getAttribute("src")).toBe("data:image/png;base64,c2lnbmVk");
      expect(footer.textContent).toBe("Saved intake footer");
      inspected = true;
    });
    const pending = generatePdfFromHtml({ htmlContent: `<html><head><style>.footer{margin-top:1.2mm}</style></head><body><main class="page" ${marker}><section>Saved entry data</section><img class="saved-signature" src="data:image/png;base64,c2lnbmVk"><footer class="footer">Saved intake footer</footer></main></body></html>`, fileName: "entry-footer", download: false });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(inspected).toBe(true);
    expect(mocks.paginate).toHaveBeenCalledOnce();
    expect(mocks.paginate.mock.calls[0][0].nodeType).toBe(9);
    expect(mocks.paginate.mock.calls[0][1]).toBe("portrait");
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("waits for the written document's load instead of trusting an already-complete blank frame", async () => {
    autoLoadFrames = false;
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Estimate</main></body></html>', fileName: "Estimate-Load", download: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.capture).not.toHaveBeenCalled();
    document.querySelector("iframe")!.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).type).toBe("application/pdf");
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

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

  it("uses the native CSS font after WebKit rejects object transfer and awaits its readiness", async () => {
    let finishFonts!: () => void;
    const fonts = mockCssConnectedFonts(new Promise<void>((resolve) => { finishFonts = resolve; }));
    const pending = generatePdfFromHtml({ htmlContent: '<html><head><style>@font-face{font-family:"PDF Arabic";src:url(/test-font.woff2)}</style></head><body><main class="page">تقدير إصلاح</main></body></html>', fileName: "Estimate-001", download: false });
    const result = expect(pending).resolves.toHaveProperty("type", "application/pdf");
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(document.querySelector("temo-pdf-capture")).not.toBeNull();
    finishFonts();
    await vi.advanceTimersByTimeAsync(0);
    await result;
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(fonts.add).toHaveBeenCalledOnce();
    expect(fonts.delete).not.toHaveBeenCalled();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("waits for imported font CSS even when the previous fonts.ready has already resolved", async () => {
    mockCssConnectedFonts(Promise.resolve());
    const pending = generatePdfFromHtml({ htmlContent: '<html><head><style>@import url("https://example.com/fonts.css");</style></head><body><main class="page">تقدير إصلاح</main></body></html>', fileName: "Estimate-Imported-Font", download: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.capture).not.toHaveBeenCalled();
    const host = document.querySelector("temo-pdf-capture")!;
    const fontStyle = Array.from(host.shadowRoot!.querySelectorAll("style")).find((node) => node.textContent?.includes("@import"))!;
    fontStyle.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).type).toBe("application/pdf");
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("times out pending capture fonts and cleans up without saving an incomplete PDF", async () => {
    const fonts = mockCssConnectedFonts(new Promise<void>(() => {}));
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Estimate</main></body></html>', fileName: "Estimate-002", download: false });
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5200);
    await rejected;
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.output).not.toHaveBeenCalled();
    expect(fonts.add).toHaveBeenCalledOnce();
    expect(fonts.delete).not.toHaveBeenCalled();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects a missing native replacement instead of silently falling back to a different font", async () => {
    mockCssConnectedFonts(Promise.resolve(), false);
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Estimate</main></body></html>', fileName: "Estimate-003", download: false });
    const rejected = expect(pending).rejects.toHaveProperty("name", "InvalidModificationError");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.output).not.toHaveBeenCalled();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("preserves supported font transfer in Chromium and removes only the transferred face", async () => {
    const fonts = mockCssConnectedFonts(Promise.resolve(), false);
    fonts.add.mockImplementation(() => {});
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Estimate</main></body></html>', fileName: "Estimate-004", download: false });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).type).toBe("application/pdf");
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(fonts.add).toHaveBeenCalledExactlyOnceWith(fonts.sourceFace);
    expect(fonts.delete).toHaveBeenCalledExactlyOnceWith(fonts.sourceFace);
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("propagates other font registration failures and cleans up", async () => {
    const fonts = mockCssConnectedFonts(Promise.resolve());
    fonts.add.mockImplementation(() => { throw new DOMException("Font access failed", "SecurityError"); });
    const pending = generatePdfFromHtml({ htmlContent: '<html><body><main class="page">Estimate</main></body></html>', fileName: "Estimate-005", download: false });
    const rejected = expect(pending).rejects.toHaveProperty("name", "SecurityError");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(document.querySelector("temo-pdf-capture")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
