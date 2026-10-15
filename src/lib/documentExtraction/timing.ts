import { DocumentFileError } from "./fileSafety";

/** Stops waiting at the UI boundary and aborts the browser worker if possible. */
export async function withDocumentDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new DocumentFileError("DOCUMENT_PROCESSING_CANCELLED", "Document processing was cancelled.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DocumentFileError("DOCUMENT_PROCESSING_TIMEOUT", "Document processing exceeded the allowed time."));
      controller.abort();
    }, timeoutMs);
    onParentAbort = () => {
      reject(new DocumentFileError("DOCUMENT_PROCESSING_CANCELLED", "Document processing was cancelled."));
      controller.abort();
    };
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  });
  try { return await Promise.race([work(controller.signal), deadline]); }
  finally {
    if (timer) clearTimeout(timer);
    if (onParentAbort) parentSignal?.removeEventListener("abort", onParentAbort);
  }
}
