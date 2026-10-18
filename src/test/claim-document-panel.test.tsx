// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaimDocumentsPanel from "@/components/insurance/ClaimDocumentsPanel";

const mocks = vi.hoisted(() => ({
  docs: [] as Array<Record<string, unknown>>,
  sign: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/hooks/useClaimDocuments", () => ({
  useClaimDocuments: () => ({ data: mocks.docs, isLoading: false, isError: false, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: mocks.sign }) } },
}));
vi.mock("@/components/documents/DocumentScanner", () => ({
  default: ({ onExtract }: { onExtract: (file: File) => Promise<boolean> }) =>
    <button type="button" onClick={() => void onExtract(new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" }))}>mock scanned PDF</button>,
}));
vi.mock("@/components/ArchivedPdfPreviewDialog", () => ({ default: () => null }));
vi.mock("@/lib/uploadHtmlAsPdf", () => ({ claimDocLabel: (category: string) => category }));
vi.mock("@/lib/vehicleMediaUrls", () => ({
  parseMediaStorageReference: (reference: string, bucket: string) => ({ bucket, path: reference }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "ar" } }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, info: mocks.toastInfo, warning: vi.fn() } }));

const claimId = "11111111-1111-4111-8111-111111111111";
const baseProps = { claimId, claimNumber: "C/001", onDelete: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  mocks.docs = [];
  mocks.sign.mockReset();
  mocks.toastError.mockReset();
  mocks.toastInfo.mockReset();
});

describe("claim document archive UI", () => {
  it("uploads the selected PDF to the claim, without invoking OCR", async () => {
    const onUpload = vi.fn().mockResolvedValue(true);
    const { container } = render(<ClaimDocumentsPanel {...baseProps} onUpload={onUpload} />);
    const file = new File(["%PDF-1.4"], "policy.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith([file], "other"));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("passes the scanner-produced PDF to the same archive write", async () => {
    const onUpload = vi.fn().mockResolvedValue(true);
    render(<ClaimDocumentsPanel {...baseProps} onUpload={onUpload} />);
    fireEvent.click(screen.getByText("مسح إلى PDF"));
    fireEvent.click(await screen.findByText("mock scanned PDF"));
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith([expect.objectContaining({ name: "scan.pdf", type: "application/pdf" })], "other"));
  });

  it("opens a WhatsApp draft with a fresh private link, not a sent confirmation", async () => {
    mocks.docs = [{
      id: "22222222-2222-4222-8222-222222222222", category: "other", file_path: `${claimId}/document/other/file.pdf`,
      storage_bucket: "insurance-docs", url: "", file_name: "file.pdf", mime_type: "application/pdf",
      source: "claim_detail", created_at: "2026-10-17T00:00:00Z",
    }];
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://example.test/private.pdf?token=test" }, error: null });
    const replace = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ location: { replace }, close: vi.fn(), opener: null } as unknown as Window);
    try {
      render(<ClaimDocumentsPanel {...baseProps} onUpload={vi.fn()} />);
      fireEvent.click(screen.getByTitle("مشاركة رابط خاص عبر واتساب"));
      await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining("https://wa.me/?text=")));
      expect(mocks.sign).toHaveBeenCalledWith(`${claimId}/document/other/file.pdf`, 24 * 60 * 60);
      expect(mocks.toastInfo).toHaveBeenCalledWith(expect.stringContaining("لم يُرسل المستند بعد"));
    } finally {
      open.mockRestore();
    }
  });

  it("does not claim sharing succeeded when signing the document fails", async () => {
    mocks.docs = [{
      id: "22222222-2222-4222-8222-222222222222", category: "other", file_path: `${claimId}/document/other/file.pdf`,
      storage_bucket: "insurance-docs", url: "", file_name: "file.pdf", mime_type: "application/pdf",
      source: "claim_detail", created_at: "2026-10-17T00:00:00Z",
    }];
    mocks.sign.mockResolvedValue({ data: null, error: new Error("Storage denied") });
    const close = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ location: { replace: vi.fn() }, close, opener: null } as unknown as Window);
    try {
      render(<ClaimDocumentsPanel {...baseProps} onUpload={vi.fn()} />);
      fireEvent.click(screen.getByTitle("مشاركة رابط خاص عبر واتساب"));
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Storage denied"));
      expect(close).toHaveBeenCalled();
      expect(mocks.toastInfo).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });
});
