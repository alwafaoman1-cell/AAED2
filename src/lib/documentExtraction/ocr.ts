import type { DocumentPage, SourceSegment } from "./types";
import type Tesseract from "tesseract.js";

export interface OcrInput {
  blob: Blob;
  page: number;
  width: number;
  height: number;
}

export interface OcrProvider {
  recognize(input: OcrInput, onProgress?: (percent: number) => void): Promise<DocumentPage>;
  close(): Promise<void>;
}

const CLAIM_REFERENCE = /\bC\/(?:[A-Z0-9]+\/){3,}[A-Z0-9]+\b/i;

/** A second language pass may supply evidence, but never invent a reference. */
export function alignedEnglishClaimReference(arabic: SourceSegment[], english: SourceSegment[]): SourceSegment | null {
  const labels = arabic.filter((segment) => segment.box && segment.text.includes("رقم المطالبة"));
  for (const candidate of english) {
    const match = candidate.text.match(CLAIM_REFERENCE);
    if (!match || !candidate.box || candidate.confidence < 0.75) continue;
    const cy = candidate.box.y + candidate.box.height / 2;
    if (labels.some((label) => Math.abs(cy - (label.box!.y + label.box!.height / 2)) <=
      Math.max(candidate.box!.height, label.box!.height))) {
      return { ...candidate, text: match[0] };
    }
  }
  return null;
}

function lineSegments(blocks: Tesseract.Page["blocks"]): SourceSegment[] {
  const segments: SourceSegment[] = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        if (!line.text.trim()) continue;
        segments.push({
          text: line.text,
          confidence: Math.max(0, Math.min(1, line.confidence / 100)),
          box: { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 },
        });
      }
    }
  }
  return segments;
}

function referenceWordSegments(blocks: Tesseract.Page["blocks"]): SourceSegment[] {
  const segments: SourceSegment[] = [];
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    for (const word of line.words || []) {
      if (!CLAIM_REFERENCE.test(word.text)) continue;
      segments.push({ text: word.text, confidence: Math.max(0, Math.min(1, word.confidence / 100)),
        box: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 } });
    }
  }
  return segments;
}

/** One WASM worker per document. Models download only; document bytes stay in the browser. */
export async function createBrowserOcrProvider(): Promise<OcrProvider> {
  const { createWorker } = await import("tesseract.js");
  let reportProgress: ((percent: number) => void) | undefined;
  const worker = await createWorker("ara+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        reportProgress?.(Math.round(message.progress * 100));
      }
    },
  });
  return {
    async recognize(input, onProgress) {
      reportProgress = onProgress;
      try {
        const { data } = await worker.recognize(input.blob, {}, { blocks: true });
        const segments = lineSegments(data.blocks);
        let text = data.text || "";
        // The mixed-script model often retains the Arabic label but drops the
        // Latin C/... value. Re-read only when a real label is present, and
        // accept a complete high-confidence reference on that physical row.
        if (segments.some((segment) => segment.text.includes("رقم المطالبة")) && !CLAIM_REFERENCE.test(text)) {
          try {
            await worker.reinitialize("eng");
            const secondary = await worker.recognize(input.blob, {}, { blocks: true });
            const reference = alignedEnglishClaimReference(segments, referenceWordSegments(secondary.data.blocks));
            if (reference) { segments.push(reference); text += `\n${reference.text}`; }
          } catch { /* The primary Arabic result remains available for review. */ }
          finally { await worker.reinitialize("ara+eng"); }
        }
        return {
          number: input.page,
          text,
          method: "ocr",
          confidence: Math.max(0, Math.min(1, data.confidence / 100)),
          width: input.width,
          height: input.height,
          segments,
        };
      } finally {
        reportProgress = undefined;
      }
    },
    close: async () => { await worker.terminate(); },
  };
}

export async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("DOCUMENT_IMAGE_UNREADABLE"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
