import { describe, expect, it } from "vitest";
import { sha256File, validateDocumentFile } from "@/lib/documentExtraction/fileSafety";
import { DocumentFileError } from "@/lib/documentExtraction/fileSafety";
import { documentErrorMessage, documentIssueMessage } from "@/lib/documentExtraction/errors";

describe("document intake safety", () => {
  it("accepts a PDF by signature, not extension alone", async () => {
    const file = new File(["%PDF-1.4\n"], "synthetic.pdf", { type: "application/pdf" });
    expect(await validateDocumentFile(file)).toBe("application/pdf");
    expect(await sha256File(file)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects spoofed MIME and extension", async () => {
    const wrongMime = new File(["%PDF-1.4\n"], "synthetic.pdf", { type: "image/png" });
    const wrongExtension = new File(["%PDF-1.4\n"], "synthetic.png", { type: "application/pdf" });
    await expect(validateDocumentFile(wrongMime)).rejects.toMatchObject({ code: "DOCUMENT_MIME_MISMATCH" });
    await expect(validateDocumentFile(wrongExtension)).rejects.toMatchObject({ code: "DOCUMENT_EXTENSION_MISMATCH" });
  });

  it("rejects corrupt and oversized files before processing", async () => {
    await expect(validateDocumentFile(new File(["not a document"], "bad.pdf", { type: "application/pdf" }))).rejects.toMatchObject({ code: "DOCUMENT_UNSUPPORTED" });
    await expect(validateDocumentFile(new File(["%PDF-1.4\n"], "large.pdf", { type: "application/pdf" }), 5)).rejects.toMatchObject({ code: "DOCUMENT_SIZE_INVALID" });
  });

  it("never exposes raw database or worker errors in the operator message", () => {
    const privateError = new Error("SQL internal private-marker in stack trace");
    expect(documentErrorMessage(privateError, true)).not.toContain("private-marker");
    expect(documentErrorMessage(privateError, false)).not.toContain("private-marker");
    expect(documentErrorMessage(new DocumentFileError("DOCUMENT_PDF_UNREADABLE", "raw stack"), true))
      .toContain("PDF");
  });

  it("shows extraction warnings in the selected interface language", () => {
    const issue = { code: "VAT_TOTAL_MISMATCH", severity: "warning" as const, message: "VAT math mismatch" };
    expect(documentIssueMessage(issue, false)).toContain("الضريبة");
    expect(documentIssueMessage(issue, true)).toBe("VAT math mismatch");
  });
});
