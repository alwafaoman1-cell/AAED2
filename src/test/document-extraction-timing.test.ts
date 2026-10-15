import { describe, expect, it } from "vitest";
import { withDocumentDeadline } from "@/lib/documentExtraction/timing";

describe("document processing deadline", () => {
  it("keeps a completed job successful", async () => {
    expect(await withDocumentDeadline(async () => "done", 100)).toBe("done");
  });

  it("fails a stalled OCR job and aborts its worker signal", async () => {
    let workerSignal: AbortSignal | undefined;
    await expect(withDocumentDeadline(async (signal) => {
      workerSignal = signal;
      return new Promise<string>(() => undefined);
    }, 5)).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_TIMEOUT" });
    expect(workerSignal?.aborted).toBe(true);
  });

  it("propagates operator cancellation", async () => {
    const parent = new AbortController();
    let workerSignal: AbortSignal | undefined;
    const task = withDocumentDeadline(async (signal) => {
      workerSignal = signal;
      return new Promise<string>(() => undefined);
    }, 10_000, parent.signal);
    parent.abort();
    await expect(task).rejects.toMatchObject({ code: "DOCUMENT_PROCESSING_CANCELLED" });
    expect(workerSignal?.aborted).toBe(true);
  });
});
