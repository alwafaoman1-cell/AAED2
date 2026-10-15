import { detectDocumentQuad, perspectiveCorrect, type ScanFilter, type ScanQuad } from "./scannerCore";

self.onmessage = (event: MessageEvent<{
  id: number; operation: "detect" | "process"; image: ImageData; quad?: ScanQuad; filter?: ScanFilter;
}>) => {
  const { id, operation, image, quad, filter } = event.data;
  try {
    if (operation === "detect") self.postMessage({ id, result: detectDocumentQuad(image) });
    else if (quad && filter) self.postMessage({ id, result: perspectiveCorrect(image, quad, filter) });
    else self.postMessage({ id, error: "SCAN_INPUT_INVALID" });
  } catch { self.postMessage({ id, error: "SCAN_PROCESSING_FAILED" }); }
};
