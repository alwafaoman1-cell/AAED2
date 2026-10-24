// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getCurrentTenantId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: mocks.from } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentTenantId.mockResolvedValue("tenant-dev");
  mocks.from.mockReturnValue({ upload: mocks.upload, download: mocks.download, remove: mocks.remove });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
});

describe("HR documents in private storage", () => {
  it("uploads a PDF as a private object without embedding file data in HR JSON", async () => {
    const { uploadHrDocument } = await import("@/lib/hrDocumentStorage");
    const pdf = new File(["%PDF-1.4"], "contract.pdf", { type: "application/pdf" });
    const path = await uploadHrDocument("employee-1", pdf);
    expect(path).toMatch(/^tenant-dev\/employee-1\/[0-9a-f-]{36}$/i);
    expect(mocks.from).toHaveBeenCalledWith("hr-documents");
    expect(mocks.upload).toHaveBeenCalledWith(path, pdf, { contentType: "application/pdf", upsert: false });
  });

  it("rejects an oversized or unsupported file before a storage request", async () => {
    const { uploadHrDocument } = await import("@/lib/hrDocumentStorage");
    await expect(uploadHrDocument("employee-1", new File(["x"], "script.sh", { type: "text/x-shellscript" })))
      .rejects.toThrow("HR_DOCUMENT_FILE_INVALID");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("never deletes or downloads an object outside the current tenant", async () => {
    const { removeNewHrDocument, downloadHrDocument } = await import("@/lib/hrDocumentStorage");
    await expect(removeNewHrDocument("other-tenant/employee-1/doc")).rejects.toThrow("HR_DOCUMENT_TENANT_MISMATCH");
    await expect(downloadHrDocument("other-tenant/employee-1/doc", "doc.pdf")).rejects.toThrow("HR_DOCUMENT_TENANT_MISMATCH");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
