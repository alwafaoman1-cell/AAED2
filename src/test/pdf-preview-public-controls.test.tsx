// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }) }));
vi.mock("@/components/whatsapp/WhatsAppShareButton", () => ({ default: () => <button>Staff WhatsApp sharing</button> }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => open ? <div>{children}</div> : null, DialogContent: Part, DialogHeader: Part, DialogTitle: Part, DialogDescription: Part };
});
vi.mock("@/lib/pdfDocumentRenderer", () => ({ waitForPdfAssets: vi.fn(async () => {}), preparePagedPdfDocument: vi.fn(), getPdfPageDiagnostics: () => ({ oversizedPages: 0 }) }));
vi.mock("@/lib/pdfLayoutSettings", () => ({ buildHtmlWithPageMarginStyle: (html: string) => html, detectOrientation: () => "portrait" }));
vi.mock("@/lib/safeHtml", () => ({ sanitizePdfHtml: (html: string) => html, PDF_HTML_SANDBOX: "allow-same-origin allow-modals" }));
import PdfPreviewDialog from "@/components/PdfPreviewDialog";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { open: true, onOpenChange: vi.fn(), title: "Intake receipt", htmlContent: "<html><body>Authorized signed document</body></html>" };

describe("customer document preview controls", () => {
  it("offers English download and print controls without staff sharing", async () => {
    let container!: HTMLElement;
    await act(async () => { container = render(<PdfPreviewDialog {...props} allowShare={false} />).container; });
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Print PDF" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Staff WhatsApp sharing" })).toBeNull();
    expect(container.textContent).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("preserves staff sharing by default for existing document flows", async () => {
    await act(async () => { render(<PdfPreviewDialog {...props} />); });
    expect(screen.getByRole("button", { name: "Staff WhatsApp sharing" })).toBeVisible();
  });
});
