import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueDocumentProcessing } from "@/lib/documentExtraction/persistence";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
const extraction = "00000000-0000-4000-8000-000000005741";
beforeEach(() => { vi.resetAllMocks(); mock.invoke.mockResolvedValue({ data: { code: "ACCEPTED" }, error: null }); });
afterEach(() => vi.restoreAllMocks());

describe("durable cloud enqueue precedes the optional wakeup", () => {
  it("waits for the committed queue row and sends only its UUID", async () => {
    let save!: (value: unknown) => void;
    mock.rpc.mockImplementation(() => new Promise(resolve => { save = resolve; }));
    const result = enqueueDocumentProcessing("file-id");
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith("document_enqueue_processing", { p_file_id: "file-id", p_engine_version: "1.0.8-en-worker" });
    save({ data: [{ extraction_id: extraction, processing_status: "queued" }], error: null });
    await expect(result).resolves.toEqual({ extractionId: extraction, status: "queued" });
    expect(mock.invoke).toHaveBeenCalledWith("document-worker-dispatch", { body: { extraction_id: extraction }, signal: expect.any(AbortSignal) });
  });

  it.each(["function-error", "network-error"])("keeps a saved queue task retryable after %s", async kind => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.rpc.mockResolvedValue({ data: [{ extraction_id: extraction, processing_status: "queued" }], error: null });
    if (kind === "function-error") mock.invoke.mockResolvedValue({ error: new Error("private response") });
    else mock.invoke.mockRejectedValue(new Error("private network detail"));
    await expect(enqueueDocumentProcessing("file-id")).resolves.toEqual({ extractionId: extraction, status: "queued" });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("DOCUMENT_WORKER_DISPATCH_DEFERRED");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(["extracted", "verified", "processing"])("does not wake an already %s task", async status => {
    mock.rpc.mockResolvedValue({ data: [{ extraction_id: extraction, processing_status: status }], error: null });
    await expect(enqueueDocumentProcessing("file-id")).resolves.toEqual({ extractionId: extraction, status });
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("does not wake or claim success when cloud saving failed", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error("save failed") });
    await expect(enqueueDocumentProcessing("file-id")).rejects.toThrow("save failed");
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
