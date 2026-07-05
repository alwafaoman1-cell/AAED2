// QA utility: compare a print-preview DOM element against the first page of its
// generated PDF and report a similarity ratio (0..1). Used to catch regressions
// where PDF output drifts from on-screen print preview.

import html2canvas from "html2canvas";

export interface PdfQaResult {
  similarity: number;        // 0..1 (1 = identical)
  printWidth: number;
  printHeight: number;
  pdfWidth: number;
  pdfHeight: number;
  pages: number;
  passed: boolean;
  threshold: number;
}

export interface PdfQaOptions {
  /** Acceptance threshold (default 0.92). */
  threshold?: number;
  /** Compare-resolution width in pixels (both sides downscale to this). */
  compareWidth?: number;
}

const toGrayscale = (img: ImageData): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    out[j] = (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) | 0;
  }
  return out;
};

const drawToFixedSize = (source: HTMLCanvasElement, w: number, h: number): ImageData => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
};

/** Render the first page of a PDF blob to a canvas (96dpi-ish). */
const renderPdfFirstPage = async (blob: Blob, scale = 1.2): Promise<HTMLCanvasElement> => {
  const pdfjs: any = await import("pdfjs-dist");
  const buf = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
};

/**
 * Compare an on-screen element to the first page of a freshly generated PDF blob.
 * Returns a similarity score and a pass/fail relative to threshold.
 */
export async function comparePrintVsPdf(
  printEl: HTMLElement,
  pdfBlob: Blob,
  opts: PdfQaOptions = {}
): Promise<PdfQaResult> {
  const threshold = opts.threshold ?? 0.92;
  const compareWidth = opts.compareWidth ?? 480;

  const [printCanvas, pdfCanvas] = await Promise.all([
    html2canvas(printEl, { scale: 1.2, backgroundColor: "#ffffff", useCORS: true, logging: false }),
    renderPdfFirstPage(pdfBlob, 1.2),
  ]);

  const aspect = printCanvas.height / printCanvas.width;
  const w = compareWidth;
  const h = Math.round(w * aspect);

  const aData = drawToFixedSize(printCanvas, w, h);
  const bData = drawToFixedSize(pdfCanvas, w, h);
  const a = toGrayscale(aData);
  const b = toGrayscale(bData);

  let diffSum = 0;
  for (let i = 0; i < a.length; i++) diffSum += Math.abs(a[i] - b[i]);
  const mad = diffSum / a.length; // 0..255
  const similarity = +(1 - mad / 255).toFixed(4);

  let pages = 1;
  try {
    const pdfjs: any = await import("pdfjs-dist");
    const doc = await pdfjs.getDocument({ data: await pdfBlob.arrayBuffer() }).promise;
    pages = doc.numPages;
  } catch {}

  return {
    similarity,
    printWidth: printCanvas.width,
    printHeight: printCanvas.height,
    pdfWidth: pdfCanvas.width,
    pdfHeight: pdfCanvas.height,
    pages,
    passed: similarity >= threshold,
    threshold,
  };
}
