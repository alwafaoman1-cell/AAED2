// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadPdfBlob } from "@/lib/pdfFileDownload";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test-pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("mobile PDF file handoff", () => {
  it("keeps the PDF and its connected download link alive beyond the old 1.5 second race", () => {
    downloadPdfBlob(new Blob(["%PDF-1.4"], { type: "application/pdf" }), "دخول-ENT-001.pdf");
    const link = document.querySelector("a")!;
    expect(link.download).toBe("دخول-ENT-001.pdf");
    expect(link.isConnected).toBe(true);
    expect(link.hidden).toBe(true);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(link.isConnected).toBe(true);
    vi.advanceTimersByTime(58000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-pdf");
    expect(link.isConnected).toBe(false);
  });
  it("propagates a handoff failure and cleans up instead of claiming a download", () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error("Download blocked"); });
    expect(() => downloadPdfBlob(new Blob(["PDF"]), "document.pdf")).toThrow("Download blocked");
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
