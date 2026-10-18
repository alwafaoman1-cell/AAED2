import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("claim document archive", () => {
  it("is reachable in the active claim screen and uses one canonical cloud upload", () => {
    const detail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
    expect(detail).toContain("<ClaimDocumentsPanel");
    expect(detail).not.toContain('<TabsContent value="documents"');
    expect(detail).toContain("await validateDocumentFile(file)");
    expect(detail).toContain('mediaType: "document"');
    expect(detail).toContain('source: "claim_detail"');
    expect(detail).toContain("saved === files.length");
    expect(detail).not.toMatch(/documents:\s*documents/);
  });

  it("shares the claim-media in-flight query rather than fetching the archive twice", () => {
    const documents = read("src/hooks/useClaimDocuments.ts");
    const media = read("src/hooks/useClaimMedia.ts");
    expect(documents).toContain("queryKeys.claimMedia.list(claimId)");
    expect(media).toContain("queryKeys.claimMedia.list(claimId)");
    expect(documents).toContain('row.media_type === "document"');
    expect(documents).toContain("if (estimateSeen) return false");
  });

  it("archives scanned PDF without OCR and never claims a composed message was sent", () => {
    const panel = read("src/components/insurance/ClaimDocumentsPanel.tsx");
    const scanner = read("src/components/documents/DocumentScanner.tsx");
    expect(panel).toContain("<DocumentScanner");
    expect(panel).toContain("onExtract={(file) => saveFiles([file])}");
    expect(panel).toContain('ar: "حفظ PDF مع المطالبة"');
    expect(panel).toContain("downloadDocumentBlob(document)");
    expect(panel).toContain("createSignedUrl(reference.path, 24 * 60 * 60)");
    expect(panel).toContain("لم يُرسل المستند بعد");
    expect(panel).not.toContain("openWhatsAppShareLink");
    expect(panel).not.toContain("document_extractions");
    expect(scanner).toContain("submitLabel ? submitLabel");
  });
});
