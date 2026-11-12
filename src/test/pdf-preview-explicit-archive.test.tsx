// @vitest-environment jsdom
import { StrictMode, type ButtonHTMLAttributes, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/htmlToPdf", () => ({ generatePdfFromHtml: mocks.generate, DEFAULT_MARGINS: {} }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/pdfLayoutSettings", () => ({
  buildHtmlWithPageMarginStyle: (html: string) => html,
  detectOrientation: () => "portrait",
}));
vi.mock("@/lib/safeHtml", () => ({
  sanitizePdfHtml: (html: string) => html, PDF_HTML_SANDBOX: "allow-same-origin allow-modals",
}));
vi.mock("@/lib/pdfDocumentRenderer", () => ({
  waitForPdfAssets: vi.fn(async () => {}), preparePagedPdfDocument: vi.fn(),
  getPdfPageDiagnostics: () => ({ oversizedPages: 0 }),
}));
vi.mock("@/components/whatsapp/WhatsAppShareButton", () => ({ default: () => <button>WhatsApp</button> }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => open ? <div>{children}</div> : null,
    DialogContent: Part, DialogHeader: Part, DialogTitle: Part, DialogDescription: Part,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
}));

import PdfPreviewDialog from "@/components/PdfPreviewDialog";

const NativeURL = URL;
const archiveResult = { url: "https://example.test/archive.pdf", path: "archive/document.pdf" };
const props = {
  open: true, onOpenChange: vi.fn(), title: "Document",
  htmlContent: '<html><body><main class="page">Document A</main></body></html>',
};
const command = (kind: "download" | "print") => screen.getByRole("button", { name: kind === "download" ? "تنزيل PDF" : "طباعة PDF" });
const click = async (element: HTMLElement) => {
  await act(async () => { fireEvent.click(element); });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.generate.mockReset().mockResolvedValue(new Blob(["PDF"], { type: "application/pdf" }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = vi.fn(() => "blob:https://example.test/pdf");
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PDF preview requires an explicit command before archiving", () => {
  it("does not archive when the browser rejects the download handoff", async () => {
    const archive = vi.fn().mockResolvedValue(archiveResult);
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error("Download blocked"); });
    render(<PdfPreviewDialog {...props} autoSave={archive} />);
    await click(command("download"));
    expect(archive).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
  it("does not write on opening, browsing, callback changes, zooming, scrolling or reopening", async () => {
    const archive = vi.fn().mockResolvedValue(archiveResult);
    const replacementArchive = vi.fn().mockResolvedValue(archiveResult);
    const onSaved = vi.fn();
    const view = render(<PdfPreviewDialog {...props} open={false} autoSave={archive} onSaved={onSaved} />, { wrapper: StrictMode });
    view.rerender(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} />);
    await click(screen.getByTitle("تكبير"));
    await click(screen.getByTitle("ملاءمة العرض"));
    await click(screen.getByTitle("ملء الشاشة"));
    fireEvent.scroll(document.querySelector(".overflow-auto")!, { target: { scrollTop: 100 } });
    view.rerender(<PdfPreviewDialog {...props} htmlContent={props.htmlContent.replace("A", "B")} autoSave={replacementArchive} onSaved={vi.fn()} />);
    view.rerender(<PdfPreviewDialog {...props} open={false} autoSave={archive} />);
    view.rerender(<PdfPreviewDialog {...props} autoSave={archive} />);
    expect(archive).not.toHaveBeenCalled();
    expect(replacementArchive).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["download", "print"] as const)("archives after an explicit successful PDF %s command", async (kind) => {
    const archive = vi.fn().mockResolvedValue(archiveResult);
    const onSaved = vi.fn();
    render(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} />);
    expect(archive).not.toHaveBeenCalled();
    await click(command(kind));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(archiveResult);
    expect(screen.getByRole("link", { name: "محفوظ" })).toHaveAttribute("href", archiveResult.url);
    await click(command(kind === "download" ? "print" : "download"));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("keeps HTML-only export read-only with respect to the PDF archive", async () => {
    const archive = vi.fn().mockResolvedValue(archiveResult);
    render(<PdfPreviewDialog {...props} autoSave={archive} />);
    await click(screen.getByRole("button", { name: "تصدير البيانات فقط" }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["download", "print"] as const)("does not archive when PDF generation fails during %s", async (kind) => {
    const archive = vi.fn().mockResolvedValue(archiveResult);
    mocks.generate.mockRejectedValueOnce(new Error("PDF generation failed"));
    render(<PdfPreviewDialog {...props} autoSave={archive} />);
    await click(command(kind));
    expect(archive).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("retries a failed archive only on another explicit command, without losing the download", async () => {
    const archive = vi.fn().mockRejectedValueOnce(new Error("Archive offline")).mockResolvedValueOnce(archiveResult);
    const onSaved = vi.fn();
    render(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} />);
    await click(command("download"));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    await click(screen.getByTitle("تكبير"));
    expect(archive).toHaveBeenCalledTimes(1);
    await click(command("download"));
    expect(archive).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledWith(archiveResult);
  });

  it("deduplicates concurrent archive requests from repeated PDF commands", async () => {
    const saving = deferred<typeof archiveResult>();
    const archive = vi.fn(() => saving.promise);
    const onSaved = vi.fn();
    render(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} />);
    await click(command("download"));
    await click(command("print"));
    expect(archive).toHaveBeenCalledTimes(1);
    await act(async () => { saving.resolve(archiveResult); });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it.each(["browse", "reopen"] as const)("does not archive a stale export after %s while its PDF is preparing", async (action) => {
    const preparing = deferred<Blob>();
    mocks.generate.mockReturnValueOnce(preparing.promise);
    const archive = vi.fn().mockResolvedValue(archiveResult);
    const view = render(<PdfPreviewDialog {...props} autoSave={archive} />);
    await click(command("download"));
    if (action === "browse") {
      view.rerender(<PdfPreviewDialog {...props} autoSave={archive} htmlContent={props.htmlContent.replace("A", "B")} />);
    } else {
      view.rerender(<PdfPreviewDialog {...props} open={false} autoSave={archive} />);
      view.rerender(<PdfPreviewDialog {...props} autoSave={archive} />);
    }
    await act(async () => { preparing.resolve(new Blob(["PDF"], { type: "application/pdf" })); });
    expect(archive).not.toHaveBeenCalled();
    // The old PDF must not be cached as the newly viewed/reopened document.
    await click(command("download"));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("does not apply an old archive result to the document being browsed", async () => {
    const saving = deferred<typeof archiveResult>();
    const archive = vi.fn(() => saving.promise);
    const onSaved = vi.fn();
    const view = render(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} />);
    await click(command("download"));
    view.rerender(<PdfPreviewDialog {...props} autoSave={archive} onSaved={onSaved} htmlContent={props.htmlContent.replace("A", "B")} />);
    await act(async () => { saving.resolve(archiveResult); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "محفوظ" })).toBeNull();
  });
});
